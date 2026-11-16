"""Sinais de atenção territorial: cruzamento espacial transparente entre detecções e territórios.

Regras (Missão 07):
* Cada sinal é um FATO verificável com critério fixo e público (ex.: "3 detecções NOAA-21 com o centro do pixel
  dentro da Terra Indígena X"). Não há pontuação, peso, índice de risco nem previsão. Não é alerta oficial.
* Contagens são por satélite e nunca somadas como incêndios: o mesmo fogo pode ser visto por vários satélites.
* Proximidade não indica dano; pessoas perto de uma detecção não são vítimas nem estão comprovadamente ameaçadas.
* Coincidência com avisos DETER é contexto (o INPE mapeou alteração florestal ali), não prova de causa.
* Distâncias em projeção azimutal equidistante centrada no território.
"""

from __future__ import annotations

import asyncio
import logging
import time as _time
from datetime import UTC, datetime, timedelta

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import mapping, shape

from app.core.errors import AppError
from app.core.heavy import run_heavy
from app.domain.regions import Region, RegionRegistry, geodesic_area_km2
from app.integrations.censipam import LAYERS, WFS_BASE, CensipamClient
from app.integrations.cnes import CnesClient
from app.integrations.deter import DETER_CLASSES, DETER_DOCS, DETER_SOURCE, deter_bbox
from app.integrations.ibge import BC250_LAYERS, ibge_wfs_bbox
from app.services.detections_service import DetectionsService, query_metadata
from app.services.impact_service import _Projector

log = logging.getLogger("app.attention")

ALL_PRODUCTS = "VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT,MODIS_NRT"
NEAR_TERRITORY_KM = 2.0
LOCALITY_KM = 1.0
LOCALITY_WIDE_KM = 5.0
HEALTH_KM = 5.0
DETER_MONTHS = 12
RECENT_HOURS = 6
MAX_REFS = 400
CACHE_SECONDS = 1800

TERRITORY_CATEGORY = {"terras_indigenas": "indigenous", "ucs_federais": "conservation", "ucs_estaduais": "conservation",
                      "quilombolas": "quilombola", "assentamentos": "settlement"}
GROUP_ORDER = {"protected": 0, "people": 1, "environment": 2}
DETER_GROUP_ORDER = ["deforestation", "burn_scar", "degradation", "selective_logging", "mining"]

CRITERIA = [
    {"id": "inside_territory", "text": "Centro do pixel da detecção dentro do polígono oficial (terra indígena, unidade de conservação, "
                                       "território quilombola ou assentamento)."},
    {"id": "near_territory", "km": NEAR_TERRITORY_KM,
     "text": f"Detecção fora do polígono, a até {NEAR_TERRITORY_KM:g} km do limite."},
    {"id": "locality", "km": LOCALITY_KM,
     "text": f"Localidade mapeada pelo IBGE (BC250 2025) a até {LOCALITY_KM:g} km do centro do pixel (≈ dimensão do pixel VIIRS "
             "somada ao erro de posição)."},
    {"id": "health", "km": HEALTH_KM, "text": f"Unidade de saúde do CNES a até {HEALTH_KM:g} km do centro do pixel."},
    {"id": "deter", "months": DETER_MONTHS,
     "text": f"Centro do pixel dentro de um polígono de aviso DETER (INPE) observado nos últimos {DETER_MONTHS} meses."},
]
DISCLAIMER = ("Sinais de atenção são cruzamentos espaciais com critérios fixos e públicos, para triagem. Não são alertas oficiais, "
              "não medem risco nem dano e não indicam causa. Confirme com os órgãos responsáveis (Defesa Civil, Corpo de Bombeiros, "
              "ICMBio, Funai, Ibama/Prevfogo, Semas) antes de qualquer ação.")


