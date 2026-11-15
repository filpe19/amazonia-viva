"""Baixa os limites territoriais oficiais (API de malhas v3 do IBGE).

Uso (a partir de backend/):
    python -m scripts.fetch_boundaries            # todas as regiões de REGION_DEFS
    python -m scripts.fetch_boundaries santarem   # apenas uma

Grava `data/boundaries/<id>.geojson` e `<id>.meta.json` (URL, data, SHA-256).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sys
from datetime import UTC, datetime

from app.core.config import get_settings
from app.core.http import HttpClient
from app.domain.regions import REGION_DEFS

IBGE_MALHAS = "https://servicodados.ibge.gov.br/api/v3/malhas"
IBGE_LOCALIDADES = "https://servicodados.ibge.gov.br/api/v1/localidades"
STATE_MUNICIPALITIES = {"15": "pa_municipios"}  # UF -> arquivo com todos os municípios
QUALITY = "maxima"  # usado no recorte das detecções; ~65 KB por limite


async def main(only: set[str]) -> int:
    settings = get_settings()
    out = settings.boundaries_dir
    out.mkdir(parents=True, exist_ok=True)
    http = HttpClient(timeout=60, max_retries=3, user_agent=settings.http_user_agent)
    try:
        for d in REGION_DEFS:
            if only and d.id not in only:
                continue
            url = f"{IBGE_MALHAS}/{d.ibge_path}?formato=application/vnd.geo%2Bjson&qualidade={QUALITY}"
            res = await http.get(url, source="IBGE malhas v3")
            gj = json.loads(res.content)
            if gj.get("type") != "FeatureCollection" or not gj.get("features"):
                print(f"[erro] {d.id}: resposta sem features", file=sys.stderr)
                return 1
            (out / f"{d.id}.geojson").write_bytes(res.content)
            meta = {
                "region_id": d.id,
                "name": d.name,
                "ibge_code": d.ibge_code,
                "publisher": "IBGE — Instituto Brasileiro de Geografia e Estatística",
                "source_url": url,
                "quality": QUALITY,
                "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "sha256": hashlib.sha256(res.content).hexdigest(),
                "bytes": len(res.content),
                "license_note": "Dados públicos do IBGE (API de malhas territoriais v3).",
            }
            (out / f"{d.id}.meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), "utf-8")
            print(f"[ok] {d.id}: {len(res.content)} bytes")
        if not only or "municipios" in only:
            for uf, name in STATE_MUNICIPALITIES.items():
                url = f"{IBGE_MALHAS}/estados/{uf}?intrarregiao=municipio&formato=application/vnd.geo%2Bjson&qualidade={QUALITY}"
                mesh = await http.get(url, source="IBGE malhas v3")
                names_url = f"{IBGE_LOCALIDADES}/estados/{uf}/municipios"
                names = await http.get(names_url, source="IBGE localidades")
                by_code = {str(m["id"]): m["nome"] for m in json.loads(names.content)}
                gj = json.loads(mesh.content)
                missing = []
                for f in gj["features"]:
                    code = str(f["properties"].get("codarea"))
                    f["properties"]["nome"] = by_code.get(code)
                    if f["properties"]["nome"] is None:
                        missing.append(code)
                if missing:
                    print(f"[erro] códigos sem nome no IBGE localidades: {missing}", file=sys.stderr)
                    return 1
                body = json.dumps(gj, ensure_ascii=False).encode()
                (out / f"{name}.geojson").write_bytes(body)
                meta = {
                    "region_id": name, "publisher": "IBGE — Instituto Brasileiro de Geografia e Estatística",
                    "source_url": url, "names_url": names_url, "quality": QUALITY,
                    "fetched_at": datetime.now(UTC).isoformat(timespec="seconds"),
                    "sha256": hashlib.sha256(mesh.content).hexdigest(), "bytes": len(mesh.content),
                    "features": len(gj["features"]),
                    "license_note": "Dados públicos do IBGE (malhas territoriais v3 e localidades v1).",
                }
                (out / f"{name}.meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), "utf-8")
                print(f"[ok] {name}: {len(gj['features'])} municípios, {len(body)} bytes")
    finally:
        await http.aclose()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(set(sys.argv[1:]))))
