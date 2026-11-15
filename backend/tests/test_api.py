"""Testes de ponta a ponta da API com fontes externas simuladas (sem rede)."""

from datetime import timedelta

import httpx
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api.container import build_container
from app.main import create_app
from tests.conftest import boundaries_available
from tests.fixtures import (
    synthetic_modis_nrt_csv,
    synthetic_power_climatology,
    synthetic_power_daily,
    synthetic_power_hourly,
    synthetic_viirs_nrt_csv,
    utc_now,
)

pytestmark = pytest.mark.skipif(not boundaries_available(), reason="limites IBGE ausentes (rode scripts.fetch_boundaries)")


@pytest.fixture
def client(settings, http, router):
    now = utc_now()
    router.add("J1_VIIRS_C2_South_America_7d.csv", httpx.Response(200, text=synthetic_viirs_nrt_csv(now, satellite="N20")))
    router.add("J2_VIIRS_C2_South_America_7d.csv", httpx.Response(200, text=synthetic_viirs_nrt_csv(now, satellite="N21")))
    router.add("MODIS_C6_1_South_America_7d.csv", httpx.Response(200, text=synthetic_modis_nrt_csv(now)))
    router.add("/temporal/daily/", httpx.Response(200, content=synthetic_power_daily(now - timedelta(days=40), 40)))
    router.add("/temporal/hourly/", httpx.Response(200, content=synthetic_power_hourly(now)))
    router.add("/temporal/climatology/", httpx.Response(200, content=synthetic_power_climatology()))
    container = build_container(settings, http=http)
    app = create_app(settings, container=container)
    with TestClient(app) as c:
        yield c


def seed_history(client: TestClient):
    """Histórico sintético: 6 anos de MODIS com 10 detecções/dia em setembro em Santarém."""
    store = client.app.state.container.history_store
    for year in range(2019, 2025):
        days = pd.date_range(f"{year}-09-01", f"{year}-09-30").strftime("%Y-%m-%d")
        daily = pd.DataFrame({
            "region_id": "santarem", "acq_date": days, "satellite": "Aqua", "daynight": "D", "type": 0,
            "conf_bucket": "ge80", "n": 10 + (year - 2019), "frp_sum": 1.0, "product_id": "MODIS_SP",
        })
        grid = pd.DataFrame({"region_id": ["santarem"], "year_month": [f"{year}-09"], "satellite": ["Aqua"],
                             "cell_id": ["-3.0_-55.0"], "n": [300], "product_id": ["MODIS_SP"]})
        store.replace_source_file({
            "product_id": "MODIS_SP", "archive_dir": "modis", "year": year, "country": "Brazil",
            "url": f"https://firms.test/{year}.csv", "bytes": 1, "sha256": "x", "rows_read": 300, "rows_invalid": 0,
            "rows_by_region": {"santarem": 300}, "min_acq_date": days[0], "max_acq_date": days[-1],
            "version_values": ["SYNTHETIC"], "satellites": ["Aqua"], "imported_at": "2026-01-01T00:00:00+00:00",
            "importer_version": "test",
        }, daily, grid)


def test_health_nao_expoe_chave(client):
    body = client.get("/api/v1/health").json()
    assert body["status"] == "ok"
    assert body["firms_map_key_configured"] is False
    assert "map_key" not in str(body).lower().replace("firms_map_key_configured", "")


def test_regioes(client):
    ids = {r["id"] for r in client.get("/api/v1/regions").json()["regions"]}
    assert {"brasil", "para", "santarem"} <= ids


def test_deteccoes_recorte_janela_e_proveniencia(client):
    res = client.get("/api/v1/detections", params={"region": "santarem", "window": "24h"})
    assert res.status_code == 200
    fc = res.json()
    # Por produto VIIRS: só o ponto de 1h em Santarém (o de 30h fica fora da janela; Belém e SP fora do território)
    assert len(fc["features"]) == 2
    assert {f["properties"]["p"] for f in fc["features"]} == {"VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"}
    prod = fc["metadata"]["products"][0]
    assert prod["provenance"]["mode"] == "public_file"
    assert prod["provenance"]["nominal_latency"].startswith("<3 horas")
    assert prod["count"] == 1


