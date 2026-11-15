"""Missão 03 — inteligência histórica, impacto nas pessoas e ficha por perguntas.

Dados SINTÉTICOS (formato das fontes reais; valores inventados só para teste).
"""

import sqlite3
import struct
from datetime import timedelta

import httpx
import numpy as np
import pandas as pd
import pytest
import shapely
from fastapi.testclient import TestClient
from shapely.geometry import Point, box

from app.api.container import build_container
from app.domain.regions import RegionRegistry
from app.integrations.cnes import CnesClient
from app.main import create_app
from app.persistence.cache import FileCache
from app.persistence.census_tracts import gpkg_geometry, tracts_for_municipality
from app.persistence.history_store import HistoryStore
from app.science.harmonization import detect_anomalies, leave_one_year_out, normalized_series
from app.services.impact_service import _Projector, point_proximity, tract_exposure
from tests.conftest import BOUNDARIES
from tests.fixtures import synthetic_power_climatology, synthetic_power_daily, synthetic_power_hourly, utc_now
from tests.test_mission02 import PORTEL_IN, _archive_rows, _seed_parquet, _viirs_csv

pytestmark = pytest.mark.skipif(not (BOUNDARIES / "pa_municipios.geojson").exists(), reason="malha municipal do Pará ausente")


# ------------------------------------------------------------- anomalias
def _monthly(values_by_year: dict[int, int], month: int = 9) -> pd.DataFrame:
    return pd.DataFrame([{"year_month": f"{y}-{month:02d}", "year": y, "month": month, "n": n} for y, n in values_by_year.items()])


def test_anomalia_acima_com_z_robusto():
    m = _monthly({2019: 10, 2020: 12, 2021: 11, 2022: 13, 2023: 12, 2024: 50})
    an = detect_anomalies(m)
    assert [a["year_month"] for a in an] == ["2024-09"]
    a = an[0]
    assert a["direction"] == "acima" and a["percentile"] == 100 and a["median_other_years"] == 12
    assert a["robust_z"] > 5


def test_anomalia_exige_cinco_anos_e_ignora_abaixo_com_mediana_zero():
    assert detect_anomalies(_monthly({2021: 1, 2022: 2, 2023: 90})) == []
    assert detect_anomalies(_monthly({2019: 0, 2020: 0, 2021: 0, 2022: 0, 2023: 0, 2024: 0})) == []


# ------------------------------------------------------ harmonização experimental
def _pair(ratio_fn, years=(2021, 2022, 2023, 2024, 2025)):
    rows_r, rows_o = [], []
    for y in years:
        for m in range(1, 13):
            ref = 100 + 50 * m
            rows_r.append({"year_month": f"{y}-{m:02d}", "n": ref})
            rows_o.append({"year_month": f"{y}-{m:02d}", "n": ref * ratio_fn(y, m)})
    return pd.DataFrame(rows_r), pd.DataFrame(rows_o)


def test_validacao_razao_exata_tem_erro_zero():
    ref, oth = _pair(lambda y, m: 5)
    out = leave_one_year_out(ref, oth)
    assert out["available"] and out["summary"]["constante"]["median_ape"] == pytest.approx(0)
    assert out["summary"]["sazonal"]["median_ape"] == pytest.approx(0)


def test_validacao_razao_sazonal_e_melhor_que_constante_quando_ha_sazonalidade():
    ref, oth = _pair(lambda y, m: 4 if m < 7 else 8)
    out = leave_one_year_out(ref, oth)
    assert out["summary"]["sazonal"]["median_ape"] == pytest.approx(0)
    assert out["summary"]["constante"]["median_ape"] > 0.2


def test_validacao_exige_tres_anos():
    ref, oth = _pair(lambda y, m: 5, years=(2023, 2024))
    assert leave_one_year_out(ref, oth)["available"] is False


