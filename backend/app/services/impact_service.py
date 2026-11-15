"""Pessoas e infraestrutura perto das detecções: proximidade e exposição potencial.

Regras desta camada (Missão 03):
* Proximidade e exposição potencial são informações DIFERENTES de dano confirmado.
* Não se estima "pessoas afetadas". A exposição potencial usa setores censitários do
  Censo 2022 e é um LIMITE SUPERIOR: soma a população inteira dos setores que tocam
  o raio, logo é ≥ ao número real de residentes no raio.
* Distâncias são calculadas em projeção azimutal equidistante centrada no território.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer

from app.core.errors import AppError
from app.domain.regions import RegionRegistry
from app.integrations.censipam import WFS_BASE, CensipamClient
from app.integrations.cnes import CnesClient
from app.integrations.ibge import BC250_LAYERS, ibge_wfs_bbox
from app.persistence.census_tracts import reference_meta, tracts_for_municipality
from app.services.detections_service import DetectionsService, detections_in_bbox

log = logging.getLogger("app.impact")

RADII_KM = (1, 5, 10)
EXPOSURE_RADIUS_KM = 5
BBOX_MARGIN_DEG = 0.12  # ~13 km: inclui detecções logo além da divisa
HEALTH_TYPES_FOR_EMERGENCY = {5: "Hospital geral", 7: "Hospital especializado", 15: "Unidade mista", 20: "Pronto-socorro geral",
                              21: "Pronto-socorro especializado", 73: "Pronto atendimento", 42: "Unidade móvel pré-hospitalar (urgência)"}


def _iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


class _Projector:
    def __init__(self, lon0: float, lat0: float) -> None:
        self._t = Transformer.from_crs("EPSG:4326", f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=m", always_xy=True)

    def points(self, lon, lat) -> np.ndarray:
        x, y = self._t.transform(np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))
        return np.column_stack([x, y])

    def geom(self, g):
        return shapely.transform(g, lambda c: self.points(c[:, 0], c[:, 1]))


def nearest_distances_km(targets_xy: np.ndarray, dets_xy: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Distância (km) de cada alvo à detecção mais próxima e o índice dela."""
    if len(dets_xy) == 0 or len(targets_xy) == 0:
        return np.full(len(targets_xy), np.nan), np.full(len(targets_xy), -1)
    d = np.sqrt(((targets_xy[:, None, :] - dets_xy[None, :, :]) ** 2).sum(axis=2)) / 1000.0
    idx = d.argmin(axis=1)
    return d[np.arange(len(targets_xy)), idx], idx


def point_proximity(points: list[dict], dets: pd.DataFrame, proj: _Projector) -> list[dict]:
    """Para cada ponto (lon, lat): distância à detecção mais próxima e contagens por raio."""
    if not points:
        return []
    pxy = proj.points([p["lon"] for p in points], [p["lat"] for p in points])
    dxy = proj.points(dets["longitude"], dets["latitude"]) if not dets.empty else np.empty((0, 2))
    dist, idx = nearest_distances_km(pxy, dxy)
    out = []
    for i, p in enumerate(points):
        item = {**p, "nearest_detection_km": None if np.isnan(dist[i]) else round(float(dist[i]), 2)}
        if len(dxy):
            all_d = np.sqrt(((dxy - pxy[i]) ** 2).sum(axis=1)) / 1000.0
            item["detections_within_km"] = {str(r): int((all_d <= r).sum()) for r in RADII_KM}
            if idx[i] >= 0:
                t = dets["acq_datetime_utc"].iloc[int(idx[i])]
                item["nearest_detection_time_utc"] = t.isoformat().replace("+00:00", "Z") if pd.notna(t) else None
                item["nearest_detection_product"] = dets["product_id"].iloc[int(idx[i])]
        else:
            item["detections_within_km"] = {str(r): 0 for r in RADII_KM}
        out.append(item)
    return sorted(out, key=lambda x: (x["nearest_detection_km"] is None, x["nearest_detection_km"] or 0))