def test_deteccoes_7d_e_filtro_noturno(client):
    fc = client.get("/api/v1/detections", params={"region": "santarem", "window": "7d", "daynight": "N"}).json()
    assert all(f["properties"]["dn"] == "N" for f in fc["features"])
    assert len(fc["features"]) == 2


def test_deteccoes_para_inclui_belem(client):
    fc = client.get("/api/v1/detections", params={"region": "para", "window": "24h", "products": "VIIRS_NOAA20_NRT"}).json()
    assert len(fc["features"]) == 2  # Santarém (1h) + Belém (2h); São Paulo fora


def test_parametros_invalidos(client):
    assert client.get("/api/v1/detections", params={"window": "3d"}).status_code == 422
    r = client.get("/api/v1/detections", params={"region": "xingu"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    r = client.get("/api/v1/detections", params={"products": "MODIS_SP"})
    assert r.status_code == 422


def test_detalhe_da_deteccao(client):
    fc = client.get("/api/v1/detections", params={"region": "santarem", "window": "24h"}).json()
    p = fc["features"][0]["properties"]
    rec = client.get(f"/api/v1/detections/{p['p']}/{p['id']}").json()
    assert rec["detection_id"] == p["id"]
    assert rec["confidence_class"] in {"low", "nominal", "high"}
    assert client.get(f"/api/v1/detections/{p['p']}/inexistente").status_code == 404


def test_exportacao_csv_com_proveniencia(client):
    res = client.get("/api/v1/detections/export.csv", params={"region": "santarem", "window": "7d"})
    assert res.status_code == 200
    assert "attachment" in res.headers["content-disposition"]
    lines = res.text.strip().splitlines()
    header = lines[0].split(",")
    for col in ("source_url", "source_fetched_at_utc", "source_sha256", "version", "acq_datetime_utc"):
        assert col in header
    assert len(lines) == 1 + 4  # 2 pontos em Santarém × 2 produtos


def test_historico_vazio_e_informativo(client):
    r = client.get("/api/v1/history/monthly", params={"region": "santarem", "product": "MODIS_SP"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "data_unavailable"
    assert "import_history" in r.json()["error"]["detail"]["como_importar"]


def test_historico_mensal_e_linha_de_base(client):
    seed_history(client)
    body = client.get("/api/v1/history/monthly", params={"region": "santarem", "product": "MODIS_SP"}).json()
    assert body["years"] == list(range(2019, 2025))
    sep = [s for s in body["series"] if s["month"] == 9]
    assert [s["n"] for s in sep] == [300, 330, 360, 390, 420, 450]
    assert body["baseline_by_month"][8]["median"] == pytest.approx(375)
    assert sep[-1]["percentile_vs_other_years"] == 100
    jan = [s for s in body["series"] if s["month"] == 1]
    assert all(s["n"] == 0 for s in jan)  # meses sem detecção aparecem como zero
    cal = client.get("/api/v1/history/calendar", params={"region": "santarem", "product": "MODIS_SP", "year": 2024}).json()
    assert cal["total"] == 450 and len(cal["days"]) == 366


def test_contexto_meteorologico(client):
    body = client.get("/api/v1/weather/context", params={"region": "santarem"}).json()
    assert body["forecast"]["available"] is False
    rec = body["recent_analysis"]
    assert rec["available"] and rec["series"]
    assert all(v["T2M"] is not None for v in rec["series"])  # dias com fill_value ficam fora
    assert body["recent_hourly"]["wind_rose_7d"]["prevailing_sector"] == "E"
    assert body["historical"]["precip_vs_climatology"]["last_14d"]["ratio"] == pytest.approx(0.5)


def test_brief_territorial_experimental(client):
    seed_history(client)
    body = client.get("/api/v1/territory/santarem/brief").json()
    att = body["attention"]
    assert att["experimental"] is True and att["validated"] is False
    assert {s["id"] for s in att["signals"]} == {"persistence_viirs", "anomaly_MODIS_SP", "anomaly_VIIRS_NOAA20_SP", "dryness"}
    assert body["limitations"] and body["facts"]


def test_manifesto_de_evidencias(client):
    body = client.get("/api/v1/reports/evidence", params={"region": "santarem", "window": "7d"}).json()
    assert body["export"]["csv"].startswith("/api/v1/detections/export.csv")
    assert body["export"]["pdf"]["available"] is False
    assert body["boundary"]["source_url"].startswith("https://servicodados.ibge.gov.br")
