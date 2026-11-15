"""Baixa bases de referência estáticas (uma vez) com proveniência.

* Setores censitários do Censo 2022 com atributos (IBGE), Pará — GeoPackage (~46 MB).

Uso (a partir de backend/):
    python -m scripts.fetch_reference
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import UTC, datetime

import httpx

from app.core.config import get_settings

REFERENCES = {
    "setores_pa_2022": {
        "url": "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/"
               "malha_com_atributos/setores/gpkg/UF/PA/PA_setores_CD2022.gpkg",
        "file": "PA_setores_CD2022.gpkg",
        "publisher": "IBGE — Censo Demográfico 2022, agregados por setores censitários (malha com atributos)",
    },
}


def main() -> int:
    settings = get_settings()
    out = settings.runtime_dir / "reference"
    out.mkdir(parents=True, exist_ok=True)
    for key, ref in REFERENCES.items():
        dest = out / ref["file"]
        tmp = dest.with_suffix(dest.suffix + ".part")
        sha = hashlib.sha256()
        size = 0
        with httpx.stream("GET", ref["url"], timeout=httpx.Timeout(120, connect=20), follow_redirects=True,
                          headers={"User-Agent": settings.http_user_agent}) as r:
            if r.status_code != 200:
                print(f"[erro] {key}: HTTP {r.status_code}", file=sys.stderr)
                return 1
            last_modified = r.headers.get("last-modified")
            with tmp.open("wb") as fh:
                for chunk in r.iter_bytes(1 << 20):
                    fh.write(chunk)
                    sha.update(chunk)
                    size += len(chunk)
        tmp.replace(dest)
        meta = {"key": key, "url": ref["url"], "publisher": ref["publisher"], "bytes": size, "sha256": sha.hexdigest(),
                "http_last_modified": last_modified, "fetched_at": datetime.now(UTC).isoformat(timespec="seconds")}
        (out / f"{ref['file']}.meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), "utf-8")
        print(f"[ok] {key}: {size / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