def tract_exposure(tracts: tuple[dict, ...], dets: pd.DataFrame, proj: _Projector, radius_km: float = EXPOSURE_RADIUS_KM) -> dict:
    """Exposição potencial (limite superior) por setor censitário."""
    total_pop = sum(t["population"] for t in tracts)
    if not tracts:
        return {"available": False, "reason": "Setores censitários indisponíveis para o território."}
    if dets.empty:
        return {"available": True, "radius_km": radius_km, "tracts_total": len(tracts), "population_total": total_pop,
                "tracts_within_radius": 0, "population_upper_bound": 0, "tracts_with_detection_inside": 0,
                "population_in_tracts_with_detection_inside": 0, "top_tracts": []}
    dxy = proj.points(dets["longitude"], dets["latitude"])
    pts = shapely.points(dxy)
    tree = shapely.STRtree(pts)
    rows = []
    for t in tracts:
        g = proj.geom(t["geometry"])
        near = tree.query(g, predicate="dwithin", distance=radius_km * 1000.0)
        inside = tree.query(g, predicate="contains")
        nd = float(shapely.distance(g, pts[tree.nearest(g)])) / 1000.0
        rows.append({"cd_setor": t["cd_setor"], "situacao": t["situacao"], "area_km2": round(t["area_km2"], 2),
                     "population": t["population"], "detections_within_radius": int(len(near)),
                     "detections_inside": int(len(inside)), "nearest_detection_km": round(nd, 2)})
    within = [r for r in rows if r["detections_within_radius"] > 0]
    inside = [r for r in rows if r["detections_inside"] > 0]
    ub = sum(r["population"] for r in within)
    return {
        "available": True,
        "radius_km": radius_km,
        "tracts_total": len(rows),
        "population_total": total_pop,
        "tracts_within_radius": len(within),
        "population_upper_bound": ub,
        "population_upper_bound_share_pct": round(100 * ub / total_pop, 1) if total_pop else None,
        "tracts_with_detection_inside": len(inside),
        "population_in_tracts_with_detection_inside": sum(r["population"] for r in inside),
        "urban_tracts_within_radius": sum(1 for r in within if r["situacao"] == "Urbana"),
        "top_tracts": sorted(within, key=lambda r: -r["population"])[:12],
    }


