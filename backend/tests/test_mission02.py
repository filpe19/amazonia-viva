"""Missão 02 — Portel como piloto: catálogo de municípios, histórico recortável,
persistência espacial, contexto territorial (Censipam/IBGE) e Ficha de Atenção.

Todos os dados abaixo são SINTÉTICOS (formato das fontes reais, valores inventados
apenas para teste). Fontes externas são simuladas com httpx.MockTransport.
"""

import json
from datetime import timedelta

import httpx
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from shapely.geometry import box, mapping

from app.api.container import build_container
from app.domain.regions import RegionRegistry, slugify
from app.integrations.censipam import LAYERS
from app.integrations.ibge import parse_population
from app.main import create_app
from app.persistence.detection_archive import archive_path, write_archive
from app.persistence.history_store import HistoryStore
from app.services.history_service import HistoryService
from app.services.territory_context_service import overlay_layer
from app.services.territory_service import persistent_cells
from tests.conftest import BOUNDARIES
from tests.fixtures import (
    synthetic_modis_nrt_csv,
    synthetic_power_climatology,
    synthetic_power_daily,
    synthetic_power_hourly,
    utc_now,
)

pytestmark = pytest.mark.skipif(not (BOUNDARIES / "pa_municipios.geojson").exists(),
                                reason="malha municipal do Pará ausente (rode scripts.fetch_boundaries municipios)")

PORTEL_IN = (-2.60, -50.80)   # (lat, lon) dentro de Portel
BELEM = (-1.45, -48.49)       # dentro do Pará, fora de Portel


# ------------------------------------------------------------ catálogo
def test_catalogo_inclui_portel_com_area_oficial():
    reg = RegionRegistry(BOUNDARIES)
    portel = reg.get("portel")
    assert portel.definition.ibge_code == "1505809"
    assert portel.definition.pilot is True
    assert portel.area_km2 == pytest.approx(25384.96, rel=0.005)  # área oficial IBGE (Censo 2022)
    assert len(reg.municipalities("para")) == 144
    assert reg.get("santarem").definition.featured  # território já existente preservado
    lat, lon = PORTEL_IN
    assert portel.contains([lon], [lat])[0]
    assert not portel.contains([BELEM[1]], [BELEM[0]])[0]


def test_slug_sem_acentos():
    assert slugify("Santarém Novo") == "santarem-novo"
    assert slugify("São Félix do Xingu") == "sao-felix-do-xingu"


# ---------------------------------------------------- histórico recortável
def _archive_rows(points: list[tuple[float, float, str, str]]) -> pd.DataFrame:
    return pd.DataFrame([{
        "acq_date": d, "acq_time": "1330", "satellite": sat, "daynight": "D", "type": 0, "confidence": "80",
        "conf_bucket": "ge80", "frp": 10.0, "lat": la, "lon": lo, "version": "SYNTHETIC",
    } for la, lo, d, sat in points])


def _seed_parquet(settings, store: HistoryStore, product: str, year: int, df: pd.DataFrame) -> int:
    path = archive_path(settings.runtime_dir / "detections", product, year)
    rows = write_archive(df, path)
    return store.replace_source_file({
        "product_id": product, "archive_dir": "x", "year": year, "country": "Brazil", "url": f"https://firms.test/{year}",
        "bytes": 1, "sha256": "s", "rows_read": rows, "rows_invalid": 0, "rows_by_region": {"para": rows},
        "min_acq_date": f"{year}-01-01", "max_acq_date": f"{year}-12-31", "version_values": ["SYNTHETIC"],
        "satellites": ["Aqua"], "imported_at": "2026-01-01T00:00:00+00:00", "importer_version": "test",
        "parquet_path": str(path.relative_to(settings.runtime_dir)), "parquet_rows": rows,
    }, pd.DataFrame(), pd.DataFrame())


def test_recorte_sob_demanda_para_municipio(settings):
    store = HistoryStore(settings.history_db_path)
    reg = RegionRegistry(BOUNDARIES)
    lat, lon = PORTEL_IN
    for y in range(2019, 2025):
        _seed_parquet(settings, store, "MODIS_SP", y, _archive_rows(
            [(lat, lon, f"{y}-09-10", "Aqua")] * (y - 2018) + [(BELEM[0], BELEM[1], f"{y}-09-10", "Aqua")] * 50))
    hist = HistoryService(store, reg, settings.runtime_dir)
    body = hist.monthly("portel", "MODIS_SP")
    assert body["years"] == list(range(2019, 2025))
    sep = [s["n"] for s in body["series"] if s["month"] == 9]
    assert sep == [1, 2, 3, 4, 5, 6]  # Belém fica fora do recorte
    # Idempotente: segunda chamada não duplica
    assert [s["n"] for s in hist.monthly("portel", "MODIS_SP")["series"] if s["month"] == 9] == sep
    # Grade local de 0,1° registrada para o município
    grid = store.grid_monthly("portel", "MODIS_SP")
    assert grid["cell_id"].str.contains(r"\.\d\d_", regex=True).all()


