"""Arquivo local de detecções históricas recortadas no Pará (Parquet por produto e ano).

Permite calcular agregados para qualquer território dentro do Pará (municípios,
terras indígenas, unidades de conservação) sem baixar de novo o arquivo anual
da NASA FIRMS. Cada arquivo Parquet é vinculado a um `source_files.id`.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

ARCHIVE_COLUMNS = [
    "acq_date", "acq_time", "satellite", "daynight", "type", "confidence", "conf_bucket",
    "frp", "lat", "lon", "version",
]

SCHEMA = pa.schema([
    ("acq_date", pa.string()), ("acq_time", pa.string()), ("satellite", pa.string()), ("daynight", pa.string()),
    ("type", pa.int8()), ("confidence", pa.string()), ("conf_bucket", pa.string()), ("frp", pa.float32()),
    ("lat", pa.float64()), ("lon", pa.float64()), ("version", pa.string()),
])


def archive_path(root: Path, product_id: str, year: int) -> Path:
    return root / product_id / f"{year}.parquet"


def write_archive(df: pd.DataFrame, path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = df.reindex(columns=ARCHIVE_COLUMNS)
    table = pa.Table.from_pandas(out, schema=SCHEMA, preserve_index=False)
    tmp = path.with_suffix(".parquet.tmp")
    pq.write_table(table, tmp, compression="zstd")
    tmp.replace(path)
    return table.num_rows


def read_archive_bbox(path: Path, bbox: tuple[float, float, float, float]) -> pd.DataFrame:
    """Lê só as linhas dentro do retângulo (oeste, sul, leste, norte)."""
    w, s, e, n = bbox
    filters = [("lon", ">=", w), ("lon", "<=", e), ("lat", ">=", s), ("lat", "<=", n)]
    return pq.read_table(path, filters=filters).to_pandas()
