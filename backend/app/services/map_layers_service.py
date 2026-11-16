"""Camadas de referência para o mapa (com atributos para pop-up): terras indígenas, UCs, quilombolas, assentamentos e
rodovias federais, simplificadas conforme a escala. Fontes oficiais via GeoServer do Censipam (FUNAI, ICMBio, CNUC,
INCRA, DNIT)."""

from __future__ import annotations

import asyncio
import time as _time

import shapely
from shapely.geometry import mapping, shape

from app.core.errors import AppError
from app.core.heavy import run_heavy
from app.domain.regions import Region, RegionRegistry
from app.integrations.censipam import LAYERS, CensipamClient
from app.services.indigenous_service import ROADS

CACHE_SECONDS = 1800
CATEGORY = {"terras_indigenas": "indigenous", "ucs_federais": "conservation", "ucs_estaduais": "conservation",
            "quilombolas": "quilombola", "assentamentos": "settlement"}


def _props(lid: str, p: dict) -> dict:
    if lid == "terras_indigenas":
        return {"name": p.get("terrai_nom"), "peoples": p.get("etnia_nome"), "phase": p.get("fase_ti"), "unit": p.get("undadm_sig") or p.get("cr"),
                "area_ha": p.get("superficie"), "source": "FUNAI"}
    if lid == "ucs_federais":
        return {"name": p.get("nome"), "category_name": p.get("sigla"), "group": p.get("siglagrupo"), "created": p.get("anocriacao"), "source": "ICMBio"}
    if lid == "ucs_estaduais":
        return {"name": p.get("nome_uc"), "category_name": p.get("categoria"), "group": p.get("grupo"), "created": p.get("ano_cria"), "source": "MMA/CNUC"}
    if lid == "quilombolas":
        return {"name": p.get("nm_comunid"), "families": p.get("nr_familia"), "titled": p.get("dt_titulac"), "source": "INCRA"}
    if lid == "assentamentos":
        return {"name": p.get("nome_proje"), "families": p.get("num_famili"), "capacity": p.get("capacidade"), "kind_name": p.get("tipo"), "source": "INCRA"}
    return {}


class MapLayersService:
    def __init__(self, regions: RegionRegistry, censipam: CensipamClient) -> None:
        self._regions = regions
        self._censipam = censipam
        self._memo: dict[tuple, tuple[float, dict]] = {}

    async def layers(self, region_id: str) -> dict:
        region = self._regions.get(region_id)
        key = (region_id, int(_time.time() // CACHE_SECONDS))
        if key in self._memo:
            return self._memo[key][1]
        level = region.definition.level
        w, s, e, n = region.bbox
        pad = 0.2
        bbox = (w - pad, s - pad, e + pad, n + pad)
        ids = ["terras_indigenas", "ucs_federais", "ucs_estaduais", "quilombolas"] + (["assentamentos"] if level == "municipio" else [])
        if level == "bioma":
            ids = ["terras_indigenas"]
        tasks = {lid: self._censipam.layer_bbox(LAYERS[lid], bbox) for lid in ids}
        tasks["roads"] = self._censipam.layer_bbox(ROADS, bbox)
        res = dict(zip(tasks, await asyncio.gather(*tasks.values(), return_exceptions=True), strict=True))
        for v in res.values():
            if isinstance(v, BaseException) and not isinstance(v, AppError):
                raise v
        out = await run_heavy(self._build, region, res)
        self._memo = {k: v for k, v in self._memo.items() if k[1] == key[1]}
        self._memo[key] = (_time.monotonic(), out)
        return out

    @staticmethod
    def _build(region: Region, res: dict) -> dict:
        level = region.definition.level
        tol = {"municipio": 0.001, "estado": 0.004, "pais": 0.01, "bioma": 0.01}.get(level, 0.004)
        rg = region.geometry
        polys, roads, sources = [], [], {}
        for lid, r in res.items():
            if isinstance(r, BaseException):
                sources[lid] = {"available": False, "reason": getattr(r, "message", str(r))}
                continue
            feats = (r.data or {}).get("features", []) if isinstance(r.data, dict) else []
            sources[lid] = {"available": True, "features": len(feats), "fetched_at": r.fetched_at.isoformat(timespec="seconds")}
            for f in feats:
                if not f.get("geometry"):
                    continue
                try:
                    g = shapely.make_valid(shape(f["geometry"]))
                except Exception:  # noqa: BLE001
                    continue
                if not rg.intersects(g.envelope):
                    continue
                g = shapely.simplify(g, tol, preserve_topology=True)
                p = f.get("properties", {})
                if lid == "roads":
                    roads.append({"type": "Feature", "geometry": mapping(g), "properties": {
                        "name": f"BR-{p.get('vl_br')}" if p.get("vl_br") else "rodovia federal", "surface": p.get("ds_superfi"),
                        "legend": p.get("ds_legenda"), "from": p.get("ds_local_i"), "to": p.get("ds_local_f"), "source": "DNIT"}})
                else:
                    polys.append({"type": "Feature", "geometry": mapping(g), "properties": {"category": CATEGORY[lid], "layer": lid, **_props(lid, p)}})
        return {"region": region.summary(), "areas": {"type": "FeatureCollection", "features": polys},
                "roads": {"type": "FeatureCollection", "features": roads}, "sources": sources,
                "note": "Geometrias oficiais simplificadas para exibição (Censipam GeoServer: FUNAI, ICMBio, CNUC, INCRA, DNIT)."}