def test_historico_sem_parquet_informa_indisponibilidade(settings):
    store = HistoryStore(settings.history_db_path)
    store.replace_source_file({
        "product_id": "MODIS_SP", "archive_dir": "modis", "year": 2020, "country": "Brazil", "url": "u", "bytes": 1,
        "sha256": "s", "rows_read": 1, "rows_invalid": 0, "rows_by_region": {"para": 1}, "min_acq_date": "2020-01-01",
        "max_acq_date": "2020-12-31", "version_values": [], "satellites": [], "imported_at": "2026-01-01T00:00:00+00:00",
        "importer_version": "1.0.0",
    }, pd.DataFrame(), pd.DataFrame())
    hist = HistoryService(store, RegionRegistry(BOUNDARIES), settings.runtime_dir)
    from app.core.errors import DataUnavailableError
    with pytest.raises(DataUnavailableError) as exc:
        hist.monthly("portel", "MODIS_SP")
    assert "anos_importados" in exc.value.detail


# --------------------------------------------------- persistência espacial
def test_celulas_persistentes_por_presenca_diaria():
    days = [f"2026-11-0{i}" for i in range(1, 8)]
    rows = [{"acq_date": d, "latitude": -2.55, "longitude": -50.85} for d in days[:5]]          # 5 dias na mesma célula
    rows += [{"acq_date": d, "latitude": -2.95, "longitude": -50.25} for d in days[:3]] * 10    # muitas detecções, só 3 dias
    cells = persistent_cells(pd.DataFrame(rows), days)
    assert len(cells) == 1
    assert cells[0]["days_with_detection"] == 5
    assert cells[0]["cell_sw"] == pytest.approx([-50.9, -2.6])


# ------------------------------------------------------ camadas oficiais
def test_sobreposicao_com_area_geodesica_e_deteccoes():
    reg = RegionRegistry(BOUNDARIES)
    portel = reg.get("portel")
    w, s, e, n = portel.bbox
    half = box(w - 1, s - 1, (w + e) / 2, n + 1)  # cobre a metade oeste de Portel
    feats = [{"type": "Feature", "properties": {"nome": "UC SINTÉTICA", "sigla": "FLONA"}, "geometry": mapping(half)},
             {"type": "Feature", "properties": {"nome": "LONGE"}, "geometry": mapping(box(-40, -10, -39, -9))}]
    dets = pd.DataFrame({"longitude": [w + 0.3, e - 0.1], "latitude": [(s + n) / 2, (s + n) / 2],
                         "product_id": ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"]})
    items = overlay_layer(portel, LAYERS["ucs_federais"], feats, dets)
    assert len(items) == 1
    it = items[0]
    assert it["name"] == "UC SINTÉTICA"
    assert 20 < it["share_of_territory_pct"] < 80
    assert it["detections_7d_by_product"] == {"VIIRS_NOAA20_NRT": 1}


def test_populacao_censo():
    payload = json.dumps([
        {"id": "93", "resultados": [{"series": [{"localidade": {"nome": "Portel (PA)"}, "serie": {"2022": "62503"}}]}]},
        {"id": "6318", "resultados": [{"series": [{"localidade": {"nome": "Portel (PA)"}, "serie": {"2022": "25384.960"}}]}]},
    ])
    out = parse_population(payload)
    assert out["population"] == 62503 and out["area_km2"] == pytest.approx(25384.96)
    assert out["density_per_km2"] == pytest.approx(2.46, abs=0.01)


# ---------------------------------------------------- ficha de ponta a ponta
def _viirs_csv(now, satellite):
    lat, lon = PORTEL_IN
    lines = ["latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight"]
    for d in range(1, 7):
        t = now - timedelta(days=d, hours=-1)
        lines.append(f"{lat},{lon},330,0.4,0.5,{t:%Y-%m-%d},{t:%H%M},{satellite},nominal,2.0NRT,290,4.0,D")
    t0 = now - timedelta(days=7, hours=12)  # garante cobertura de 7 dias completos
    lines.append(f"{BELEM[0]},{BELEM[1]},330,0.4,0.5,{t0:%Y-%m-%d},{t0:%H%M},{satellite},nominal,2.0NRT,290,4.0,D")
    return "\n".join(lines) + "\n"


@pytest.fixture
def client(settings, http, router):
    now = utc_now()
    lat, lon = PORTEL_IN
    router.add("J1_VIIRS_C2_South_America_7d.csv", httpx.Response(200, text=_viirs_csv(now, "N20")))
    router.add("J2_VIIRS_C2_South_America_7d.csv", httpx.Response(200, text=_viirs_csv(now, "N21")))
    router.add("MODIS_C6_1_South_America_7d.csv", httpx.Response(200, text=synthetic_modis_nrt_csv(now)))
    router.add("/temporal/daily/", httpx.Response(200, content=synthetic_power_daily(now - timedelta(days=40), 40)))
    router.add("/temporal/hourly/", httpx.Response(200, content=synthetic_power_hourly(now)))
    router.add("/temporal/climatology/", httpx.Response(200, content=synthetic_power_climatology()))
    router.add("servicodados.ibge.gov.br/api/v3/agregados/4714", httpx.Response(200, json=[
        {"id": "93", "resultados": [{"series": [{"localidade": {"nome": "Portel (PA)"}, "serie": {"2022": "62503"}}]}]},
        {"id": "6318", "resultados": [{"series": [{"localidade": {"nome": "Portel (PA)"}, "serie": {"2022": "25384.960"}}]}]},
    ]))
    uc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"nome": "UC SINTÉTICA", "sigla": "FLONA"},
                                                     "geometry": mapping(box(lon - 0.2, lat - 0.2, lon + 0.2, lat + 0.2))}]}
    empty = {"type": "FeatureCollection", "features": []}
    router.add("icmbio_unidade_conservacao_federal", httpx.Response(200, json=uc))
    router.add("geoserver/painel_do_fogo/wfs", httpx.Response(200, json=empty))
    event = {"id_evento": 1, "status_evento": "Ativo", "dt_minima": "2026-11-01T00:00:00Z", "dt_maxima": "2026-11-10T00:00:00Z",
             "dt_ultima_visao": "2026-11-10T00:00:00Z", "persistencia_dias": 9, "dominio": "x", "municipio": "Portel - PA",
             "terra_indigena": None, "unidade_conservacao": "UC SINTÉTICA, UC SINTÉTICA", "quilombola": None,
             "projeto_assentamento": None, "area_total_evento": 12.3,
             "geom": mapping(box(lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05))}
    router.add("/eventos/prioridades", httpx.Response(502, text="bad gateway"))
    router.add("/painel-do-fogo/api/v1/eventos?", httpx.Response(200, json=[event]))
    container = build_container(settings, http=http)
    with TestClient(create_app(settings, container=container)) as c:
        yield c