class ImpactService:
    def __init__(self, detections: DetectionsService, regions: RegionRegistry, http, cache, censipam: CensipamClient,
                 cnes: CnesClient, tracts_gpkg: str) -> None:
        self._det = detections
        self._regions = regions
        self._http = http
        self._cache = cache
        self._censipam = censipam
        self._cnes = cnes
        self._gpkg = tracts_gpkg

    async def impact(self, region_id: str) -> dict:
        region = self._regions.get(region_id)
        if region.definition.level != "municipio":
            return {"available": False, "kind": "ausente", "region": region.summary(),
                    "reason": "A análise de proximidade é feita por município (setores, CNES e localidades por município)."}
        w, s, e, n = region.bbox
        m = BBOX_MARGIN_DEG
        ebbox = (w - m, s - m, e + m, n + m)
        lon0, lat0 = region.centroid
        proj = _Projector(lon0, lat0)

        dets_task = detections_in_bbox(self._det, ebbox)
        loc_task = ibge_wfs_bbox(self._http, self._cache, BC250_LAYERS["localidades"], ebbox)
        air_task = ibge_wfs_bbox(self._http, self._cache, BC250_LAYERS["pistas_pouso"], region.bbox)
        cnes_task = self._cnes.establishments(region.definition.ibge_code)
        types_task = self._cnes.unit_types()
        brig_task = self._censipam.layer_bbox(_BRIGADES, (w - 1.5, s - 1.5, e + 1.5, n + 1.5))
        (dets_res, loc_res, air_res, cnes_res, types_res, brig_res) = await asyncio.gather(
            dets_task, loc_task, air_task, cnes_task, types_task, brig_task, return_exceptions=True)
        for r in (dets_res, loc_res, air_res, cnes_res, types_res, brig_res):
            if isinstance(r, BaseException) and not isinstance(r, AppError):
                raise r

        if isinstance(dets_res, BaseException):
            dets, det_prov = pd.DataFrame(), [{"available": False, "error": dets_res.message}]
        else:
            dets, det_prov = dets_res
        out: dict = {
            "available": True,
            "region": region.summary(),
            "generated_at": _iso_now(),
            "detections_used": {
                "window": "7d", "products": ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"], "count": int(len(dets)),
                "area": "retângulo do município ampliado em ~13 km (inclui focos logo além da divisa)",
                "provenance": det_prov, "kind": "observacao",
            },
            "method": "Distâncias em projeção azimutal equidistante centrada no território. Raios: 1, 5 e 10 km. "
                      "Proximidade não indica dano; exposição potencial é limite superior.",
        }

        # ------------------------------------------------ localidades (IBGE BC250 2025)
        if isinstance(loc_res, BaseException):
            out["localities"] = {"available": False, "kind": "ausente", "reason": loc_res.message}
        else:
            feats = (loc_res["data"] or {}).get("features", [])
            pts = []
            for f in feats:
                lon, lat = f["geometry"]["coordinates"][:2]
                if not region.contains([lon], [lat])[0]:
                    continue
                p = f["properties"]
                pts.append({"name": p.get("identificador") or "(sem nome)", "type": p.get("tipolocalidade"),
                            "lon": lon, "lat": lat, "approximate": p.get("geometriaaproximada") == "Sim"})
            items = point_proximity(pts, dets, proj)
            out["localities"] = {
                "available": True, "kind": "observacao", "proximity_kind": "estimativa",
                "source": "IBGE — Base Cartográfica Contínua 1:250.000, edição 2025 (posição geográfica de localidades)",
                "url": loc_res["url"], "fetched_at": loc_res["fetched_at"],
                "count": len(items), "by_type": pd.Series([i["type"] for i in items]).value_counts().to_dict() if items else {},
                "within_5km": sum(1 for i in items if (i["detections_within_km"] or {}).get("5", 0) > 0),
                "items": items,
                "caveat": "Escala 1:250.000: localidades pequenas podem não estar mapeadas; aldeias e comunidades tradicionais "
                          "não cadastradas não aparecem.",
            }

        # ------------------------------------------------ unidades de saúde (CNES)
        if isinstance(cnes_res, BaseException):
            out["health"] = {"available": False, "kind": "ausente", "reason": cnes_res.message}
        else:
            types = types_res if not isinstance(types_res, BaseException) else {}
            pts, no_coord = [], 0
            for x in cnes_res["items"]:
                la, lo = x.get("latitude_estabelecimento_decimo_grau"), x.get("longitude_estabelecimento_decimo_grau")
                if la is None or lo is None:
                    no_coord += 1
                    continue
                code = x.get("codigo_tipo_unidade")
                pts.append({"name": x.get("nome_fantasia") or x.get("nome_razao_social"), "cnes": x.get("codigo_cnes"),
                            "type_code": code, "type": types.get(int(code)) if code is not None else None,
                            "emergency_capable": int(code) in HEALTH_TYPES_FOR_EMERGENCY if code is not None else False,
                            "hospital_care": x.get("estabelecimento_possui_atendimento_hospitalar") == 1,
                            "lon": float(lo), "lat": float(la),
                            "coordinate_inside_territory": bool(region.contains([float(lo)], [float(la)])[0])})
            items = point_proximity(pts, dets, proj)
            out["health"] = {
                "available": True, "kind": "observacao", "proximity_kind": "estimativa",
                "source": "CNES — Cadastro Nacional de Estabelecimentos de Saúde (API de dados abertos do Ministério da Saúde)",
                "url": cnes_res["url"], "fetched_at": cnes_res["fetched_at"],
                "count_registered": len(cnes_res["items"]), "count_with_coordinates": len(items), "without_coordinates": no_coord,
                "hospital_care_count": sum(1 for i in items if i["hospital_care"]),
                "within_5km": sum(1 for i in items if (i["detections_within_km"] or {}).get("5", 0) > 0),
                "items": items,
                "caveat": "Coordenadas declaradas no cadastro; algumas podem estar imprecisas. Proximidade não indica dano à unidade.",
            }

        # ------------------------------------------------ setores censitários (Censo 2022)
        tracts = tracts_for_municipality(self._gpkg, region.definition.ibge_code)
        expo = tract_exposure(tracts, dets, proj)
        meta = reference_meta(self._gpkg)
        out["exposure"] = {
            **expo, "kind": "estimativa" if expo.get("available") else "ausente",
            "label": f"População residente em setores censitários a até {EXPOSURE_RADIUS_KM} km de detecções (limite superior)",
            "source": "IBGE — Censo 2022, agregados por setores censitários (V0001 = Total de pessoas)",
            "source_url": meta.get("url"), "source_sha256": meta.get("sha256"), "source_fetched_at": meta.get("fetched_at"),
            "method": f"Setor conta se qualquer parte dele está a até {EXPOSURE_RADIUS_KM} km de uma detecção VIIRS dos últimos "
                      "7 dias; soma-se a população inteira do setor. Setores multipartes do arquivo são unidos (contados uma vez).",
            "caveat": "Exposição potencial (limite superior), não pessoas afetadas. Setores rurais são grandes e a população "
                      "se concentra ao longo dos rios; a soma superestima quem de fato vive perto das detecções.",
            "reason": expo.get("reason") or (None if tracts else "Base de setores ausente: rode python -m scripts.fetch_reference"),
        }

        # ------------------------------------------------ infraestrutura e resposta
        infra: dict = {"kind": "observacao"}
        if isinstance(air_res, BaseException):
            infra["airstrips"] = {"available": False, "reason": air_res.message}
        else:
            ap = []
            for f in (air_res["data"] or {}).get("features", []):
                lon, lat = f["geometry"]["coordinates"][:2]
                if region.contains([lon], [lat])[0]:
                    p = f["properties"]
                    ap.append({"name": p.get("nome") or "(sem nome)", "surface": p.get("revestimento"), "use": p.get("usopista"),
                               "length_m": p.get("extensao"), "operational": p.get("operacional"), "lon": lon, "lat": lat})
            infra["airstrips"] = {"available": True, "items": ap, "count": len(ap),
                                  "source": "IBGE — BC250 2025 (pistas e pontos de pouso)", "url": air_res["url"]}
        if isinstance(brig_res, BaseException):
            infra["brigades"] = {"available": False, "reason": brig_res.message}
        else:
            bp = [{"name": f["properties"].get("nome"), "agency": f["properties"].get("orgao_responsavel"),
                   "municipality": f["properties"].get("municipio"), "uf": f["properties"].get("uf"),
                   "lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1]}
                  for f in (brig_res.data or {}).get("features", []) if f.get("geometry")]
            cxy = proj.points([lon0], [lat0])
            for b in bp:
                bxy = proj.points([b["lon"]], [b["lat"]])
                b["distance_from_centroid_km"] = round(float(np.linalg.norm(bxy - cxy)) / 1000.0, 1)
                b["inside_territory"] = bool(region.contains([b["lon"]], [b["lat"]])[0])
            bp.sort(key=lambda b: b["distance_from_centroid_km"])
            infra["brigades"] = {"available": True, "items": bp[:6], "inside_territory": sum(1 for b in bp if b["inside_territory"]),
                                 "source": "Censipam — GeoServer Panorama (tb_brigada_pto)", "url": WFS_BASE,
                                 "note": "Distância em linha reta a partir do centroide do município (não é tempo de deslocamento)."}
        out["infrastructure"] = infra
        out["not_integrated"] = ["Escolas (INEP)", "Aldeias e comunidades tradicionais não cadastradas na BC250",
                                 "Rodovias e linhas de energia (disponíveis no IBGE/Censipam; não cruzadas nesta versão)"]
        return out


class _BrigadeLayer:
    id = "brigadas"
    layer = "painel_do_fogo:tb_brigada_pto"


_BRIGADES = _BrigadeLayer()