def test_indice_normalizado_media_um():
    ref, oth = _pair(lambda y, m: 5)
    out = normalized_series(ref, oth)
    assert np.mean([x["ref_index"] for x in out["months"]]) == pytest.approx(1)
    assert out["median_abs_index_difference"] == pytest.approx(0)


# --------------------------------------------------------- setores (GPKG)
def _gpkg_blob(geom) -> bytes:
    wkb = shapely.to_wkb(geom)
    flags = 0b00000011  # little endian + envelope [minx,maxx,miny,maxy]
    minx, miny, maxx, maxy = geom.bounds
    return b"GP" + bytes([0, flags]) + struct.pack("<i", 4674) + struct.pack("<4d", minx, maxx, miny, maxy) + wkb


def test_geometria_geopackage():
    g = box(-50.9, -2.6, -50.8, -2.5)
    assert gpkg_geometry(_gpkg_blob(g)).equals(g)


def _synthetic_tracts_gpkg(path, lon, lat):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE PA_setores_CD2022 (CD_SETOR TEXT, SITUACAO TEXT, AREA_KM2 REAL, v0001 INTEGER, v0007 INTEGER, geom BLOB, CD_MUN TEXT)")
    near = box(lon - 0.01, lat - 0.01, lon + 0.01, lat + 0.01)
    near2 = box(lon + 0.02, lat - 0.01, lon + 0.03, lat + 0.01)  # segunda parte do MESMO setor
    far = box(lon + 0.5, lat + 0.5, lon + 0.6, lat + 0.6)
    rows = [("S1", "Urbana", 1.0, 1000, 250, _gpkg_blob(near), "1505809"),
            ("S1", "Urbana", 1.0, 1000, 250, _gpkg_blob(near2), "1505809"),  # multiparte: atributos repetidos
            ("S2", "Rural", 300.0, 200, 50, _gpkg_blob(far), "1505809")]
    con.executemany("INSERT INTO PA_setores_CD2022 VALUES (?,?,?,?,?,?,?)", rows)
    con.commit()
    con.close()


def test_setores_multipartes_contados_uma_vez(tmp_path):
    lat, lon = PORTEL_IN
    p = tmp_path / "setores.gpkg"
    _synthetic_tracts_gpkg(p, lon, lat)
    tracts = tracts_for_municipality(str(p), "1505809")
    assert len(tracts) == 2
    assert sum(t["population"] for t in tracts) == 1200  # não 2200
    s1 = next(t for t in tracts if t["cd_setor"] == "S1")
    assert s1["geometry"].geom_type == "MultiPolygon"


def test_exposicao_limite_superior_e_proximidade(tmp_path):
    lat, lon = PORTEL_IN
    p = tmp_path / "setores.gpkg"
    _synthetic_tracts_gpkg(p, lon, lat)
    tracts = tracts_for_municipality(str(p), "1505809")
    proj = _Projector(lon, lat)
    dets = pd.DataFrame({"longitude": [lon + 0.02], "latitude": [lat], "product_id": ["VIIRS_NOAA20_NRT"],
                         "acq_datetime_utc": [pd.Timestamp("2026-11-10T13:00Z")]})
    ex = tract_exposure(tracts, dets, proj, radius_km=5)
    assert ex["tracts_within_radius"] == 1 and ex["population_upper_bound"] == 1000
    assert ex["population_total"] == 1200 and ex["population_upper_bound_share_pct"] == pytest.approx(83.3, abs=0.1)
    items = point_proximity([{"name": "Vila A", "lon": lon, "lat": lat}, {"name": "Longe", "lon": lon + 1, "lat": lat}], dets, proj)
    assert items[0]["name"] == "Vila A"
    assert items[0]["nearest_detection_km"] == pytest.approx(2.22, abs=0.05)  # 0,02° de longitude a ~2,6° S
    assert items[0]["detections_within_km"] == {"1": 0, "5": 1, "10": 1}
    assert items[1]["detections_within_km"]["10"] == 0