def test_regioes_incluem_municipios_e_camada_do_mapa(client):
    ids = {r["id"] for r in client.get("/api/v1/regions").json()["regions"]}
    assert {"portel", "almeirim", "santarem", "para"} <= ids
    fc = client.get("/api/v1/regions/para/municipalities").json()
    assert fc["metadata"]["count"] == 144
    assert any(f["properties"]["id"] == "portel" and f["properties"]["pilot"] for f in fc["features"])


def test_contexto_territorial_e_indisponibilidade_parcial(client):
    body = client.get("/api/v1/territory/portel/context").json()
    assert body["population"]["population"] == 62503
    assert "não representa pessoas expostas" in body["population"]["caveat"].lower()
    ucs = next(layer for layer in body["layers"]["layers"] if layer["id"] == "ucs_federais")
    assert ucs["items"][0]["name"] == "UC SINTÉTICA"
    assert ucs["items"][0]["detections_7d_by_product"]  # detecções dentro da UC
    cz = body["censipam"]
    assert cz["available"] and cz["count"] == 1 and cz["kind"] == "indicador_externo"
    assert cz["events"][0]["unidade_conservacao"] == ["UC SINTÉTICA"]  # nomes deduplicados
    assert cz["priority_error"]  # 502 no índice aparece como indisponibilidade, não como zero
    assert "area_total_evento" not in cz["events"][0]  # unidade não documentada: não exibida


def test_ficha_de_atencao_territorial(client):
    r = client.get("/api/v1/territory/portel/ficha")
    assert r.status_code == 200
    f = r.json()
    assert f["title"].endswith("Portel (PA)")
    assert {s["id"] for s in f["sections"]} >= {"detectado", "comparacao", "ambiente", "territorio", "censipam", "atencao", "avaliacao_humana", "fontes"}
    assert set(f["kinds"]) == {"observacao", "estimativa", "previsao", "indicador_externo", "ausente"}
    assert all(x["kind"] in f["kinds"] for x in f["brief"]["facts"])
    assert f["brief"]["forecast"]["available"] is False
    assert f["human_review"] and f["decrees"]
    assert "_viirs_frame" not in f["brief"]
    cells = f["brief"]["persistent_cells"]
    assert len(cells) == 1 and cells[0]["days_with_detection"] >= 5
    comps = {c["product_baseline"]: c for c in f["brief"]["comparisons"]}
    assert set(comps) == {"MODIS_SP", "VIIRS_NOAA20_SP", "HARMONIZED"}
    assert all(not c["available"] and c["kind"] == "ausente" for c in comps.values())  # sem histórico importado neste teste


def test_censipam_fora_do_ar_aparece_na_ficha(settings, http, router):
    router.add("/painel-do-fogo/api/v1/", httpx.Response(503, text="indisponível"))
    router.add("geoserver/painel_do_fogo/wfs", httpx.Response(503, text="indisponível"))
    router.add("servicodados.ibge.gov.br", httpx.Response(503, text="indisponível"))
    now = utc_now()
    router.add("_South_America_7d.csv", httpx.Response(200, text=_viirs_csv(now, "N20")))
    router.add("/temporal/", httpx.Response(503, text="indisponível"))
    with TestClient(create_app(settings, container=build_container(settings, http=http))) as c:
        body = c.get("/api/v1/territory/portel/context").json()
    assert body["censipam"]["available"] is False and body["censipam"]["kind"] == "ausente"
    assert body["population"]["available"] is False
    assert all(not layer["available"] for layer in body["layers"]["layers"])
