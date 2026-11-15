from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends

from app.api.container import Container, get_container
from app.domain.sources import FIRMS_LATENCY_SOURCE, FIRMS_NOMINAL_LATENCY, PRODUCTS

router = APIRouter(tags=["meta"])


@router.get("/health")
def health(c: Container = Depends(get_container)) -> dict:
    return {
        "status": "ok",
        "version": c.settings.app_version,
        "environment": c.settings.environment,
        "time_utc": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "firms_map_key_configured": c.settings.firms_key_configured,
        "regions_loaded": [r.id for r in c.regions.all()],
        "regions_missing_boundary": c.regions.missing,
        "history_imported": not c.history_store.is_empty(),
    }


@router.get("/regions")
def regions(c: Container = Depends(get_container)) -> dict:
    return {"regions": [r.summary() for r in c.regions.all()], "missing": c.regions.missing}


@router.get("/regions/{region_id}/boundary")
def boundary(region_id: str, c: Container = Depends(get_container)) -> dict:
    r = c.regions.get(region_id)
    return {**r.geojson, "metadata": r.summary()}


@router.get("/regions/{region_id}/municipalities")
def municipalities(region_id: str, c: Container = Depends(get_container)) -> dict:
    """Limites municipais simplificados (~200 m) para seleção no mapa; o recorte usa a malha de qualidade máxima."""
    import shapely
    from shapely.geometry import mapping

    c.regions.get(region_id)
    feats = []
    for r in c.regions.municipalities(region_id):
        d = r.definition
        feats.append({
            "type": "Feature",
            "properties": {"id": d.id, "name": d.name, "ibge_code": d.ibge_code, "pilot": d.pilot, "featured": d.featured},
            "geometry": mapping(shapely.simplify(r.geometry, 0.002, preserve_topology=True)),
        })
    return {"type": "FeatureCollection", "features": feats,
            "metadata": {"count": len(feats), "simplification_deg": 0.002, "source": "IBGE malhas v3 (qualidade máxima, simplificada para exibição)"}}


@router.get("/sources")
def sources(c: Container = Depends(get_container)) -> dict:
    products = []
    for p in PRODUCTS.values():
        products.append({
            **p.to_dict(),
            "nrt_mode": c.firms.preferred_mode(p) if p.processing == "NRT" else None,
            "public_file_url_7d": p.public_file_url(c.settings.firms_base_url),
        })
    return {
        "firms": {
            "map_key_configured": c.settings.firms_key_configured,
            "modes": {
                "public_file": "Arquivos públicos NRT da NASA FIRMS (América do Sul, 7 dias), sem credencial.",
                "area_api": "API por área da NASA FIRMS (requer FIRMS_MAP_KEY; DAY_RANGE 1–5).",
            },
            "nominal_latency": FIRMS_NOMINAL_LATENCY,
            "nominal_latency_source": FIRMS_LATENCY_SOURCE,
            "map_key_signup": "https://firms.modaps.eosdis.nasa.gov/api/map_key/",
            "products": products,
        },
        "power": {
            "base_url": c.settings.power_base_url,
            "docs": "https://power.larc.nasa.gov/docs/services/api/",
            "note": "Reanálise em grade (GEOS-IT/MERRA-2), latência de dias, sem previsão.",
        },
        "boundaries": {"publisher": "IBGE", "api": "https://servicodados.ibge.gov.br/api/docs/malhas?versao=3"},
    }