def test_exposicao_sem_deteccoes():
    reg = RegionRegistry(BOUNDARIES)
    lon, lat = reg.get("portel").centroid
    tracts = ({"cd_setor": "X", "situacao": "Rural", "area_km2": 1, "population": 10, "occupied_households": 3,
               "geometry": Point(lon, lat).buffer(0.01)},)
    ex = tract_exposure(tracts, pd.DataFrame(), _Projector(lon, lat))
    assert ex["population_upper_bound"] == 0 and ex["population_total"] == 10


# ------------------------------------------------------------- CNES
async def test_cnes_pagina_de_20_em_20(http, router, settings):
    def page(req):
        off = int(req.url.params["offset"])
        n = 20 if off == 0 else (5 if off == 20 else 0)
        return httpx.Response(200, json={"estabelecimentos": [{"codigo_cnes": off + i} for i in range(n)]})

    router.add("/cnes/estabelecimentos", page)
    res = await CnesClient(http, FileCache(settings.cache_dir)).establishments("1505809")
    assert len(res["items"]) == 25 and res["pages"] == 2
    assert "codigo_municipio=150580" in res["url"]


# --------------------------------------------------------- ponta a ponta
@pytest.fixture
def client(settings, http, router, tmp_path):
    now = utc_now()
    lat, lon = PORTEL_IN
    for f, sat in (("J1_VIIRS_C2_South_America_7d.csv", "N20"), ("J2_VIIRS_C2_South_America_7d.csv", "N21")):
        router.add(f, httpx.Response(200, text=_viirs_csv(now, sat)))
    router.add("MODIS_C6_1_South_America_7d.csv", httpx.Response(200, text="latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight\n"))
    router.add("/temporal/daily/", httpx.Response(200, content=synthetic_power_daily(now - timedelta(days=40), 40)))
    router.add("/temporal/hourly/", httpx.Response(200, content=synthetic_power_hourly(now)))
    router.add("/temporal/climatology/", httpx.Response(200, content=synthetic_power_climatology()))
    router.add("BC250_2025_lml_posic_geo_localidade_p", httpx.Response(200, json={"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon + 0.01, lat]},
         "properties": {"identificador": "Vila Sintética", "tipolocalidade": "Aglomerado rural isolado", "geometriaaproximada": "Não"}}]}))
    router.add("BC250_2025_aer_pista_ponto_pouso_p", httpx.Response(200, json={"type": "FeatureCollection", "features": []}))
    router.add("/cnes/tipounidades", httpx.Response(200, json={"tipos_unidade": [{"codigo_tipo_unidade": 2, "descricao_tipo_unidade": "CENTRO DE SAUDE/UNIDADE BASICA"}]}))
    router.add("/cnes/estabelecimentos", httpx.Response(200, json={"estabelecimentos": [
        {"codigo_cnes": 1, "nome_fantasia": "POSTO SINTÉTICO", "codigo_tipo_unidade": 2, "latitude_estabelecimento_decimo_grau": lat,
         "longitude_estabelecimento_decimo_grau": lon, "estabelecimento_possui_atendimento_hospitalar": 0},
        {"codigo_cnes": 2, "nome_fantasia": "SEM COORDENADA", "codigo_tipo_unidade": 2,
         "latitude_estabelecimento_decimo_grau": None, "longitude_estabelecimento_decimo_grau": None}]}))
    router.add("tb_brigada_pto", httpx.Response(200, json={"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-50.47, -1.67]},
         "properties": {"nome": "11_GBM", "orgao_responsavel": "cbm", "municipio": "Breves", "uf": "PA"}}]}))
    router.add("geoserver/painel_do_fogo/wfs", httpx.Response(200, json={"type": "FeatureCollection", "features": []}))
    router.add("servicodados.ibge.gov.br/api/v3/agregados", httpx.Response(503, text="indisponível"))
    router.add("/painel-do-fogo/api/v1/", httpx.Response(503, text="indisponível"))
    (settings.runtime_dir / "reference").mkdir(parents=True, exist_ok=True)
    _synthetic_tracts_gpkg(settings.runtime_dir / "reference" / "PA_setores_CD2022.gpkg", lon, lat)
    store = HistoryStore(settings.history_db_path)
    for y in range(2021, 2026):
        _seed_parquet(settings, store, "MODIS_SP", y, _archive_rows([(lat, lon, f"{y}-{m:02d}-10", "Aqua") for m in range(1, 13) for _ in range(40)]))
        _seed_parquet(settings, store, "VIIRS_NOAA20_SP", y, _archive_rows([(lat, lon, f"{y}-{m:02d}-10", "NOAA-20") for m in range(1, 13) for _ in range(200)]))
    with TestClient(create_app(settings, container=build_container(settings, http=http))) as c:
        yield c


