"""Agregações temporais/espaciais e estatísticas de linha de base.

Regras científicas aplicadas aqui:
* Contagens de produtos diferentes (MODIS, VIIRS S-NPP, VIIRS NOAA-20...) nunca
  são somadas entre si. Toda função opera sobre um único produto por vez.
* Uma contagem de detecções é o número de pixels/footprints com anomalia térmica
  — não é número de incêndios.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

GRID_SIZE_DEG = 0.5  # grade do Pará/Brasil (importação)
LOCAL_GRID_SIZE_DEG = 0.1  # grade de territórios recortados sob demanda (~11 km)

# Faixas de confiança MODIS usadas apenas para testes de sensibilidade.
# Correspondem às classes low (<30), nominal (30–79) e high (>=80) do
# MODIS C6/C6.1 Active Fire Product User's Guide.
MODIS_BUCKETS = (("lt30", 0, 30), ("30to79", 30, 80), ("ge80", 80, 101))
VIIRS_BUCKETS = {"l": "low", "n": "nominal", "h": "high", "low": "low", "nominal": "nominal", "high": "high"}


def confidence_bucket(sensor: str, confidence: pd.Series) -> pd.Series:
    if sensor == "VIIRS":
        return confidence.astype(str).str.strip().str.lower().map(VIIRS_BUCKETS).fillna("unknown")
    pct = pd.to_numeric(confidence, errors="coerce")
    out = pd.Series("unknown", index=confidence.index, dtype=object)
    for name, lo, hi in MODIS_BUCKETS:
        out[(pct >= lo) & (pct < hi)] = name
    return out


def grid_cell_id(lat: np.ndarray | pd.Series, lon: np.ndarray | pd.Series, size: float = GRID_SIZE_DEG) -> pd.Series:
    """Identificador da célula de grade regular (canto sudoeste), ex. '-2.5_-55.0'."""
    la = np.floor(np.asarray(lat, dtype=float) / size) * size
    lo = np.floor(np.asarray(lon, dtype=float) / size) * size
    return pd.Series([f"{a:.2f}_{b:.2f}" if size < 0.5 else f"{a:.1f}_{b:.1f}" for a, b in zip(la, lo, strict=True)])


def monthly_from_daily(daily: pd.DataFrame, value: str = "n") -> pd.DataFrame:
    """daily: colunas acq_date (str/datetime) e `value`. Retorna year_month, year, month, value."""
    if daily.empty:
        return pd.DataFrame(columns=["year_month", "year", "month", value])
    d = daily.copy()
    d["acq_date"] = pd.to_datetime(d["acq_date"])
    m = d.groupby(d["acq_date"].dt.to_period("M"))[value].sum().reset_index()
    m["year_month"] = m["acq_date"].astype(str)
    m["year"] = m["acq_date"].dt.year
    m["month"] = m["acq_date"].dt.month
    return m[["year_month", "year", "month", value]]


@dataclass
class BaselineStats:
    n_years: int
    years: list[int]
    median: float | None
    p10: float | None
    p25: float | None
    p75: float | None
    p90: float | None
    minimum: float | None
    maximum: float | None

    def to_dict(self) -> dict:
        return asdict(self)


MIN_YEARS_FOR_PERCENTILES = 5


def baseline_stats(values_by_year: dict[int, float]) -> BaselineStats:
    years = sorted(values_by_year)
    vals = np.array([values_by_year[y] for y in years], dtype=float)
    if len(vals) == 0:
        return BaselineStats(0, [], None, None, None, None, None, None, None)
    q = lambda p: float(np.percentile(vals, p)) if len(vals) >= MIN_YEARS_FOR_PERCENTILES else None  # noqa: E731
    return BaselineStats(
        n_years=len(vals),
        years=years,
        median=float(np.median(vals)),
        p10=q(10), p25=q(25), p75=q(75), p90=q(90),
        minimum=float(vals.min()), maximum=float(vals.max()),
    )


def empirical_percentile(current: float, history: list[float]) -> float | None:
    """Percentil empírico (0–100) do valor atual em relação aos anos anteriores.

    Usa a definição 'fração de anos com valor <= atual' (com meio peso para empates).
    Retorna None com menos de MIN_YEARS_FOR_PERCENTILES anos.
    """
    h = np.asarray(history, dtype=float)
    if len(h) < MIN_YEARS_FOR_PERCENTILES:
        return None
    below = np.sum(h < current)
    ties = np.sum(h == current)
    return float(100.0 * (below + 0.5 * ties) / len(h))


def window_totals_by_year(
    daily: pd.DataFrame, month_day_start: tuple[int, int], month_day_end: tuple[int, int], years: list[int]
) -> dict[int, int]:
    """Total de detecções no mesmo intervalo do calendário (mês/dia) em cada ano.

    Trata intervalos que atravessam a virada de ano (ex.: 28/12 a 03/01).
    """
    if daily.empty:
        return {y: 0 for y in years}
    d = daily.copy()
    d["acq_date"] = pd.to_datetime(d["acq_date"])
    out: dict[int, int] = {}
    (m1, d1), (m2, d2) = month_day_start, month_day_end
    crosses_year = (m2, d2) < (m1, d1)
    for y in years:
        start = pd.Timestamp(year=y, month=m1, day=min(d1, 28) if (m1 == 2 and d1 == 29) else d1)
        end_year = y + 1 if crosses_year else y
        end = pd.Timestamp(year=end_year, month=m2, day=min(d2, 28) if (m2 == 2 and d2 == 29) else d2)
        sel = (d["acq_date"] >= start) & (d["acq_date"] <= end)
        out[y] = int(d.loc[sel, "n"].sum())
    return out


# Colunas mínimas de um registro do arquivo para agregação (importador e recorte sob demanda).
DAILY_KEYS = ["acq_date", "satellite", "daynight", "type", "conf_bucket"]


def aggregate_records(records: pd.DataFrame, region_id: str, with_grid: bool = True,
                      grid_size: float = GRID_SIZE_DEG) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Agrega registros já recortados em um território: contagem diária e grade mensal de 0,5°.

    `records` precisa das colunas: acq_date, satellite, daynight, type, conf_bucket, frp, lat, lon.
    """
    gcols = ["region_id", "year_month", "satellite", "cell_id", "n"]
    if records.empty:
        return pd.DataFrame(columns=["region_id", *DAILY_KEYS, "n", "frp_sum"]), pd.DataFrame(columns=gcols)
    daily = records.groupby(DAILY_KEYS, as_index=False).agg(n=("lat", "size"), frp_sum=("frp", "sum"))
    daily.insert(0, "region_id", region_id)
    if not with_grid:
        return daily, pd.DataFrame(columns=gcols)
    g = pd.DataFrame({
        "year_month": records["acq_date"].str.slice(0, 7).values,
        "satellite": records["satellite"].values,
        "cell_id": grid_cell_id(records["lat"].values, records["lon"].values, grid_size).values,
    })
    grid = g.groupby(["year_month", "satellite", "cell_id"], as_index=False).size().rename(columns={"size": "n"})
    grid.insert(0, "region_id", region_id)
    return daily, grid