def _iso(dt) -> str | None:
    if dt is None or (isinstance(dt, float) and np.isnan(dt)):
        return None
    if isinstance(dt, pd.Timestamp):
        dt = dt.to_pydatetime()
    return dt.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class _Dets:
    """Detecções projetadas com índice espacial e utilitários de resumo."""

    def __init__(self, frame: pd.DataFrame, proj: _Projector, now: datetime, max_refs: int = MAX_REFS) -> None:
        self.max_refs = max_refs
        self.f = frame.reset_index(drop=True)
        self.proj = proj
        self.now = now
        if self.f.empty:
            self.xy = np.empty((0, 2))
            self.tree = None
            return
        self.xy = proj.points(self.f["longitude"], self.f["latitude"])
        self.pts = shapely.points(self.xy)
        self.tree = shapely.STRtree(self.pts)
        self.times = self.f["acq_datetime_utc"]

    def __len__(self) -> int:
        return len(self.f)

    def query(self, geom_xy, predicate: str, distance: float | None = None) -> np.ndarray:
        if self.tree is None:
            return np.array([], dtype=int)
        if distance is None:
            return np.asarray(self.tree.query(geom_xy, predicate=predicate), dtype=int)
        return np.asarray(self.tree.query(geom_xy, predicate=predicate, distance=distance), dtype=int)

    def summary(self, idx: np.ndarray, dist_km: np.ndarray | None = None, max_refs: int | None = None) -> dict:
        max_refs = self.max_refs if max_refs is None else max_refs
        sub = self.f.iloc[idx]
        t = sub["acq_datetime_utc"]
        out = {
            "by_satellite": {k: int(v) for k, v in sub["satellite_name"].value_counts().items()},
            "first_utc": _iso(t.min()), "last_utc": _iso(t.max()),
            "recent_6h": int((t >= self.now - timedelta(hours=RECENT_HOURS)).sum()),
            "max_frp_mw": None if sub["frp_mw"].dropna().empty else round(float(sub["frp_mw"].max()), 1),
        }
        if dist_km is not None and len(dist_km):
            out["nearest_km"] = round(float(np.min(dist_km)), 2)
        order = np.argsort(-t.astype("int64").to_numpy())[:max_refs]
        refs = []
        for j in order:
            r = sub.iloc[int(j)]
            ref = {"p": r["product_id"], "id": r["detection_id"], "s": r["satellite_name"],
                   "t": r["acq_datetime_utc"].strftime("%Y-%m-%dT%H:%MZ"), "lon": round(float(r["longitude"]), 5), "lat": round(float(r["latitude"]), 5)}
            if dist_km is not None:
                ref["d_km"] = round(float(dist_km[int(j)]), 2)
            refs.append(ref)
        out["detections"] = refs
        out["detections_truncated"] = len(sub) > max_refs
        lon, lat = sub["longitude"], sub["latitude"]
        out["bbox_detections"] = [round(float(lon.min()), 4), round(float(lat.min()), 4), round(float(lon.max()), 4), round(float(lat.max()), 4)]
        return out


def _clip_to_region(features: list[dict], region: Region) -> list[dict]:
    """Mantém polígonos DETER que intersectam o limite IBGE e anota a área (geodésica) dentro dele.

    A atribuição municipal do INPE (`mun_geocod`) pode divergir da malha IBGE vigente (ex.: áreas de Mojuí dos Campos
    atribuídas a Santarém), por isso o recorte é sempre pelo mesmo limite usado nas detecções."""
    rg = region.geometry
    shapely.prepare(rg)
    out = []
    for f in features:
        if not f.get("geometry"):
            continue
        try:
            g = shapely.make_valid(shape(f["geometry"]))
        except Exception:  # noqa: BLE001 — geometria inválida da fonte
            continue
        if not rg.intersects(g):
            continue
        inside = g if rg.contains(g) else g.intersection(rg)
        props = {**f.get("properties", {}), "_area_in_region_km2": geodesic_area_km2(inside)}
        out.append({**f, "properties": props, "_geom": g})
    return out


def _bbox_union(*boxes) -> list[float] | None:
    bs = [b for b in boxes if b]
    if not bs:
        return None
    return [min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)]


