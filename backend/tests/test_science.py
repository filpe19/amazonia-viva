import math

import numpy as np
import pandas as pd
import pytest

from app.science.aggregation import (
    baseline_stats,
    confidence_bucket,
    empirical_percentile,
    grid_cell_id,
    monthly_from_daily,
    window_totals_by_year,
)
from app.science.harmonization import overlap_comparison, spatial_agreement
from app.services.weather_service import climatology_expected, wind_rose


# ------------------------------------------------------------ agregação
def test_confidence_bucket_por_sensor():
    assert confidence_bucket("VIIRS", pd.Series(["l", "nominal", "H", "?"])).tolist() == ["low", "nominal", "high", "unknown"]
    assert confidence_bucket("MODIS", pd.Series(["0", "29", "30", "79", "80", "100", "x"])).tolist() == [
        "lt30", "lt30", "30to79", "30to79", "ge80", "ge80", "unknown"
    ]


def test_grid_cell_canto_sudoeste():
    assert grid_cell_id(np.array([-2.49, -2.51]), np.array([-54.01, -54.0])).tolist() == ["-2.5_-54.5", "-3.0_-54.0"]


def test_monthly_from_daily():
    daily = pd.DataFrame({"acq_date": ["2024-01-01", "2024-01-31", "2024-02-01"], "n": [2, 3, 7]})
    m = monthly_from_daily(daily)
    assert m["year_month"].tolist() == ["2024-01", "2024-02"]
    assert m["n"].tolist() == [5, 7]


def test_baseline_exige_cinco_anos_para_percentis():
    few = baseline_stats({2020: 1, 2021: 3, 2022: 5})
    assert few.median == 3 and few.p90 is None
    many = baseline_stats({y: v for y, v in zip(range(2016, 2026), range(10), strict=True)})
    assert many.n_years == 10
    assert many.p10 == pytest.approx(np.percentile(range(10), 10))


def test_percentil_empirico():
    hist = [10, 20, 30, 40, 50]
    assert empirical_percentile(60, hist) == 100
    assert empirical_percentile(5, hist) == 0
    assert empirical_percentile(30, hist) == 50  # empate conta meio
    assert empirical_percentile(30, [1, 2]) is None


def test_janela_do_calendario_inclusive_virada_de_ano():
    daily = pd.DataFrame({
        "acq_date": ["2020-12-30", "2021-01-02", "2021-01-05", "2021-12-31", "2022-01-01"],
        "n": [1, 2, 4, 8, 16],
    })
    tot = window_totals_by_year(daily, (12, 28), (1, 3), [2020, 2021])
    assert tot == {2020: 3, 2021: 24}
    assert window_totals_by_year(daily, (1, 1), (1, 3), [2021]) == {2021: 2}


# ---------------------------------------------------------- harmonização
def test_overlap_razao_constante():
    months = [f"2023-{m:02d}" for m in range(1, 13)]
    ref = pd.DataFrame({"year_month": months, "n": [100 * (i + 1) for i in range(12)]})
    oth = pd.DataFrame({"year_month": months, "n": [500 * (i + 1) for i in range(12)]})
    out = overlap_comparison(ref, oth)
    assert out["months_paired"] == 12
    assert out["ratio_median_active_months"] == pytest.approx(5.0)
    assert out["spearman_rho"] == pytest.approx(1.0)
    assert out["months_only_ref"] == [] and out["months_only_other"] == []


def test_overlap_poucos_meses_sem_correlacao():
    ref = pd.DataFrame({"year_month": ["2023-01", "2023-02"], "n": [1, 2]})
    oth = pd.DataFrame({"year_month": ["2023-01", "2023-03"], "n": [3, 4]})
    out = overlap_comparison(ref, oth)
    assert out["spearman_rho"] is None
    assert out["months_only_ref"] == ["2023-02"] and out["months_only_other"] == ["2023-03"]


def test_concordancia_espacial_jaccard():
    a = pd.DataFrame({"year_month": ["2023-09"] * 3, "cell_id": ["a", "b", "c"], "n": [1, 2, 3]})
    b = pd.DataFrame({"year_month": ["2023-09"] * 2, "cell_id": ["b", "d"], "n": [5, 1]})
    m = spatial_agreement(a, b)["months"][0]
    assert m["jaccard"] == pytest.approx(1 / 4)


# ---------------------------------------------------------- meteorologia
def test_rosa_dos_ventos_setor_e_resultante():
    rose = wind_rose(pd.Series([90.0] * 10 + [270.0] * 2), pd.Series([3.0] * 12))
    assert rose["n_hours"] == 12
    assert rose["prevailing_sector"] == "E"
    assert rose["resultant_direction_from_deg"] == pytest.approx(90.0, abs=0.5)
    assert math.isclose(sum(sum(r) for r in rose["freq_pct"]), 100.0, abs_tol=0.01)


def test_rosa_dos_ventos_vazia():
    assert wind_rose(pd.Series([], dtype=float), pd.Series([], dtype=float))["n_hours"] == 0


def test_climatologia_esperada_soma_por_mes():
    from datetime import date
    clim = pd.DataFrame({"PRECTOTCORR": [1.0] * 10 + [2.0, 3.0]},
                        index=["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])
    days = [date(2026, 11, 29), date(2026, 11, 30), date(2026, 12, 1)]
    assert climatology_expected(clim, "PRECTOTCORR", days) == pytest.approx(2 + 2 + 3)
