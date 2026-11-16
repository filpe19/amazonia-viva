"""INPE DETER (Amazônia): avisos de alteração na cobertura florestal, via WFS público do TerraBrasilis.

* Camada pública `deter-amz:deter_amz` (sem autenticação; a camada controlada `deter_amz_auth` não é usada).
* Polígonos mapeados em imagens AWFI/WFI (CBERS-4, CBERS-4A, Amazonia-1; 56–64 m), por município (`mun_geocod` = código IBGE).
* DETER é um sistema de AVISO para fiscalização: não é a taxa oficial de desmatamento (PRODES) e cobre só a máscara
  de floresta do bioma; nuvens atrasam ou impedem o mapeamento.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from urllib.parse import urlencode

from app.core.errors import UpstreamError
from app.core.http import HttpClient
from app.persistence.cache import FileCache

DETER_WFS = "https://terrabrasilis.dpi.inpe.br/geoserver/deter-amz/ows"
DETER_SOURCE = "INPE — DETER Amazônia (TerraBrasilis)"
DETER_DOCS = "https://terrabrasilis.dpi.inpe.br/"

# Classes publicadas na camada e o grupo usado na interface.
DETER_CLASSES: dict[str, tuple[str, str]] = {
    "DESMATAMENTO_CR": ("deforestation", "Desmatamento com solo exposto (corte raso)"),
    "DESMATAMENTO_VEG": ("deforestation", "Desmatamento com vegetação"),
    "MINERACAO": ("mining", "Mineração"),
    "DEGRADACAO": ("degradation", "Degradação"),
    "CICATRIZ_DE_QUEIMADA": ("burn_scar", "Cicatriz de incêndio florestal"),
    "CS_DESORDENADO": ("selective_logging", "Corte seletivo desordenado"),
    "CS_GEOMETRICO": ("selective_logging", "Corte seletivo geométrico"),
}


async def deter_bbox(http: HttpClient, cache: FileCache, bbox: tuple[float, float, float, float], since: date,
                     ttl: int = 6 * 3600) -> dict:
    """Avisos DETER no retângulo desde `since` (data da imagem). O recorte pelo limite IBGE é feito por quem consome:
    a atribuição municipal do INPE (`mun_geocod`) pode divergir da malha IBGE vigente. Cópia anterior em caso de falha."""
    w, s, e, n = bbox
    params = {
        "service": "WFS", "version": "1.0.0", "request": "GetFeature", "typeName": "deter-amz:deter_amz",
        "outputFormat": "application/json", "maxFeatures": 10000,
        "propertyName": "gid,classname,view_date,areamunkm,satellite,sensor,mun_geocod,geom",
        # WFS 1.0.0 + CQL: BBOX e coordenadas na ordem lon, lat (SIRGAS 2000; diferença para WGS84 < 1 m)
        "CQL_FILTER": f"view_date>='{since.isoformat()}' AND BBOX(geom,{w:.4f},{s:.4f},{e:.4f},{n:.4f})",
    }
    url = f"{DETER_WFS}?{urlencode(params)}"
    key = f"deter:{url}"
    entry = cache.get(key)
    if entry and entry.is_fresh(ttl):
        return {"data": json.loads(entry.content), "url": url, "fetched_at": entry.meta["fetched_at"], "cache_hit": True, "stale": False}
    try:
        res = await http.get(url, source=DETER_SOURCE)
        data = json.loads(res.content)
        if not isinstance(data, dict) or "features" not in data:
            raise ValueError("resposta sem 'features'")
    except (UpstreamError, ValueError) as exc:
        if entry:
            return {"data": json.loads(entry.content), "url": url, "fetched_at": entry.meta["fetched_at"], "cache_hit": True, "stale": True}
        if isinstance(exc, ValueError):
            raise UpstreamError("TerraBrasilis devolveu conteúdo inesperado", source=DETER_SOURCE, detail={"url": url}) from exc
        raise
    meta = cache.put(key, res.content, {"url": url, "fetched_at": datetime.now(UTC).isoformat()})
    return {"data": data, "url": url, "fetched_at": meta["fetched_at"], "cache_hit": False, "stale": False}