class AttentionService:
    def __init__(self, detections: DetectionsService, regions: RegionRegistry, http, cache, censipam: CensipamClient,
                 cnes: CnesClient) -> None:
        self._det = detections
        self._regions = regions
        self._http = http
        self._cache = cache
        self._censipam = censipam
        self._cnes = cnes
        self._memo: dict[tuple, tuple[float, dict]] = {}
        self._inflight: dict[tuple, asyncio.Future] = {}

    # ---------------------------------------------------------------- utilidades
    def _municipality_of(self, lon: float, lat: float, parent: str) -> tuple[str | None, str | None]:
        for m in self._regions.municipalities(parent):
            if bool(m.contains(np.array([lon]), np.array([lat]))[0]):
                return m.definition.id, m.definition.name
        return None, None

    def _municipalities_for(self, refs: list[dict], parent: str, cache: dict) -> list[str]:
        ids: dict[str, int] = {}
        for r in refs[:60]:
            key = (round(r["lon"], 3), round(r["lat"], 3))
            if key not in cache:
                cache[key] = self._municipality_of(r["lon"], r["lat"], parent)
            mid = cache[key][0]
            if mid:
                ids[mid] = ids.get(mid, 0) + 1
        return sorted(ids, key=lambda k: -ids[k])

    # ---------------------------------------------------------------- principal
    async def attention(self, region_id: str, window: str = "7d") -> dict:
        region = self._regions.get(region_id)
        q = await self._det.query(region_id, window, ALL_PRODUCTS)
        shas = tuple(r.fetch.sha256 for r in q.results if r.fetch)
        key = (region_id, window, shas)
        hit = self._memo.get(key)
        if hit and _time.monotonic() - hit[0] < CACHE_SECONDS:
            return hit[1]
        # Pedidos simultâneos da mesma chave compartilham um único cálculo.
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.ensure_future(self._compute(region, q))
            self._inflight[key] = task
        try:
            out = await asyncio.shield(task)
        finally:
            if task.done():
                self._inflight.pop(key, None)
        self._memo = {k: v for k, v in self._memo.items() if _time.monotonic() - v[0] < CACHE_SECONDS}
        self._memo[key] = (_time.monotonic(), out)
        return out

    async def _compute(self, region: Region, q) -> dict:
        now = datetime.now(UTC)
        level = region.definition.level
        if level not in ("estado", "municipio"):
            return {"available": False, "region": region.summary(), "reason": "Sinais de atenção são calculados para o Pará e seus municípios."}
        is_muni = level == "municipio"
        parent = region.id if not is_muni else (region.definition.parent or "para")
        lon0, lat0 = region.centroid
        proj = _Projector(lon0, lat0)
        dets = _Dets(q.frame, proj, now, MAX_REFS if is_muni else 40)
        w, s, e, n = region.bbox
        m = 0.05
        ebbox = (w - m, s - m, e + m, n + m)

        tasks = {lid: self._censipam.layer_bbox(ld, ebbox) for lid, ld in LAYERS.items()}
        tasks["localities"] = ibge_wfs_bbox(self._http, self._cache, BC250_LAYERS["localidades"], ebbox)
        if is_muni:
            tasks["health"] = self._cnes.establishments(region.definition.ibge_code)
            tasks["health_types"] = self._cnes.unit_types()
            since = (now - timedelta(days=round(DETER_MONTHS * 30.44))).date()
            tasks["deter"] = deter_bbox(self._http, self._cache, region.bbox, since)
        results = dict(zip(tasks, await asyncio.gather(*tasks.values(), return_exceptions=True), strict=True))
        for v in results.values():
            if isinstance(v, BaseException) and not isinstance(v, AppError):
                raise v

        return await run_heavy(self._assemble, region, q, dets, results, now, is_muni, parent, proj)

    def _assemble(self, region: Region, q, dets: _Dets, results: dict, now: datetime, is_muni: bool, parent: str, proj: _Projector) -> dict:
        """Parte pesada (geometria) do cálculo, fora do laço de eventos para não bloquear a API."""
        signals: list[dict] = []
        targets: list[dict] = []
        sources: dict[str, dict] = {}
        muni_cache: dict = {}
        simplify_deg = 0.0008 if is_muni else 0.004

        # -------------------------------------------- territórios oficiais (Censipam: FUNAI, ICMBio, CNUC, INCRA)
        territory_counts = {c: {"with_inside": 0, "with_near": 0} for c in set(TERRITORY_CATEGORY.values())}
        for lid, ld in LAYERS.items():
            res = results[lid]
            if isinstance(res, AppError):
                sources[lid] = {"available": False, "label": ld.label, "reason": res.message}
                continue
            feats = (res.data or {}).get("features", []) if isinstance(res.data, dict) else []
            sources[lid] = {"available": True, "label": ld.label, "primary_source": ld.primary_source, "served_by": "Censipam GeoServer",
                            "url": res.url, "fetched_at": res.fetched_at.isoformat(timespec="seconds"), "stale": res.stale, "features": len(feats)}
            if not len(dets):
                continue
            cat = TERRITORY_CATEGORY[lid]
            for k, f in enumerate(feats):
                try:
                    g = shapely.make_valid(shape(f["geometry"]))
                except Exception:  # noqa: BLE001 — geometria inválida da fonte
                    continue
                gxy = proj.geom(g)
                near = dets.query(gxy, "dwithin", NEAR_TERRITORY_KM * 1000.0)
                if not len(near):
                    continue
                inside_mask = shapely.contains_xy(gxy, dets.xy[near, 0], dets.xy[near, 1])
                inside, outside = near[inside_mask], near[~inside_mask]
                props = f.get("properties", {})
                name = props.get(ld.name_field) or "(sem nome na fonte)"
                attrs = {ld.attr_labels.get(a, a): props.get(a) for a in ld.attrs if props.get(a) not in (None, "")}
                tid = f"{lid}:{k}"
                gbox = [round(v, 4) for v in g.bounds]
                base = {"group": "protected" if cat != "settlement" else "people", "category": cat,
                        "target": {"id": tid, "name": name, "layer_id": lid, "layer_label": ld.label, "source": ld.primary_source,
                                   "attributes": attrs, "bbox": gbox}}
                if len(inside):
                    territory_counts[cat]["with_inside"] += 1
                    sm = dets.summary(inside)
                    signals.append({**base, "id": f"{tid}:inside", "relation": "inside", "criterion": "inside_territory", **sm,
                                    "bbox": _bbox_union(sm["bbox_detections"]),
                                    "region_ids": [region.id] if is_muni else self._municipalities_for(sm["detections"], parent, muni_cache)})
                if len(outside):
                    territory_counts[cat]["with_near"] += 1
                    dist = shapely.distance(gxy, dets.pts[outside]) / 1000.0
                    sm = dets.summary(outside, dist, None if is_muni else 8)
                    signals.append({**base, "id": f"{tid}:near", "relation": "near", "criterion": "near_territory", "radius_km": NEAR_TERRITORY_KM,
                                    **sm, "bbox": _bbox_union(sm["bbox_detections"]),
                                    "region_ids": [region.id] if is_muni else self._municipalities_for(sm["detections"], parent, muni_cache)})
                if not is_muni and not len(inside):
                    continue  # escala estadual: geometria só dos territórios com detecção dentro
                targets.append({"type": "Feature", "properties": {"id": tid, "name": name, "category": cat, "layer_id": lid},
                                "geometry": mapping(shapely.simplify(g, simplify_deg, preserve_topology=True))})

        # -------------------------------------------- localidades (IBGE BC250 2025)
        people = {"localities_total": None, "localities_within_1km": None, "localities_within_5km": None,
                  "health_total": None, "health_within_5km": None}
        loc_res = results["localities"]
        if isinstance(loc_res, AppError):
            sources["localities"] = {"available": False, "label": "Localidades (IBGE BC250)", "reason": loc_res.message}
        else:
            feats = (loc_res["data"] or {}).get("features", [])
            pts = []
            for f in feats:
                lon, lat = f["geometry"]["coordinates"][:2]
                if not bool(region.contains(np.array([lon]), np.array([lat]))[0]):
                    continue
                p = f["properties"]
                pts.append((lon, lat, p.get("identificador") or "(sem nome)", p.get("tipolocalidade")))
            sources["localities"] = {"available": True, "label": "Localidades (IBGE BC250 2025)", "url": loc_res["url"],
                                     "fetched_at": loc_res["fetched_at"], "features": len(pts)}
            within1 = within5 = 0
            if pts:
                lxy = proj.points([p[0] for p in pts], [p[1] for p in pts])
                for i, (lon, lat, name, ltype) in enumerate(pts):
                    if not len(dets):
                        break
                    near = dets.query(shapely.Point(lxy[i]), "dwithin", LOCALITY_WIDE_KM * 1000.0)
                    if not len(near):
                        continue
                    within5 += 1
                    d = np.sqrt(((dets.xy[near] - lxy[i]) ** 2).sum(axis=1)) / 1000.0
                    close = near[d <= LOCALITY_KM]
                    if not len(close):
                        continue
                    within1 += 1
                    sm = dets.summary(close, d[d <= LOCALITY_KM])
                    rid = region.id if is_muni else self._municipality_of(lon, lat, parent)[0]
                    signals.append({"id": f"locality:{i}", "group": "people", "category": "locality", "relation": "within_km",
                                    "criterion": "locality", "radius_km": LOCALITY_KM,
                                    "target": {"id": f"locality:{i}", "name": name, "type": ltype, "layer_id": "localities",
                                               "source": "IBGE BC250 2025", "lon": lon, "lat": lat},
                                    **sm, "bbox": _bbox_union(sm["bbox_detections"], [lon, lat, lon, lat]),
                                    "region_ids": [rid] if rid else []})
            people.update(localities_total=len(pts), localities_within_1km=within1,
                          localities_within_5km=within5)

        # -------------------------------------------- unidades de saúde (CNES; por município)
        if is_muni:
            h_res = results["health"]
            if isinstance(h_res, AppError):
                sources["health"] = {"available": False, "label": "Unidades de saúde (CNES)", "reason": h_res.message}
            else:
                types = results["health_types"] if not isinstance(results["health_types"], BaseException) else {}
                items = [x for x in h_res["items"] if x.get("latitude_estabelecimento_decimo_grau") is not None
                         and x.get("longitude_estabelecimento_decimo_grau") is not None]
                sources["health"] = {"available": True, "label": "Unidades de saúde (CNES)", "url": h_res["url"],
                                     "fetched_at": h_res["fetched_at"], "features": len(items), "registered": len(h_res["items"])}
                hits = 0
                for x in items:
                    lon, lat = float(x["longitude_estabelecimento_decimo_grau"]), float(x["latitude_estabelecimento_decimo_grau"])
                    hxy = proj.points([lon], [lat])[0]
                    near = dets.query(shapely.Point(hxy), "dwithin", HEALTH_KM * 1000.0) if len(dets) else np.array([], dtype=int)
                    if not len(near):
                        continue
                    hits += 1
                    d = np.sqrt(((dets.xy[near] - hxy) ** 2).sum(axis=1)) / 1000.0
                    sm = dets.summary(near, d)
                    code = x.get("codigo_tipo_unidade")
                    signals.append({"id": f"health:{x.get('codigo_cnes')}", "group": "people", "category": "health", "relation": "within_km",
                                    "criterion": "health", "radius_km": HEALTH_KM,
                                    "target": {"id": f"health:{x.get('codigo_cnes')}", "name": x.get("nome_fantasia") or x.get("nome_razao_social"),
                                               "type": types.get(int(code)) if code is not None else None, "layer_id": "health",
                                               "source": f"CNES {x.get('codigo_cnes')}", "lon": lon, "lat": lat},
                                    **sm, "bbox": _bbox_union(sm["bbox_detections"], [lon, lat, lon, lat]), "region_ids": [region.id]})
                people.update(health_total=len(items), health_within_5km=hits)
        else:
            sources["health"] = {"available": False, "label": "Unidades de saúde (CNES)", "not_applicable": True,
                                 "reason": "Cruzamento com o CNES é feito por município: selecione um município."}

        # -------------------------------------------- avisos DETER (INPE; por município)
        environment: dict = {"deter_available": False}
        if is_muni:
            d_res = results["deter"]
            if isinstance(d_res, AppError):
                sources["deter"] = {"available": False, "label": DETER_SOURCE, "reason": d_res.message}
            else:
                feats = _clip_to_region((d_res["data"] or {}).get("features", []), region)
                sources["deter"] = {"available": True, "label": DETER_SOURCE, "url": d_res["url"], "fetched_at": d_res["fetched_at"],
                                    "stale": d_res["stale"], "features": len(feats), "docs": DETER_DOCS,
                                    "selection": "Polígonos que intersectam o limite IBGE; área calculada dentro do limite."}
                by_class: dict[str, dict] = {}
                hit_by_group: dict[str, list[int]] = {g: [] for g in DETER_GROUP_ORDER}
                polys_by_group: dict[str, list[dict]] = {g: [] for g in DETER_GROUP_ORDER}
                any_hit = np.zeros(len(dets), dtype=bool)
                for f in feats:
                    p = f.get("properties", {})
                    cls = p.get("classname") or "?"
                    grp = DETER_CLASSES.get(cls, ("other", cls))[0]
                    c = by_class.setdefault(cls, {"class": cls, "group": grp, "label": DETER_CLASSES.get(cls, (grp, cls))[1],
                                                  "polygons": 0, "area_km2": 0.0, "latest_view_date": None})
                    c["polygons"] += 1
                    c["area_km2"] += float(p.get("_area_in_region_km2") or 0)
                    vd = p.get("view_date")
                    if vd and (c["latest_view_date"] is None or vd > c["latest_view_date"]):
                        c["latest_view_date"] = vd
                    if not len(dets):
                        continue
                    gxy = proj.geom(f["_geom"])
                    inside = dets.query(gxy, "contains")
                    if not len(inside):
                        continue
                    any_hit[inside] = True
                    hit_by_group.setdefault(grp, []).extend(inside.tolist())
                    polys_by_group.setdefault(grp, []).append({"gid": p.get("gid"), "class": cls, "view_date": vd,
                                                               "area_km2": round(float(p.get("_area_in_region_km2") or 0), 3),
                                                               "satellite": p.get("satellite"), "detections": int(len(inside))})
                for grp in DETER_GROUP_ORDER + [g for g in hit_by_group if g not in DETER_GROUP_ORDER]:
                    idx = np.unique(np.asarray(hit_by_group.get(grp, []), dtype=int))
                    if not len(idx):
                        continue
                    sm = dets.summary(idx)
                    polys = sorted(polys_by_group[grp], key=lambda x: x["view_date"] or "", reverse=True)
                    signals.append({"id": f"deter:{grp}", "group": "environment", "category": f"deter_{grp}", "relation": "inside",
                                    "criterion": "deter", "months": DETER_MONTHS,
                                    "target": {"id": f"deter:{grp}", "name": grp, "layer_id": "deter", "source": DETER_SOURCE,
                                               "polygons": polys[:40], "polygons_hit": len(polys)},
                                    **sm, "bbox": sm["bbox_detections"], "region_ids": [region.id]})
                environment = {
                    "deter_available": True, "months": DETER_MONTHS,
                    "classes": sorted(({**v, "area_km2": round(v["area_km2"], 2)} for v in by_class.values()),
                                      key=lambda v: (DETER_GROUP_ORDER.index(v["group"]) if v["group"] in DETER_GROUP_ORDER else 99, v["class"])),
                    "detections_over_deter": int(any_hit.sum()),
                    "detections_over_deter_by_satellite": ({k: int(v) for k, v in dets.f[any_hit]["satellite_name"].value_counts().items()}
                                                           if len(dets) else {}),
                    "caveat": "DETER é um sistema de aviso para fiscalização (não é a taxa oficial PRODES), cobre a máscara de floresta e é "
                              "limitado por nuvens. Detecção sobre um aviso indica coincidência espacial, não causa.",
                }
        else:
            sources["deter"] = {"available": False, "label": DETER_SOURCE, "not_applicable": True,
                                "reason": "Avisos DETER são cruzados por município: selecione um município."}

        # -------------------------------------------- ordenação e resumo
        signals.sort(key=lambda x: (GROUP_ORDER[x["group"]], x.get("relation") == "near", -(pd.Timestamp(x["last_utc"]).value if x.get("last_utc") else 0)))
        by_muni: dict[str, dict] = {}
        if not is_muni:
            names = {mm.definition.id: mm.definition.name for mm in self._regions.municipalities(parent)}
            for sgl in signals:
                if sgl.get("relation") == "near":
                    continue
                for rid in sgl.get("region_ids", [])[:1]:
                    b = by_muni.setdefault(rid, {"region_id": rid, "name": names.get(rid, rid), "signals": 0, "categories": {}, "last_utc": None})
                    b["signals"] += 1
                    b["categories"][sgl["category"]] = b["categories"].get(sgl["category"], 0) + 1
                    if sgl.get("last_utc") and (b["last_utc"] is None or sgl["last_utc"] > b["last_utc"]):
                        b["last_utc"] = sgl["last_utc"]
        meta = query_metadata(q)
        out = {
            "available": True,
            "experimental": True,
            "official": False,
            "region": region.summary(),
            "generated_at": _iso(now),
            "window": meta["window"],
            "disclaimer": DISCLAIMER,
            "criteria": CRITERIA,
            "detections_considered": {
                "count_note": "Contagens por satélite; não somar como incêndios.",
                "by_satellite": ({k: int(v) for k, v in dets.f["satellite_name"].value_counts().items()} if len(dets) else {}),
                "products": [{"product_id": p["product_id"], "available": p["available"], "count": p["count"],
                              "error": (p.get("error") or {}).get("message")} for p in meta["products"]],
            },
            "summary": {
                "protected": territory_counts,
                "people": people,
                "environment": {k: v for k, v in environment.items() if k != "classes"} | {"classes": environment.get("classes", [])},
                "signals": sum(1 for x in signals if x.get("relation") != "near"),
                "near_signals": sum(1 for x in signals if x.get("relation") == "near"),
            },
            "signals": signals,
            "targets": {"type": "FeatureCollection", "features": targets},
            "by_municipality": sorted(by_muni.values(), key=lambda b: (-b["signals"], b["name"])),
            "sources": sources,
            "method": "Projeção azimutal equidistante centrada no território; índice espacial STRtree (shapely). "
                      "Detecções da janela escolhida, recortadas pelo limite IBGE, dos quatro satélites (VIIRS NOAA-20/NOAA-21, MODIS Terra/Aqua).",
            "not_evaluated": ["Escolas (INEP)", "Comunidades e aldeias não cadastradas em bases oficiais",
                              "Direção do vento e previsão de propagação (não integradas)", "Área queimada medida por satélite (MCD64A1 não integrado)"],
            "wfs": {"censipam": WFS_BASE},
        }
        return out

    # ---------------------------------------------------------------- camada DETER para o mapa
    async def deter_layer(self, region_id: str) -> dict:
        region = self._regions.get(region_id)
        if region.definition.level != "municipio":
            return {"type": "FeatureCollection", "features": [], "metadata": {"available": False,
                    "reason": "Avisos DETER são carregados por município: selecione um município."}}
        since = (datetime.now(UTC) - timedelta(days=round(DETER_MONTHS * 30.44))).date()
        res = await deter_bbox(self._http, self._cache, region.bbox, since)
        feats = []
        for f in _clip_to_region((res["data"] or {}).get("features", []), region):
            p = f.get("properties", {})
            cls = p.get("classname") or "?"
            g = shapely.simplify(f["_geom"], 0.0002, preserve_topology=True)
            feats.append({"type": "Feature", "geometry": mapping(g),
                          "properties": {"gid": p.get("gid"), "class": cls, "group": DETER_CLASSES.get(cls, ("other", cls))[0],
                                         "label": DETER_CLASSES.get(cls, ("other", cls))[1], "view_date": p.get("view_date"),
                                         "area_km2": round(float(p.get("_area_in_region_km2") or 0), 3), "satellite": p.get("satellite"), "sensor": p.get("sensor")}})
        return {"type": "FeatureCollection", "features": feats, "metadata": {
            "available": True, "source": DETER_SOURCE, "url": res["url"], "fetched_at": res["fetched_at"], "stale": res["stale"],
            "since": since.isoformat(), "months": DETER_MONTHS, "count": len(feats), "docs": DETER_DOCS,
            "selection": "Polígonos que intersectam o limite IBGE do município (a atribuição municipal do INPE pode divergir).",
            "caveat": "Aviso para fiscalização (não é a taxa oficial PRODES); mapeado em imagens de 56–64 m; nuvens atrasam o mapeamento."}}
