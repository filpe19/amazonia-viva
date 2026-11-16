"""Alertas para Terras Indígenas: fogo detectado dentro da TI ou no entorno (≤ 10 km), com contexto social.

Regras (Missão 08):
* Regras de alerta explícitas, sem pontuação:
    - "inside_confirmed": ≥ 1 detecção com centro do pixel dentro da TI, vista em ≥ 2 passagens distintas de satélite;
    - "inside": detecção dentro da TI em uma única passagem;
    - "surroundings": nenhuma dentro, ≥ 1 detecção fora a ≤ 10 km do limite.
* População = residentes na TI segundo o Censo 2022 (IBGE, tabela 9719). Não é estimativa de pessoas afetadas.
* Indícios de origem (mineração/garimpo, desmatamento) são coincidências espaciais com bases oficiais (ANM, INPE),
  nunca prova de causa. Não é alerta oficial.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time as _time
import unicodedata
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer
from shapely.geometry import mapping, shape

from app.core.errors import AppError, UpstreamError
from app.core.heavy import run_heavy
from app.domain.regions import Region, RegionRegistry
from app.integrations.censipam import LAYERS, CensipamClient, LayerDef
from app.integrations.deter import DETER_CLASSES, deter_bbox
from app.services.detections_service import DetectionsService, detections_in_bbox

log = logging.getLogger("app.indigenous")

ALL_PRODUCTS = "VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT,MODIS_NRT"
SURROUNDINGS_KM = 10.0
RECENT_HOURS = 24
EVIDENCE_MAX_TIS = 20
CACHE_SECONDS = 1800
SIDRA_TI_POP = ("https://servicodados.ibge.gov.br/api/v3/agregados/9719/periodos/2022/variaveis/576%7C1432"
                "?localidades=N125%5Ball%5D&classificacao=1714%5B60024%5D")
SIDRA_SOURCE = "IBGE — Censo Demográfico 2022, tabela 9719 (residentes em terras indígenas, por TI e UF)"
ANM_MAPSERVER = "https://geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/MapServer"
ANM_SOURCE = "ANM — SIGMINE (processos minerários ativos e reservas garimpeiras)"
ROADS = LayerDef("rodovias_federais", "painel_do_fogo:dnit_rodovias_federais", "Rodovias federais", "DNIT — Sistema Nacional de Viação",
                 "vl_br", ("sg_uf", "ds_superfi", "ds_legenda"))
BRIGADES = LayerDef("brigadas", "painel_do_fogo:tb_brigada_pto", "Brigadas", "Censipam", "nome", ("orgao_responsavel", "municipio", "uf"))
UF_CODES = {"RO": "11", "AC": "12", "AM": "13", "RR": "14", "PA": "15", "AP": "16", "TO": "17", "MA": "21", "PI": "22", "CE": "23",
            "RN": "24", "PB": "25", "PE": "26", "AL": "27", "SE": "28", "BA": "29", "MG": "31", "ES": "32", "RJ": "33", "SP": "35",
            "PR": "41", "SC": "42", "RS": "43", "MS": "50", "MT": "51", "GO": "52", "DF": "53"}
PUBLIC_CHANNELS = [
    {"name": "Corpo de Bombeiros", "contact": "193"},
    {"name": "Defesa Civil", "contact": "199"},
    {"name": "Ibama — Linha Verde (denúncias ambientais; aciona o Prevfogo)", "contact": "0800 061 8080"},
]
DISCLAIMER = ("Alertas calculados pela plataforma com regras públicas, para apoiar a triagem. Não são alertas oficiais e não "
              "confirmam incêndio, causa ou dano. A população indicada é a residente na TI segundo o Censo 2022, não pessoas afetadas.")


def norm_name(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def name_variants(name: str) -> list[str]:
    """Nome FUNAI → variantes para casar com a lista do Censo (parênteses, sufixos ' - ...')."""
    base = re.sub(r"\(.*?\)", "", name or "").strip()
    out = [norm_name(name), norm_name(base), norm_name(base.split(" - ")[0])]
    return list(dict.fromkeys(v for v in out if v))


def parse_census(payload: list) -> dict[tuple[str, str], dict]:
    """SIDRA 9719 (N125: TI por UF) → {(nome normalizado, UF): {residents, indigenous}}."""
    out: dict[tuple[str, str], dict] = {}
    for var in payload:
        key = "residents" if str(var.get("id")) == "576" else "indigenous"
        for s in var["resultados"][0]["series"]:
            name, _, uf = s["localidade"]["nome"].rpartition(" - ")
            raw = s["serie"].get("2022")
            val = 0 if raw == "-" else (None if raw in (None, "X", "...", "..") else int(raw))
            item = out.setdefault((norm_name(name), uf), {"census_name": f"{name} - {uf}"})
            item[key] = val
    return out


def esri_rings_to_geom(rings: list):
    """Anéis Esri (externos no sentido horário, furos no anti-horário) → geometria shapely."""
    outers, holes = [], []
    for r in rings:
        if len(r) < 4:
            continue
        ring = shapely.LinearRing(r)
        poly = shapely.make_valid(shapely.Polygon(r))
        (holes if ring.is_ccw else outers).append(poly)
    if not outers:
        return None
    g = shapely.union_all(outers)
    return g.difference(shapely.union_all(holes)) if holes else g


def _iso(ts) -> str | None:
    if ts is None or pd.isna(ts):
        return None
    if isinstance(ts, pd.Timestamp):
        ts = ts.to_pydatetime()
    return ts.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _local(lon0: float, lat0: float) -> Transformer:
    return Transformer.from_crs("EPSG:4326", f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=m", always_xy=True)


def _proj_geom(t: Transformer, g):
    return shapely.transform(g, lambda c: np.column_stack(t.transform(c[:, 0], c[:, 1])))


class IndigenousService:
    def __init__(self, detections: DetectionsService, regions: RegionRegistry, http, cache, censipam: CensipamClient,
                 reference_dir: Path | None = None) -> None:
        self._det = detections
        self._regions = regions
        self._http = http
        self._cache = cache
        self._censipam = censipam
        self._ref = reference_dir
        self._memo: dict[tuple, tuple[float, dict]] = {}
        self._inflight: dict[tuple, asyncio.Future] = {}
        self._foreign: list[dict] | None = None

    # ------------------------------------------------------------- fontes auxiliares
    async def census(self) -> dict:
        key = f"sidra:{SIDRA_TI_POP}"
        entry = self._cache.get(key)
        if entry and entry.is_fresh(30 * 86_400):
            return {"data": parse_census(json.loads(entry.content)), "url": SIDRA_TI_POP, "fetched_at": entry.meta["fetched_at"]}
        try:
            res = await self._http.get(SIDRA_TI_POP, source="IBGE SIDRA")
            data = parse_census(json.loads(res.content))
        except (UpstreamError, ValueError, KeyError):
            if entry:
                return {"data": parse_census(json.loads(entry.content)), "url": SIDRA_TI_POP, "fetched_at": entry.meta["fetched_at"], "stale": True}
            raise
        meta = self._cache.put(key, res.content, {"url": SIDRA_TI_POP, "fetched_at": datetime.now(UTC).isoformat()})
        return {"data": data, "url": SIDRA_TI_POP, "fetched_at": meta["fetched_at"]}

    async def anm(self, bbox: tuple[float, float, float, float]) -> tuple[list[dict], bool]:
        """Processos minerários ativos (camada 0) e reservas garimpeiras (camada 4) que intersectam o retângulo."""
        w, s, e, n = bbox
        feats: list[dict] = []
        partial = False
        for layer in (0, 4):
            # f=json (Esri): a saída geojson deste servidor volta vazia com limite de registros.
            params = {"geometry": f"{w:.4f},{s:.4f},{e:.4f},{n:.4f}", "geometryType": "esriGeometryEnvelope", "inSR": "4326",
                      "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": "4326",
                      "returnGeometry": "true", "geometryPrecision": "5", "f": "json"}
            url = f"{ANM_MAPSERVER}/{layer}/query?{urlencode(params)}"
            key = f"anm:{url}"
            entry = self._cache.get(key)
            if entry and entry.is_fresh(86_400):
                body = entry.content
            else:
                res = await self._http.get(url, source="ANM SIGMINE")
                body = res.content
                self._cache.put(key, body, {"url": url, "fetched_at": datetime.now(UTC).isoformat()})
            payload = json.loads(body)
            if "error" in payload:
                raise UpstreamError("ANM SIGMINE devolveu erro", source="ANM SIGMINE", detail=payload["error"])
            partial = partial or bool(payload.get("exceededTransferLimit"))
            for f in payload.get("features", []):
                g = esri_rings_to_geom((f.get("geometry") or {}).get("rings") or [])
                if g is None:
                    continue
                props = dict(f.get("attributes") or {})
                props["_layer"] = "reserva_garimpeira" if layer == 4 else "processo"
                feats.append({"geom": g, "properties": props})
        return feats, partial

    def _foreign_shapes(self) -> list[tuple]:
        if not hasattr(self, "_foreign_geoms"):
            self._foreign_geoms = [(shape(f["geometry"]), f.get("properties", {})) for f in self._foreign_lands()]
        return self._foreign_geoms

    def _foreign_lands(self) -> list[dict]:
        """Terras indígenas dos demais países amazônicos (OTCA), pré-processadas por scripts.fetch_amazonia."""
        if self._foreign is None:
            p = (self._ref / "otca_indigenous_lands.geojson") if self._ref else None
            self._foreign = json.loads(p.read_text("utf-8"))["features"] if p and p.exists() else []
        return self._foreign

    # ------------------------------------------------------------- principal
    async def alerts(self, region_id: str, window: str = "7d") -> dict:
        region = self._regions.get(region_id)
        key = (region_id, window, int(_time.time() // CACHE_SECONDS))
        if key in self._memo:
            return self._memo[key][1]
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.ensure_future(self._compute(region, window))
            self._inflight[key] = task
        try:
            out = await asyncio.shield(task)
        finally:
            if task.done():
                self._inflight.pop(key, None)
        self._memo = {k: v for k, v in self._memo.items() if k[2] == key[2]}
        self._memo[key] = (_time.monotonic(), out)
        return out

    async def _compute(self, region: Region, window: str) -> dict:
        now = datetime.now(UTC)
        level = region.definition.level
        w, s, e, n = region.bbox
        pad = 0.15
        bbox = (w - pad, s - pad, e + pad, n + pad)
        ti_task = self._censipam.layer_bbox(LAYERS["terras_indigenas"], bbox)
        roads_task = self._censipam.layer_bbox(ROADS, bbox)
        brig_task = self._censipam.layer_bbox(BRIGADES, (w - 1.5, s - 1.5, e + 1.5, n + 1.5))
        census_task = self.census()
        ti_res, roads_res, brig_res, census_res = await asyncio.gather(ti_task, roads_task, brig_task, census_task, return_exceptions=True)
        for r in (ti_res, roads_res, brig_res, census_res):
            if isinstance(r, BaseException) and not isinstance(r, AppError | UpstreamError | ValueError | KeyError):
                raise r
        sources: dict[str, dict] = {}
        if isinstance(ti_res, BaseException):
            return {"available": False, "region": region.summary(), "reason": getattr(ti_res, "message", str(ti_res)),
                    "sources": {"funai": {"available": False, "reason": getattr(ti_res, "message", str(ti_res))}}}
        sources["funai"] = {"available": True, "label": "FUNAI — Terras indígenas (via Censipam GeoServer)", "url": ti_res.url,
                            "fetched_at": ti_res.fetched_at.isoformat(timespec="seconds"), "stale": ti_res.stale}
        census = {} if isinstance(census_res, BaseException) else census_res["data"]
        sources["census"] = ({"available": True, "label": SIDRA_SOURCE, "url": SIDRA_TI_POP, "fetched_at": census_res["fetched_at"]}
                             if not isinstance(census_res, BaseException) else
                             {"available": False, "label": SIDRA_SOURCE, "reason": getattr(census_res, "message", "IBGE SIDRA não respondeu")})

        # Detecções no retângulo (não recortadas pelo limite: o entorno de uma TI pode estar fora da região)
        frame, det_prov = await detections_in_bbox(self._det, bbox, window, ALL_PRODUCTS, now=now)
        frame = frame.reset_index(drop=True)

        def build():
            # Terras indígenas que tocam a região (Brasil: FUNAI; Amazônia: + OTCA dos demais países)
            lands: list[dict] = []
            rg = region.geometry
            for f in (ti_res.data or {}).get("features", []) if isinstance(ti_res.data, dict) else []:
                try:
                    g = shapely.make_valid(shape(f["geometry"]))
                except Exception:  # noqa: BLE001 — geometria inválida da fonte
                    continue
                if g.is_empty or not rg.intersects(g):
                    continue
                lands.append({"geom": g, "props": f.get("properties", {}), "country": "Brasil"})
            if level == "bioma":
                for g, props in self._foreign_shapes():
                    if rg.intersects(g):
                        lands.append({"geom": g, "props": props, "country": props.get("pais")})
                sources["otca"] = {"available": bool(self._foreign), "label": "OTCA — Terras indígenas dos demais países amazônicos (via Censipam)",
                                   "features": len(self._foreign or [])}

            if not frame.empty:
                pts = shapely.points(frame["longitude"].to_numpy(), frame["latitude"].to_numpy())
                tree = shapely.STRtree(pts)
            roads = [] if isinstance(roads_res, BaseException) else [
                (shape(f["geometry"]), f.get("properties", {})) for f in (roads_res.data or {}).get("features", []) if f.get("geometry")]
            sources["roads"] = ({"available": True, "label": "DNIT — rodovias federais (via Censipam)", "features": len(roads)}
                                if not isinstance(roads_res, BaseException) else {"available": False, "label": "DNIT — rodovias federais", "reason": roads_res.message})
            road_tree = shapely.STRtree([r[0] for r in roads]) if roads else None
            brigades = [] if isinstance(brig_res, BaseException) else [
                f for f in (brig_res.data or {}).get("features", []) if f.get("geometry")]

            large = level in ("bioma", "pais")
            cap_in, cap_out = (40, 10) if large else (200, 120)
            items = []
            for k, land in enumerate(lands):
                g = land["geom"]
                c = g.representative_point()
                t = _local(c.x, c.y)
                deg = SURROUNDINGS_KM / (111.32 * max(0.2, np.cos(np.radians(c.y))))
                if frame.empty:
                    continue
                minx, miny, maxx, maxy = g.bounds
                if not len(tree.query(shapely.box(minx - deg * 1.2, miny - deg * 1.2, maxx + deg * 1.2, maxy + deg * 1.2))):
                    continue  # nenhuma detecção nem perto do retângulo da terra
                cand = np.asarray(tree.query(g, predicate="dwithin", distance=deg * 1.2), dtype=int)
                if not len(cand):
                    continue
                sub = frame.iloc[cand]
                inside_mask = shapely.contains_xy(g, sub["longitude"].to_numpy(), sub["latitude"].to_numpy())
                gxy = _proj_geom(t, g)
                out_idx = cand[~inside_mask]
                dist = np.array([])
                if len(out_idx):
                    ox, oy = t.transform(frame["longitude"].to_numpy()[out_idx], frame["latitude"].to_numpy()[out_idx])
                    dist = shapely.distance(gxy, shapely.points(ox, oy)) / 1000.0
                    keep = dist <= SURROUNDINGS_KM
                    out_idx, dist = out_idx[keep], dist[keep]
                in_idx = cand[inside_mask]
                if not len(in_idx) and not len(out_idx):
                    continue
                inside = frame.iloc[in_idx]
                overpasses = int(inside.groupby(["satellite_name", "acq_datetime_utc"]).ngroups) if len(inside) else 0
                alert = "inside_confirmed" if overpasses >= 2 else ("inside" if len(inside) else "surroundings")
                allsel = frame.iloc[np.concatenate([in_idx, out_idx])]
                last = allsel["acq_datetime_utc"].max()
                p = land["props"]
                brazil = land["country"] == "Brasil"
                name = p.get("terrai_nom") or p.get("name_es") or "(sem nome na fonte)"
                ufs = [u.strip() for u in re.split(r"[,/;\s]+", p.get("uf_sigla") or "") if u.strip()]
                pop = self._population(name, ufs, census) if brazil else None
                item = {
                    "id": f"{'funai:' + str(p.get('terrai_cod')) if brazil else 'otca:' + str(p.get('feature_id', k))}",
                    "code": p.get("terrai_cod"), "name": name, "country": land["country"],
                    "peoples": [x.strip() for x in re.split(r"[,;]", p.get("etnia_nome") or "") if x.strip()],
                    "phase": p.get("fase_ti"), "modality": p.get("modalidade"), "area_ha": p.get("superficie"),
                    "ufs": ufs, "municipalities": p.get("municipio_"), "border_zone": p.get("faixa_fron"),
                    "funai_unit": {"name": p.get("undadm_nom") or p.get("cr"), "sigla": p.get("undadm_sig")} if brazil else None,
                    "source": "FUNAI (via Censipam)" if brazil else "OTCA (via Censipam)",
                    "population": pop,
                    "alert": alert,
                    "recent_24h": bool(pd.notna(last) and last >= now - timedelta(hours=RECENT_HOURS)),
                    "inside": self._summ(inside, now, cap_in) | {"overpasses": overpasses},
                    "surroundings": self._summ(frame.iloc[out_idx], now, cap_out, dist) | {"radius_km": SURROUNDINGS_KM},
                    "satellites": sorted(allsel["satellite_name"].unique().tolist()),
                    "last_utc": _iso(last),
                    "bbox": [round(v, 4) for v in g.bounds],
                    "detections_bbox": [round(float(allsel["longitude"].min()), 4), round(float(allsel["latitude"].min()), 4),
                                        round(float(allsel["longitude"].max()), 4), round(float(allsel["latitude"].max()), 4)],
                    "geometry": (None if (large and not len(in_idx)) else
                                 mapping(shapely.simplify(g, 0.01 if large else 0.002, preserve_topology=True))),
                    "access": self._access(allsel, t, road_tree, roads, brigades, c),
                    "evidence": {"evaluated": False},
                }
                items.append(item)

            return lands, items, large

        lands, items, large = await run_heavy(build)
        order = {"inside_confirmed": 0, "inside": 1, "surroundings": 2}
        items.sort(key=lambda x: (order[x["alert"]], -(x["inside"]["count"]), x["last_utc"] or ""))
        await self._evidence([i for i in items if i["alert"] != "surroundings" and i["country"] == "Brasil"][:EVIDENCE_MAX_TIS], frame, now, sources)

        fire_inside = [i for i in items if i["alert"] != "surroundings"]
        surroundings_total = len(items) - len(fire_inside)
        if large:  # escala amazônica/nacional: todas com fogo dentro + as 150 do entorno mais recentes
            rest = sorted((i for i in items if i["alert"] == "surroundings"), key=lambda x: x["last_utc"] or "", reverse=True)
            items = fire_inside + rest[:150]
        residents = [i["population"]["indigenous"] for i in fire_inside if i.get("population") and i["population"].get("indigenous") is not None]
        peoples = sorted({p for i in fire_inside for p in i["peoples"]})
        return {
            "available": True, "official": False, "experimental": True,
            "region": region.summary(), "generated_at": _iso(now), "window": window,
            "disclaimer": DISCLAIMER,
            "rules": {
                "inside_confirmed": "Centro do pixel dentro da TI, em ≥ 2 passagens distintas de satélite na janela.",
                "inside": "Centro do pixel dentro da TI, em uma única passagem.",
                "surroundings": f"Nenhuma detecção dentro; ≥ 1 detecção fora, a até {SURROUNDINGS_KM:g} km do limite.",
                "recent": f"Última detecção há até {RECENT_HOURS} h.",
            },
            "summary": {
                "lands_evaluated": len(lands),
                "lands_with_fire_inside": len(fire_inside),
                "lands_inside_confirmed": sum(1 for i in items if i["alert"] == "inside_confirmed"),
                "lands_surroundings_only": surroundings_total,
                "items_truncated": large and surroundings_total > 150,
                "indigenous_residents_in_lands_with_fire_inside": sum(residents) if residents else None,
                "lands_without_census_match": sum(1 for i in fire_inside if i["country"] == "Brasil" and not i.get("population")),
                "peoples_in_lands_with_fire_inside": peoples,
                "residents_note": "Pessoas indígenas residentes nas TIs com fogo detectado dentro, segundo o Censo 2022. Não são pessoas afetadas.",
            },
            "items": items,
            "public_channels": PUBLIC_CHANNELS,
            "sources": sources | {"detections": {"available": True, "label": "NASA FIRMS NRT (VIIRS NOAA-20/NOAA-21, MODIS)", "products": det_prov}},
            "method": "Detecções da janela no retângulo da região (sem recorte, para incluir o entorno); dentro = centro do pixel no polígono; "
                      f"entorno = distância geodésica local (projeção azimutal centrada em cada TI) até {SURROUNDINGS_KM:g} km do limite.",
        }

    # ------------------------------------------------------------- partes
    @staticmethod
    def _summ(df: pd.DataFrame, now: datetime, cap: int, dist: np.ndarray | None = None) -> dict:
        if df.empty:
            return {"count": 0, "by_satellite": {}, "detections": []}
        order = np.argsort(-df["acq_datetime_utc"].astype("int64").to_numpy())[:cap]
        refs = []
        for j in order:
            r = df.iloc[int(j)]
            ref = {"p": r["product_id"], "id": r["detection_id"], "s": r["satellite_name"], "t": r["acq_datetime_utc"].strftime("%Y-%m-%dT%H:%MZ"),
                   "lon": round(float(r["longitude"]), 5), "lat": round(float(r["latitude"]), 5)}
            if dist is not None:
                ref["d_km"] = round(float(dist[int(j)]), 2)
            refs.append(ref)
        out = {"count": int(len(df)), "by_satellite": {k: int(v) for k, v in df["satellite_name"].value_counts().items()},
               "first_utc": _iso(df["acq_datetime_utc"].min()), "last_utc": _iso(df["acq_datetime_utc"].max()),
               "max_frp_mw": None if df["frp_mw"].dropna().empty else round(float(df["frp_mw"].max()), 1),
               "detections": refs, "truncated": len(df) > cap}
        if dist is not None and len(dist):
            out["nearest_km"] = round(float(np.min(dist)), 2)
        return out

    @staticmethod
    def _population(name: str, ufs: list[str], census: dict) -> dict | None:
        if not census:
            return None
        res = ind = 0
        matched = []
        for uf in ufs or [""]:
            hit = next((census[(v, uf)] for v in name_variants(name) if (v, uf) in census), None)
            if hit:
                matched.append(hit["census_name"])
                res += hit.get("residents") or 0
                ind += hit.get("indigenous") or 0
        if not matched:
            return None
        return {"residents": res, "indigenous": ind, "census_names": matched, "year": 2022, "source": SIDRA_SOURCE,
                "note": "Residentes na TI (Censo 2022); TIs em mais de uma UF somam as partes."}

    @staticmethod
    def _access(sel: pd.DataFrame, t: Transformer, road_tree, roads, brigades, c) -> dict:
        out: dict = {}
        if road_tree is not None and len(sel):
            lon, lat = float(sel["longitude"].median()), float(sel["latitude"].median())
            j = int(road_tree.nearest(shapely.Point(lon, lat)))
            g, p = roads[j]
            px, py = t.transform([lon], [lat])
            d = shapely.distance(_proj_geom(t, g), shapely.Point(px[0], py[0])) / 1000.0
            out["nearest_federal_road"] = {"name": f"BR-{p.get('vl_br')}" if p.get("vl_br") else "rodovia federal", "km": round(float(d), 1),
                                           "surface": p.get("ds_superfi"), "note": "Linha reta da mediana das detecções até a rodovia (DNIT)."}
        if brigades:
            bx, by = t.transform([b["geometry"]["coordinates"][0] for b in brigades], [b["geometry"]["coordinates"][1] for b in brigades])
            d = np.hypot(np.asarray(bx), np.asarray(by)) / 1000.0  # distância ao ponto central da TI (origem da projeção)
            j = int(np.argmin(d))
            p = brigades[j].get("properties", {})
            out["nearest_brigade"] = {"name": (p.get("nome") or "").replace("_", " "), "agency": p.get("orgao_responsavel"),
                                      "municipality": p.get("municipio"), "uf": p.get("uf"), "km": round(float(d[j]), 1),
                                      "note": "Linha reta a partir do ponto central da TI (não é tempo de deslocamento)."}
        return out

    async def _evidence(self, items: list[dict], frame: pd.DataFrame, now: datetime, sources: dict) -> None:
        """Indícios de origem para as detecções dentro de cada TI: mineração (ANM, DETER) e desmatamento recente (DETER)."""
        since = (now - timedelta(days=365)).date()
        anm_ok = deter_ok = None

        async def one(item: dict):
            nonlocal anm_ok, deter_ok
            refs = item["inside"]["detections"]
            if not refs:
                return
            lon = np.array([r["lon"] for r in refs])
            lat = np.array([r["lat"] for r in refs])
            box_ = (float(lon.min()) - 0.01, float(lat.min()) - 0.01, float(lon.max()) + 0.01, float(lat.max()) + 0.01)
            ev: dict = {"evaluated": True, "detections_checked": len(refs)}
            anm_res, deter_res = await asyncio.gather(self.anm(box_), deter_bbox(self._http, self._cache, box_, since), return_exceptions=True)
            if isinstance(anm_res, BaseException):
                anm_ok = False if anm_ok is None else anm_ok
                ev["mining"] = {"available": False}
            else:
                anm_ok = True
                hits, phases, garimpo = 0, {}, 0
                anm_feats, anm_partial = anm_res
                geoms = [(f["geom"], f["properties"]) for f in anm_feats]
                for x, y in zip(lon, lat, strict=True):
                    hit = [pp for gg, pp in geoms if gg.contains(shapely.Point(x, y))]
                    if hit:
                        hits += 1
                        if any(pp.get("_layer") == "reserva_garimpeira" or "GARIMP" in str(pp.get("FASE", "")).upper() for pp in hit):
                            garimpo += 1
                        for pp in hit:
                            k = (f"{pp.get('FASE')} · {pp.get('SUBS') or '—'}" if pp.get("_layer") == "processo"
                                 else f"Reserva garimpeira · {pp.get('NMReservaGarimpeira') or '—'}")
                            phases[k] = phases.get(k, 0) + 1
                ev["mining"] = {"available": True, "partial": anm_partial, "detections_in_mining_areas": hits, "detections_in_garimpo_areas": garimpo,
                                "titles": sorted(phases.items(), key=lambda kv: -kv[1])[:5], "source": ANM_SOURCE}
            if isinstance(deter_res, BaseException):
                deter_ok = False if deter_ok is None else deter_ok
                ev["deter"] = {"available": False}
            else:
                deter_ok = True
                polys = [(shapely.make_valid(shape(f["geometry"])), (f.get("properties") or {}).get("classname")) for f in deter_res["data"].get("features", []) if f.get("geometry")]
                by: dict[str, int] = {}
                for x, y in zip(lon, lat, strict=True):
                    for gg, cls in polys:
                        if gg.contains(shapely.Point(x, y)):
                            grp = DETER_CLASSES.get(cls or "", ("other", cls))[0]
                            by[grp] = by.get(grp, 0) + 1
                            break
                ev["deter"] = {"available": True, "detections_by_group": by, "months": 12}
            item["evidence"] = ev

        await asyncio.gather(*(one(i) for i in items))
        if items:
            sources["anm"] = {"available": bool(anm_ok), "label": ANM_SOURCE, "url": ANM_MAPSERVER,
                              "scope": f"Avaliado para até {EVIDENCE_MAX_TIS} TIs com fogo dentro."}
            sources["deter"] = {"available": bool(deter_ok), "label": "INPE — DETER (12 meses)", "scope": "Avaliado nas mesmas TIs."}
