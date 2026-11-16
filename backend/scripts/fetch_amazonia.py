"""Limite da Amazônia como um todo (9 países), a partir de fontes oficiais.

* Brasil: Amazônia Legal pela definição legal (Lei Complementar nº 124/2007, art. 2º): Acre, Amapá, Amazonas,
  Mato Grosso, Pará, Rondônia, Roraima, Tocantins e a porção do Maranhão a oeste do meridiano 44° W.
  Limites estaduais da API de malhas v3 do IBGE.
* Demais países: "capa combinada" da Organização do Tratado de Cooperação Amazônica (OTCA), espelhada no
  GeoServer Panorama do Censipam (camada `painel_do_fogo:otca_capacombinada_cuencaamazo_act2`), que reúne a
  definição amazônica de cada país (Bolívia, Colômbia, Equador, Guiana, Peru, Suriname, Venezuela) e Guiana Francesa.

Uso (a partir de backend/):  python -m scripts.fetch_amazonia
Grava data/boundaries/amazonia.geojson (dissolvido e simplificado ~0,005°) e amazonia.meta.json (fontes, SHA-256).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import shapely
from shapely.geometry import box, mapping, shape

from app.core.config import get_settings
from app.core.http import HttpClient
from app.domain.regions import geodesic_area_km2

IBGE_MALHAS = "https://servicodados.ibge.gov.br/api/v3/malhas"
LEGAL_AMAZON_UFS = {"11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO", "51": "MT"}
MARANHAO = "21"
MERIDIAN_44W = -44.0
OTCA_URL = ("https://panorama.sipam.gov.br/geoserver/painel_do_fogo/wfs?service=WFS&version=2.0.0&request=GetFeature"
            "&outputFormat=application/json&typeNames=painel_do_fogo:otca_capacombinada_cuencaamazo_act2")
SIMPLIFY_DEG = 0.005


async def main() -> int:
    settings = get_settings()
    out = settings.boundaries_dir
    http = HttpClient(timeout=180, max_retries=3, user_agent=settings.http_user_agent)
    sources = []
    try:
        br_parts = []
        for uf in [*LEGAL_AMAZON_UFS, MARANHAO]:
            url = f"{IBGE_MALHAS}/estados/{uf}?formato=application/vnd.geo%2Bjson&qualidade=intermediaria"
            res = await http.get(url, source="IBGE malhas v3")
            g = shapely.union_all([shape(f["geometry"]) for f in json.loads(res.content)["features"]])
            if uf == MARANHAO:
                minx, miny, _, maxy = g.bounds
                g = g.intersection(box(minx - 1, miny - 1, MERIDIAN_44W, maxy + 1))
            br_parts.append(shapely.make_valid(g))
            sources.append({"part": f"UF {uf}", "url": url, "sha256": hashlib.sha256(res.content).hexdigest()})
        brazil = shapely.union_all(br_parts)

        res = await http.get(OTCA_URL, source="Censipam GeoServer (OTCA)")
        otca = json.loads(res.content)
        others = shapely.union_all([shapely.make_valid(shape(f["geometry"])) for f in otca["features"]])
        countries = sorted({f["properties"].get("pais") for f in otca["features"]})
        sources.append({"part": "OTCA (demais países)", "url": OTCA_URL, "sha256": hashlib.sha256(res.content).hexdigest(),
                        "features": len(otca["features"]), "countries": countries})
    finally:
        await http.aclose()

    whole = shapely.make_valid(shapely.union_all([brazil, others]))
    simple = shapely.make_valid(shapely.simplify(whole, SIMPLIFY_DEG, preserve_topology=True))
    gj = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"nome": "Amazônia (9 países)", "codarea": "AMZ"}, "geometry": mapping(simple)}]}
    body = json.dumps(gj).encode()
    (out / "amazonia.geojson").write_bytes(body)
    meta = {
        "region_id": "amazonia", "name": "Amazônia (9 países)",
        "publisher": "IBGE (Amazônia Legal pela LC 124/2007) + OTCA via Censipam (demais países)",
        "source_url": OTCA_URL, "sources": sources,
        "definition": "Brasil: Amazônia Legal (AC, AP, AM, MT, PA, RO, RR, TO e Maranhão a oeste de 44° W). Demais países: "
                      "definição amazônica de cada país na capa combinada da OTCA.",
        "area_km2_geodesic": round(geodesic_area_km2(simple), 0),
        "brazil_km2_geodesic": round(geodesic_area_km2(brazil), 0),
        "simplification_deg": SIMPLIFY_DEG,
        "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body),
        "license_note": "Dados públicos do IBGE e da OTCA (via GeoServer Panorama do Censipam).",
    }
    (out / "amazonia.meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), "utf-8")
    print(f"[ok] amazonia: {len(body)} bytes; {meta['area_km2_geodesic']:,.0f} km² (Brasil {meta['brazil_km2_geodesic']:,.0f} km²)")
    return 0


OTCA_TI_URL = ("https://panorama.sipam.gov.br/geoserver/painel_do_fogo/wfs?service=WFS&version=2.0.0&request=GetFeature"
               "&outputFormat=application/json&typeNames=painel_do_fogo:otca_amazonia_indigenous_land")


async def indigenous(from_file: str | None = None) -> int:
    """Terras indígenas dos demais países amazônicos (OTCA, ~130 MB) → referência local simplificada (~0,002°)."""
    settings = get_settings()
    ref = settings.runtime_dir / "reference"
    ref.mkdir(parents=True, exist_ok=True)
    if from_file:
        raw = Path(from_file).read_bytes()
    else:
        http = HttpClient(timeout=600, max_retries=2, user_agent=settings.http_user_agent)
        try:
            raw = (await http.get(OTCA_TI_URL, source="Censipam GeoServer (OTCA)")).content
        finally:
            await http.aclose()
    data = json.loads(raw)
    feats = []
    for f in data["features"]:
        if not f.get("geometry") or (f.get("properties") or {}).get("pais") in ("Brasil", "Brazil"):
            continue  # Brasil: camada oficial da FUNAI
        g = shapely.make_valid(shapely.simplify(shapely.make_valid(shape(f["geometry"])), 0.002, preserve_topology=True))
        if g.is_empty:
            continue
        p = f.get("properties", {})
        feats.append({"type": "Feature", "properties": {"feature_id": p.get("feature_id"), "name_es": p.get("name_es"), "pais": p.get("pais")},
                      "geometry": mapping(g)})
    body = json.dumps({"type": "FeatureCollection", "features": feats}).encode()
    (ref / "otca_indigenous_lands.geojson").write_bytes(body)
    (ref / "otca_indigenous_lands.meta.json").write_text(json.dumps({
        "source_url": OTCA_TI_URL, "publisher": "OTCA via GeoServer Panorama (Censipam)", "features": len(feats),
        "source_sha256": hashlib.sha256(raw).hexdigest(), "source_bytes": len(raw), "simplification_deg": 0.002,
        "processed_at": datetime.now(UTC).isoformat(timespec="seconds")}, ensure_ascii=False, indent=2), "utf-8")
    print(f"[ok] otca_indigenous_lands: {len(feats)} feições, {len(body)} bytes")
    return 0


if __name__ == "__main__":
    import sys

    if "--indigenous" in sys.argv:
        src = sys.argv[sys.argv.index("--from-file") + 1] if "--from-file" in sys.argv else None
        raise SystemExit(asyncio.run(indigenous(src)))
    raise SystemExit(asyncio.run(main()))
