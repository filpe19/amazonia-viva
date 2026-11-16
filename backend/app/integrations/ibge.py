"""IBGE: população e área territorial do Censo Demográfico 2022 (API de agregados/SIDRA).

Tabela 4714: variável 93 (população residente, pessoas) e 6318 (área da unidade
territorial, km²). https://servicodados.ibge.gov.br/api/docs/agregados?versao=3
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from app.core.errors import UpstreamError
from app.core.http import HttpClient
from app.persistence.cache import FileCache

SIDRA_URL = "https://servicodados.ibge.gov.br/api/v3/agregados/4714/periodos/2022/variaveis/93|6318"
LEVELS = {"municipio": "N6", "estado": "N3", "pais": "N1"}


def parse_population(payload: bytes | str) -> dict:
    data = json.loads(payload)
    out: dict = {}
    for var in data:
        series = var["resultados"][0]["series"]
        if not series:
            continue
        value = series[0]["serie"].get("2022")
        name = series[0]["localidade"]["nome"]
        out["name"] = name
        if var["id"] == "93":
            out["population"] = int(value) if value not in (None, "-", "...") else None
        elif var["id"] == "6318":
            out["area_km2"] = float(value) if value not in (None, "-", "...") else None
    if out.get("population") and out.get("area_km2"):
        out["density_per_km2"] = round(out["population"] / out["area_km2"], 2)
    return out


class IbgeClient:
    def __init__(self, http: HttpClient, cache: FileCache, ttl: int = 30 * 86_400) -> None:
        self._http = http
        self._cache = cache
        self._ttl = ttl

    async def census_2022(self, level: str, code: str) -> dict:
        lvl = LEVELS.get(level)
        if not lvl:
            raise UpstreamError(f"Nível territorial sem dado censitário: {level}", source="IBGE")
        url = f"{SIDRA_URL}?localidades={lvl}[{code}]"
        key = f"ibge:{url}"
        entry = self._cache.get(key)
        if entry and entry.is_fresh(self._ttl):
            return {**parse_population(entry.content), "url": url, "fetched_at": entry.meta["fetched_at"], "cache_hit": True}
        res = await self._http.get(url.replace("[", "%5B").replace("]", "%5D").replace("|", "%7C"), source="IBGE", safe_url=url)
        parsed = parse_population(res.content)
        meta = self._cache.put(key, res.content, {"url": url, "fetched_at": datetime.now(UTC).isoformat()})
        return {**parsed, "url": url, "fetched_at": meta["fetched_at"], "cache_hit": False}


IBGE_WFS = "https://geoservicos.ibge.gov.br/geoserver/wfs"
BC250_LAYERS = {
    "localidades": "CCAR:BC250_2025_lml_posic_geo_localidade_p",
    "pistas_pouso": "CCAR:BC250_2025_aer_pista_ponto_pouso_p",
}


async def ibge_wfs_bbox(http: HttpClient, cache: FileCache, layer: str, bbox: tuple[float, float, float, float],
                        ttl: int = 30 * 86_400) -> dict:
    """Feições de uma camada do WFS do IBGE (Base Cartográfica Contínua 1:250.000, edição 2025) no retângulo."""
    from urllib.parse import urlencode

    w, s, e, n = bbox
    params = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "outputFormat": "application/json",
              "typeNames": layer, "count": 5000, "bbox": f"{s:.4f},{w:.4f},{n:.4f},{e:.4f},urn:ogc:def:crs:EPSG::4674"}
    url = f"{IBGE_WFS}?{urlencode(params)}"
    key = f"ibge-wfs:{url}"
    entry = cache.get(key)
    if entry and entry.is_fresh(ttl):
        return {"data": json.loads(entry.content), "url": url, "fetched_at": entry.meta["fetched_at"], "cache_hit": True}
    res = await http.get(url, source="IBGE geoserviços")
    data = json.loads(res.content)
    meta = cache.put(key, res.content, {"url": url, "fetched_at": datetime.now(UTC).isoformat()})
    return {"data": data, "url": url, "fetched_at": meta["fetched_at"], "cache_hit": False}


async def ibge_municipal_seats(http: HttpClient, cache: FileCache, bbox: tuple[float, float, float, float],
                               ttl: int = 30 * 86_400) -> dict:
    """Sedes municipais da BC250 2025: tipolocalidade 'Cidade' (sede da prefeitura) ou 'Capital' (capital estadual)."""
    from urllib.parse import urlencode

    w, s, e, n = bbox
    params = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "outputFormat": "application/json",
              "typeNames": BC250_LAYERS["localidades"], "count": 2000,
              # EPSG:4674 no GeoServer usa ordem lat,lon no BBOX do CQL
              "CQL_FILTER": f"tipolocalidade IN ('Cidade','Capital') AND BBOX(geom,{s:.4f},{w:.4f},{n:.4f},{e:.4f})"}
    url = f"{IBGE_WFS}?{urlencode(params)}"
    key = f"ibge-wfs:{url}"
    entry = cache.get(key)
    if entry and entry.is_fresh(ttl):
        return {"data": json.loads(entry.content), "url": url, "fetched_at": entry.meta["fetched_at"], "cache_hit": True}
    res = await http.get(url, source="IBGE geoserviços")
    data = json.loads(res.content)
    meta = cache.put(key, res.content, {"url": url, "fetched_at": datetime.now(UTC).isoformat()})
    return {"data": data, "url": url, "fetched_at": meta["fetched_at"], "cache_hit": False}
