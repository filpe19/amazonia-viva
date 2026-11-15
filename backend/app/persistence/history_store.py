"""Repositório do histórico agregado (SQLite no MVP).

O esquema espelha `postgis_schema.sql`; trocar o backend de persistência
significa reimplementar esta classe com a mesma interface pública.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import pandas as pd

SCHEMA = """
CREATE TABLE IF NOT EXISTS source_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    archive_dir TEXT NOT NULL,
    year INTEGER NOT NULL,
    country TEXT NOT NULL,
    url TEXT NOT NULL,
    http_last_modified TEXT,
    bytes INTEGER,
    sha256 TEXT,
    rows_read INTEGER,
    rows_invalid INTEGER,
    rows_by_region TEXT,
    min_acq_date TEXT,
    max_acq_date TEXT,
    version_values TEXT,
    satellites TEXT,
    imported_at TEXT NOT NULL,
    importer_version TEXT NOT NULL,
    UNIQUE (product_id, year, country)
);
CREATE TABLE IF NOT EXISTS daily_counts (
    region_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    satellite TEXT NOT NULL,
    acq_date TEXT NOT NULL,
    daynight TEXT NOT NULL,
    type INTEGER NOT NULL,
    conf_bucket TEXT NOT NULL,
    n INTEGER NOT NULL,
    frp_sum REAL,
    source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
    PRIMARY KEY (region_id, product_id, satellite, acq_date, daynight, type, conf_bucket)
);
CREATE INDEX IF NOT EXISTS ix_daily_region_product_date ON daily_counts (region_id, product_id, acq_date);
CREATE TABLE IF NOT EXISTS region_builds (
    region_id TEXT NOT NULL,
    source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
    rows_in_region INTEGER NOT NULL,
    built_at TEXT NOT NULL,
    method TEXT NOT NULL,
    PRIMARY KEY (region_id, source_file_id)
);
CREATE TABLE IF NOT EXISTS monthly_grid_counts (
    region_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    satellite TEXT NOT NULL,
    year_month TEXT NOT NULL,
    cell_id TEXT NOT NULL,
    n INTEGER NOT NULL,
    source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
    PRIMARY KEY (region_id, product_id, satellite, year_month, cell_id)
);
"""


PARQUET_BUILD_METHOD = "parquet-grid0.1"  # mude ao alterar o cálculo sob demanda: força recálculo


class HistoryStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)
            cols = {r[1] for r in c.execute("PRAGMA table_info(source_files)")}
            for name, typ in (("parquet_path", "TEXT"), ("parquet_rows", "INTEGER")):
                if name not in cols:  # migração de bancos criados pelo importador 1.x
                    c.execute(f"ALTER TABLE source_files ADD COLUMN {name} {typ}")

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ------------------------------------------------------------- escrita
    def replace_source_file(self, meta: dict, daily: pd.DataFrame, grid: pd.DataFrame) -> int:
        """Substitui atomicamente tudo o que veio de (product_id, year, country)."""
        with self._conn() as c:
            c.execute(
                "DELETE FROM source_files WHERE product_id=? AND year=? AND country=?",
                (meta["product_id"], meta["year"], meta["country"]),
            )
            cols = [
                "product_id", "archive_dir", "year", "country", "url", "http_last_modified", "bytes", "sha256",
                "rows_read", "rows_invalid", "rows_by_region", "min_acq_date", "max_acq_date", "version_values",
                "satellites", "imported_at", "importer_version", "parquet_path", "parquet_rows",
            ]
            vals = [json.dumps(meta[k], ensure_ascii=False) if isinstance(meta.get(k), (dict, list)) else meta.get(k) for k in cols]
            cur = c.execute(f"INSERT INTO source_files ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", vals)
            sid = int(cur.lastrowid)
            if not daily.empty:
                d = daily.assign(source_file_id=sid)
                c.executemany(
                    "INSERT INTO daily_counts (region_id, product_id, satellite, acq_date, daynight, type, conf_bucket, n, frp_sum, source_file_id)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?)",
                    d[["region_id", "product_id", "satellite", "acq_date", "daynight", "type", "conf_bucket", "n", "frp_sum", "source_file_id"]]
                    .itertuples(index=False, name=None),
                )
            if not grid.empty:
                g = grid.assign(source_file_id=sid)
                c.executemany(
                    "INSERT INTO monthly_grid_counts (region_id, product_id, satellite, year_month, cell_id, n, source_file_id)"
                    " VALUES (?,?,?,?,?,?,?)",
                    g[["region_id", "product_id", "satellite", "year_month", "cell_id", "n", "source_file_id"]]
                    .itertuples(index=False, name=None),
                )
            for region_id, n in (meta.get("rows_by_region") or {}).items():
                c.execute(
                    "INSERT OR REPLACE INTO region_builds (region_id, source_file_id, rows_in_region, built_at, method) VALUES (?,?,?,?,?)",
                    (region_id, sid, int(n), meta["imported_at"], "import"),
                )
            return sid

    def replace_region_aggregates(self, region_id: str, source_file_id: int, product_id: str,
                                  daily: pd.DataFrame, grid: pd.DataFrame, rows_in_region: int, built_at: str) -> None:
        """Grava agregados de um território calculados a partir do arquivo Parquet de um source_file."""
        with self._conn() as c:
            c.execute("DELETE FROM daily_counts WHERE region_id=? AND source_file_id=?", (region_id, source_file_id))
            c.execute("DELETE FROM monthly_grid_counts WHERE region_id=? AND source_file_id=?", (region_id, source_file_id))
            if not daily.empty:
                c.executemany(
                    "INSERT INTO daily_counts (region_id, product_id, satellite, acq_date, daynight, type, conf_bucket, n, frp_sum, source_file_id)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?)",
                    ((region_id, product_id, r.satellite, r.acq_date, r.daynight, int(r.type), r.conf_bucket, int(r.n), float(r.frp_sum), source_file_id)
                     for r in daily.itertuples(index=False)),
                )
            if not grid.empty:
                c.executemany(
                    "INSERT INTO monthly_grid_counts (region_id, product_id, satellite, year_month, cell_id, n, source_file_id) VALUES (?,?,?,?,?,?,?)",
                    ((region_id, product_id, r.satellite, r.year_month, r.cell_id, int(r.n), source_file_id) for r in grid.itertuples(index=False)),
                )
            c.execute(
                "INSERT OR REPLACE INTO region_builds (region_id, source_file_id, rows_in_region, built_at, method) VALUES (?,?,?,?,?)",
                (region_id, source_file_id, rows_in_region, built_at, PARQUET_BUILD_METHOD),
            )

    def built_source_ids(self, region_id: str, methods: tuple[str, ...] | None = None) -> set[int]:
        """IDs de arquivos já agregados para o território (opcionalmente só com certos métodos)."""
        with self._conn() as c:
            rows = c.execute("SELECT source_file_id, method FROM region_builds WHERE region_id=?", (region_id,)).fetchall()
        return {sid for sid, m in rows if methods is None or m in methods}

    # ------------------------------------------------------------- leitura
    def source_files(self) -> list[dict]:
        with self._conn() as c:
            c.row_factory = sqlite3.Row
            rows = [dict(r) for r in c.execute("SELECT * FROM source_files ORDER BY product_id, year")]
            builds = c.execute("SELECT source_file_id, region_id, rows_in_region FROM region_builds").fetchall()
        built: dict[int, dict[str, int]] = {}
        for sid, region_id, n in builds:
            built.setdefault(sid, {})[region_id] = n
        for r in rows:
            for k in ("rows_by_region", "version_values", "satellites"):
                if r.get(k):
                    r[k] = json.loads(r[k])
            r["rows_by_region"] = {**(r.get("rows_by_region") or {}), **built.get(r["id"], {})}
        return rows

    def is_empty(self) -> bool:
        with self._conn() as c:
            return c.execute("SELECT COUNT(*) FROM source_files").fetchone()[0] == 0

    def daily(
        self,
        region_id: str,
        product_id: str,
        *,
        satellites: list[str] | None = None,
        start: str | None = None,
        end: str | None = None,
        daynight: str | None = None,
        types: list[int] | None = None,
        conf_buckets: list[str] | None = None,
    ) -> pd.DataFrame:
        """Contagens diárias somadas sobre as dimensões não filtradas."""
        where = ["region_id = ?", "product_id = ?"]
        args: list = [region_id, product_id]
        if satellites:
            where.append(f"satellite IN ({','.join('?' * len(satellites))})")
            args += satellites
        if start:
            where.append("acq_date >= ?")
            args.append(start)
        if end:
            where.append("acq_date <= ?")
            args.append(end)
        if daynight in ("D", "N"):
            where.append("daynight = ?")
            args.append(daynight)
        if types:
            where.append(f"type IN ({','.join('?' * len(types))})")
            args += types
        if conf_buckets:
            where.append(f"conf_bucket IN ({','.join('?' * len(conf_buckets))})")
            args += conf_buckets
        sql = (
            "SELECT acq_date, SUM(n) AS n, SUM(frp_sum) AS frp_sum FROM daily_counts "
            f"WHERE {' AND '.join(where)} GROUP BY acq_date ORDER BY acq_date"
        )
        with self._conn() as c:
            return pd.read_sql_query(sql, c, params=args)

    def years_available(self, product_id: str, region_id: str | None = None) -> list[int]:
        """Anos importados; com `region_id`, apenas os anos já agregados para o território."""
        with self._conn() as c:
            if region_id is None:
                rows = c.execute("SELECT year FROM source_files WHERE product_id=? ORDER BY year", (product_id,))
            else:
                rows = c.execute(
                    "SELECT s.year FROM source_files s JOIN region_builds b ON b.source_file_id = s.id "
                    "WHERE s.product_id=? AND b.region_id=? AND b.method IN ('import', ?) ORDER BY s.year",
                    (product_id, region_id, PARQUET_BUILD_METHOD))
            return [r[0] for r in rows]

    def grid_monthly(self, region_id: str, product_id: str, satellites: list[str] | None = None) -> pd.DataFrame:
        where = ["region_id = ?", "product_id = ?"]
        args: list = [region_id, product_id]
        if satellites:
            where.append(f"satellite IN ({','.join('?' * len(satellites))})")
            args += satellites
        sql = (
            "SELECT year_month, cell_id, SUM(n) AS n FROM monthly_grid_counts "
            f"WHERE {' AND '.join(where)} GROUP BY year_month, cell_id"
        )
        with self._conn() as c:
            return pd.read_sql_query(sql, c, params=args)