def test_impacto_proximidade_e_exposicao(client):
    d = client.get("/api/v1/territory/portel/impact").json()
    assert d["available"]
    loc = d["localities"]
    assert loc["count"] == 1 and loc["within_5km"] == 1 and loc["proximity_kind"] == "estimativa"
    hl = d["health"]
    assert hl["count_registered"] == 2 and hl["count_with_coordinates"] == 1 and hl["without_coordinates"] == 1
    ex = d["exposure"]
    assert ex["kind"] == "estimativa" and ex["population_total"] == 1200 and ex["population_upper_bound"] == 1000
    assert "não pessoas afetadas" in ex["caveat"].lower() or "não pessoas afetadas" in ex["caveat"]
    assert d["infrastructure"]["brigades"]["items"][0]["municipality"] == "Breves"


def test_impacto_so_para_municipios(client):
    d = client.get("/api/v1/territory/para/impact").json()
    assert d["available"] is False and d["kind"] == "ausente"


def test_cobertura_e_experimento_de_harmonizacao(client):
    cov = client.get("/api/v1/history/coverage", params={"region": "portel"}).json()
    assert cov["overlap_years_with_modis"]["VIIRS_NOAA20_SP"] == [2021, 2022, 2023, 2024, 2025]
    modis = next(p for p in cov["products"] if p["product_id"] == "MODIS_SP")
    assert modis["per_year"][0]["detections_in_territory"] == 480 and modis["overpass_local"]
    exp = client.get("/api/v1/history/harmonization-experiment", params={"region": "portel"}).json()
    assert exp["validated_fusion"] is False and exp["experimental"] is True
    assert exp["loyo"]["summary"]["constante"]["median_ape"] == pytest.approx(0)  # razão sintética exata (5×)
    mon = client.get("/api/v1/history/monthly", params={"region": "portel", "product": "MODIS_SP"}).json()
    assert "anomalies" in mon and mon["anomalies"] == []  # série sintética constante: nada incomum


def test_ficha_responde_as_sete_perguntas_e_indica_indisponibilidade(client):
    f = client.get("/api/v1/territory/portel/ficha").json()
    assert [q["question"] for q in f["questions"]] == [
        "O que foi detectado?", "Quando ocorreu?", "O comportamento é incomum?",
        "Quais condições ambientais estavam presentes?", "Quais territórios habitados ou protegidos estão próximos?",
        "Que informações precisam ser verificadas?", "Quais são as fontes e limitações?",
    ]
    assert f["impact"]["available"] is True
    assert f["context"]["population"]["available"] is False  # IBGE simulado fora do ar
    assert f["context"]["censipam"]["available"] is False
    kinds = {x["kind"] for x in f["brief"]["facts"]}
    assert "estimativa" in kinds and kinds <= set(f["kinds"])
    assert any("Exposição potencial" in x["text"] and "Não são pessoas afetadas" in x["text"] for x in f["brief"]["facts"])
