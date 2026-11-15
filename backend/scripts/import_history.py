"""Importa o arquivo anual por país do NASA FIRMS e grava apenas agregados.

Fonte (pública, sem credencial):
    https://firms.modaps.eosdis.nasa.gov/data/country/<dir>/<ano>/<dir>_<ano>_Brazil.csv

O arquivo bruto é baixado para um diretório temporário, processado em blocos
(sem carregar tudo na memória), agregado por região/dia/satélite/turno/tipo/
classe de confiança e removido. A proveniência (URL, Last-Modified, tamanho,
SHA-256, linhas lidas) fica registrada em `source_files`.

Uso (a partir de backend/):
    python -m scripts.import_history --product MODIS_SP --years 2016-2025
    python -m scripts.import_history --product VIIRS_SNPP_SP --years 2023-2024

Série completa MODIS (2000-2025) ≈ 750 MB de download. Use com consciência.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.domain.regions import RegionRegistry
from app.domain.sources import PRODUCTS, satellite_name
from app.persistence.detection_archive import ARCHIVE_COLUMNS, archive_path, write_archive
from app.persistence.history_store import HistoryStore
from app.science.aggregation import DAILY_KEYS, aggregate_records, confidence_bucket

IMPORTER_VERSION = "2.0.0"  # 2.0: guarda o recorte do Pará em Parquet
CHUNK_ROWS = 200_000
GRID_REGIONS = {"para"}
PRECOMPUTED_REGIONS = ("brasil", "para")  # demais territórios são calculados do Parquet sob demanda
ARCHIVE_REGION = "para"
USECOLS = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "daynight", "type", "frp", "version"]

log = logging.getLogger("import_history")


def parse_years(spec: str) -> list[int]:
    years: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            years.update(range(int(a), int(b) + 1))
        elif part:
            years.add(int(part))
    return sorted(years)


def download(url: str, dest: Path, user_agent: str, retries: int = 3) -> dict:
    for attempt in range(1, retries + 1):
        try:
            sha = hashlib.sha256()
            size = 0
            with httpx.stream("GET", url, timeout=httpx.Timeout(60, connect=15), follow_redirects=True,
                              headers={"User-Agent": user_agent}) as r:
                if r.status_code == 404:
                    return {"status": 404}
                r.raise_for_status()
                with dest.open("wb") as fh:
                    for chunk in r.iter_bytes(1 << 20):
                        fh.write(chunk)
                        sha.update(chunk)
                        size += len(chunk)
                return {"status": 200, "bytes": size, "sha256": sha.hexdigest(),
                        "http_last_modified": r.headers.get("last-modified")}
        except (httpx.HTTPError, OSError) as exc:
            log.warning("download falhou", extra={"url": url, "attempt": attempt, "error": str(exc)})
            dest.unlink(missing_ok=True)
            if attempt == retries:
                raise
            time.sleep(2 * attempt)
    raise RuntimeError("inalcançável")


def process_file(path: Path, product_id: str, regions, archive_region) -> tuple[pd.DataFrame, pd.DataFrame, dict, pd.DataFrame]:
    """Lê o CSV anual em blocos, agrega para `regions` e devolve os registros dentro de `archive_region`."""
    sensor = PRODUCTS[product_id].sensor
    daily_parts, grid_parts, archive_parts = [], [], []
    rows_read = rows_invalid = 0
    rows_by_region = {r.id: 0 for r in regions}
    versions: set[str] = set()
    sats: set[str] = set()
    min_d, max_d = None, None

    header = pd.read_csv(path, nrows=0).columns.str.strip().str.lower().tolist()
    usecols = [c for c in USECOLS if c in header]
    for chunk in pd.read_csv(path, usecols=lambda c: c.strip().lower() in usecols, dtype=str, chunksize=CHUNK_ROWS):
        chunk.columns = chunk.columns.str.strip().str.lower()
        rows_read += len(chunk)
        lat = pd.to_numeric(chunk["latitude"], errors="coerce")
        lon = pd.to_numeric(chunk["longitude"], errors="coerce")
        ok = lat.notna() & lon.notna() & chunk["acq_date"].notna()
        rows_invalid += int((~ok).sum())
        chunk, lat, lon = chunk[ok], lat[ok], lon[ok]
        if chunk.empty:
            continue
        frame = pd.DataFrame({
            "acq_date": chunk["acq_date"].str.strip().values,
            "acq_time": chunk["acq_time"].str.strip().str.zfill(4).values if "acq_time" in chunk else None,
            "satellite": chunk["satellite"].map(satellite_name).values,
            "daynight": chunk["daynight"].str.strip().str.upper().fillna("?").values if "daynight" in chunk else "?",
            "type": pd.to_numeric(chunk["type"], errors="coerce").fillna(-1).astype(int).values if "type" in chunk else -1,
            "confidence": chunk["confidence"].str.strip().values,
            "conf_bucket": confidence_bucket(sensor, chunk["confidence"]).values,
            "frp": pd.to_numeric(chunk["frp"], errors="coerce").values if "frp" in chunk else np.nan,
            "lat": lat.values,
            "lon": lon.values,
            "version": chunk["version"].str.strip().values if "version" in chunk else None,
        })
        if "version" in chunk:
            versions.update(chunk["version"].dropna().str.strip().unique().tolist())
        sats.update(frame["satellite"].unique().tolist())
        cmin, cmax = frame["acq_date"].min(), frame["acq_date"].max()
        min_d = cmin if min_d is None or cmin < min_d else min_d
        max_d = cmax if max_d is None or cmax > max_d else max_d

        for reg in regions:
            mask = reg.contains(frame["lon"].values, frame["lat"].values)
            n_in = int(mask.sum())
            rows_by_region[reg.id] += n_in
            if not n_in:
                continue
            sub = frame[mask]
            d, g = aggregate_records(sub, reg.id, with_grid=reg.id in GRID_REGIONS)
            daily_parts.append(d)
            if not g.empty:
                grid_parts.append(g)
            if reg.id == archive_region.id:
                archive_parts.append(sub)

    keys = ["region_id", *DAILY_KEYS]
    daily = (pd.concat(daily_parts).groupby(keys, as_index=False).agg(n=("n", "sum"), frp_sum=("frp_sum", "sum"))
             if daily_parts else pd.DataFrame(columns=keys + ["n", "frp_sum"]))
    gkeys = ["region_id", "year_month", "satellite", "cell_id"]
    grid = (pd.concat(grid_parts).groupby(gkeys, as_index=False)["n"].sum()
            if grid_parts else pd.DataFrame(columns=gkeys + ["n"]))
    daily["product_id"] = product_id
    grid["product_id"] = product_id
    archive = pd.concat(archive_parts, ignore_index=True) if archive_parts else pd.DataFrame(columns=ARCHIVE_COLUMNS)
    stats = {
        "rows_read": rows_read, "rows_invalid": rows_invalid, "rows_by_region": rows_by_region,
        "min_acq_date": min_d, "max_acq_date": max_d,
        "version_values": sorted(versions), "satellites": sorted(sats),
    }
    return daily, grid, stats, archive


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--product", required=True, choices=[p for p, v in PRODUCTS.items() if v.archive_country_dir])
    ap.add_argument("--years", required=True, help="ex.: 2016-2025 ou 2023,2024")
    ap.add_argument("--country", default="Brazil")
    ap.add_argument("--skip-existing", action="store_true", help="não reimporta arquivos com mesmo SHA-256")
    args = ap.parse_args()

    settings = get_settings()
    configure_logging(settings.log_level, "console")
    product = PRODUCTS[args.product]
    registry = RegionRegistry(settings.boundaries_dir)
    if registry.missing:
        print(f"Limites ausentes: {registry.missing}. Rode: python -m scripts.fetch_boundaries", file=sys.stderr)
        return 1
    regions = [registry.get(r) for r in PRECOMPUTED_REGIONS]
    archive_region = registry.get(ARCHIVE_REGION)
    store = HistoryStore(settings.history_db_path)
    existing = {(s["product_id"], s["year"]): s for s in store.source_files()}
    tmp_dir = settings.runtime_dir / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    for year in parse_years(args.years):
        url = product.archive_country_url(settings.firms_base_url, year, args.country)
        assert url
        tmp = tmp_dir / f"{product.archive_country_dir}_{year}_{args.country}.csv.part"
        t0 = time.time()
        try:
            dl = download(url, tmp, settings.http_user_agent)
            if dl["status"] == 404:
                print(f"[--] {product.id} {year}: arquivo não publicado (404)")
                continue
            prev = existing.get((product.id, year))
            if args.skip_existing and prev and prev.get("sha256") == dl["sha256"] and prev.get("parquet_path"):
                print(f"[==] {product.id} {year}: já importado (mesmo SHA-256)")
                continue
            daily, grid, stats, archive = process_file(tmp, product.id, regions, archive_region)
        finally:
            tmp.unlink(missing_ok=True)
        pq_path = archive_path(settings.runtime_dir / "detections", product.id, year)
        pq_rows = write_archive(archive, pq_path)
        meta = {
            "parquet_path": str(pq_path.relative_to(settings.runtime_dir)), "parquet_rows": pq_rows,
            "product_id": product.id, "archive_dir": product.archive_country_dir, "year": year,
            "country": args.country, "url": url, "http_last_modified": dl.get("http_last_modified"),
            "bytes": dl["bytes"], "sha256": dl["sha256"], **stats,
            "imported_at": datetime.now(UTC).isoformat(timespec="seconds"), "importer_version": IMPORTER_VERSION,
        }
        sid = store.replace_source_file(meta, daily, grid)
        print(
            f"[ok] {product.id} {year}: {dl['bytes'] / 1e6:.1f} MB, {stats['rows_read']:,} linhas, "
            f"por região {json.dumps(stats['rows_by_region'])}, versões {stats['version_values']}, "
            f"Parquet {pq_rows:,} linhas, source_file_id={sid}, {time.time() - t0:.0f}s"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
