"""Missão 04 — série harmonizada experimental e exportações do histórico (dados SINTÉTICOS)."""

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api.container import build_container
from app.main import create_app
from app.persistence.history_store import HistoryStore
from app.science.harmonization import harmonize_monthly, seasonal_ratios
from tests.conftest import BOUNDARIES
from tests.test_mission02 import PORTEL_IN, _archive_rows, _seed_parquet

pytestmark = pytest.mark.skipif(not (BOUNDARIES / "pa_municipios.geojson").exists(), reason="malha municipal do Pará ausente")


def _paired(ratio_by_month, years=(2021, 2022, 2023, 2024, 2025), base=100):
    rows = []
    for y in years:
        for m in range(1, 13):
            ref = base + 10 * m
            rows.append({"year_month": f"{y}-{m:02d}", "year": y, "month": m, "ref": ref, "other": ref * ratio_by_month(m)})
    return pd.DataFrame(rows)


def test_razao_sazonal_por_mes():
    r = seasonal_ratios(_paired(lambda m: 4.0 if m <= 6 else 8.0))
    assert r["available"]
    assert r["by_month"][3]["ratio"] == pytest.approx(4.0) and r["by_month"][9]["ratio"] == pytest.approx(8.0)
    assert r["by_month"][9]["source"] == "mês do ano"


def test_mes_com_poucos_anos_usa_razao_geral():
    p = _paired(lambda m: 6.0)
    p.loc[p["month"] == 2, ["ref", "other"]] = 0  # fevereiro sem atividade em todos os anos
    r = seasonal_ratios(p)
    assert r["by_month"][2]["source"].startswith("razão geral")
    assert r["by_month"][2]["ratio"] == pytest.approx(6.0)


def test_serie_harmonizada_observado_e_convertido():
    ratios = seasonal_ratios(_paired(lambda m: 5.0))
    modis = pd.DataFrame([{"year_month": f"{y}-{m:02d}", "n": 10.0} for y in (2019, 2020, 2021) for m in range(1, 13)])
    viirs = pd.DataFrame([{"year_month": f"2021-{m:02d}", "n": 55.0} for m in range(1, 13)])
    rows = harmonize_monthly(modis, viirs, ratios, viirs_years=[2021], modis_years=[2019, 2020, 2021])
    by = {r["year_month"]: r for r in rows}
    assert by["2020-05"]["origin"] == "convertido_modis" and by["2020-05"]["value"] == pytest.approx(50.0)
    assert by["2021-05"]["origin"] == "observado_viirs" and by["2021-05"]["value"] == 55.0
    assert by["2020-05"]["low"] <= by["2020-05"]["value"] <= by["2020-05"]["high"]


@pytest.fixture
def client(settings, http):
    lat, lon = PORTEL_IN
    store = HistoryStore(settings.history_db_path)
    for y in range(2002, 2026):
        modis_pts = [(lat, lon, f"{y}-{m:02d}-10", "Aqua") for m in range(1, 13) for _ in range(40)]
        if y == 2002:  # Aqua só a partir de julho de 2002 → Terra no 1º semestre
            modis_pts = [(lat, lon, f"{y}-{m:02d}-10", "Terra" if m < 7 else "Aqua") for m in range(1, 13) for _ in range(40)]
        _seed_parquet(settings, store, "MODIS_SP", y, _archive_rows(modis_pts))
    for y in range(2021, 2026):
        _seed_parquet(settings, store, "VIIRS_NOAA20_SP", y, _archive_rows([(lat, lon, f"{y}-{m:02d}-10", "NOAA-20") for m in range(1, 13) for _ in range(240)]))
    with TestClient(create_app(settings, container=build_container(settings, http=http))) as c:
        yield c


def test_endpoint_harmonizado(client):
    d = client.get("/api/v1/history/harmonized", params={"region": "portel"}).json()
    assert d["experimental"] is True and d["validated_fusion"] is False
    assert d["first_month_with_data"] == "2002-07"  # Aqua começou em jul/2002
    by = {r["year_month"]: r for r in d["series"]}
    assert by["2002-03"]["origin"] == "sem_dado" and by["2002-03"]["modis_n"] is None
    assert by["2010-08"]["origin"] == "convertido_modis" and by["2010-08"]["value"] == pytest.approx(240.0)  # 40 × razão 6
    assert by["2023-08"]["origin"] == "observado_viirs" and by["2023-08"]["value"] == 240
    assert d["ratios"]["global"]["ratio"] == pytest.approx(6.0)
    assert d["validation"]["summary"]["sazonal"]["median_ape"] == pytest.approx(0)
    assert len(d["annual"]) == 24


def test_exportacoes_csv(client):
    r = client.get("/api/v1/history/harmonized.csv", params={"region": "portel"})
    assert r.status_code == 200 and "EXPERIMENTAL" in r.text.splitlines()[0]
    assert "year_month,harmonized_value,low_p10,high_p90,origin" in r.text
    r2 = client.get("/api/v1/history/export.csv", params={"region": "portel", "product": "VIIRS_NOAA20_SP", "start": "2024-08-01", "end": "2024-09-30"})
    lines = r2.text.strip().splitlines()
    assert lines[0].startswith("product_id,satellite,acq_date")
    assert len(lines) == 1 + 480  # 240 focos sintéticos em ago + 240 em set
    assert all("firms.test" in ln for ln in lines[1:])  # proveniência por linha
    assert client.get("/api/v1/history/export.csv", params={"region": "brasil", "product": "MODIS_SP", "start": "2024-01-01", "end": "2024-01-31"}).status_code == 422
    assert client.get("/api/v1/history/export.csv", params={"region": "portel", "product": "MODIS_SP", "start": "2024-02-01", "end": "2024-01-01"}).status_code == 422
