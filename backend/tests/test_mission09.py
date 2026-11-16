"""Missão 09 — focos com impacto (agrupamento, vento, alvos, grau e confiabilidade) e modo histórico (dados SINTÉTICOS)."""

import json

import httpx
import numpy as np
import pytest

from app.services.hotspot_service import angdiff, cluster_labels, sector
from tests.conftest import BOUNDARIES
from tests.test_api import client  # noqa: F401 — FIRMS sintético: N20 e N21 em -2.50,-54.90 (1 h); MODIS em -2.55,-54.95 (5 h)
from tests.test_mission08 import _routes as routes08

pytestmark = pytest.mark.skipif(not (BOUNDARIES / "pa_municipios.geojson").exists(), reason="malha municipal do Pará ausente")

WIND = [{"current": {"time": "2026-11-15T12:00", "wind_speed_10m": 3.0, "wind_direction_10m": 45, "wind_gusts_10m": 7.0},
         "hourly": {"time": ["2026-11-15T12:00"], "wind_speed_10m": [3.0], "wind_direction_10m": [45]}}] * 10


def _routes(router):
    routes08(router)
    router.add("BC250_2025_lml_posic_geo_localidade_p", httpx.Response(200, json={"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-54.905, -2.50]},
         "properties": {"identificador": "Vila Sintética", "tipolocalidade": "Vila", "geometriaaproximada": "Não"}}]}))
    router.add("api.open-meteo.com", httpx.Response(200, json=WIND))
    router.add("painel-do-fogo/api/v1/eventos", httpx.Response(200, json=[]))


def test_focos_com_grau_vento_e_alvos(client, router):  # noqa: F811
    _routes(router)
    r = client.get("/api/v1/territory/santarem/hotspots", params={"window": "7d"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["available"] and d["official"] is False and d["historical"] is False
    top = d["items"][0]
    # N20 + N21 no mesmo pixel: 2 passagens de 2 satélites, dentro da TI sintética, localidade a ~0,5 km
    assert top["level"] == "alto" and top["proportion"]["overpasses"] == 2 and top["proportion"]["satellites"] == 2
    assert top["veracity"] == "media"
    assert any(t["type"] == "indigenous" and t["inside"] for t in top["targets"]["inside"])
    assert {x["id"] for x in top["level_reasons"]} >= {"confirmed", "inside", "close_people"}
    assert top["wind"]["toward_deg"] == 225.0 and "Open-Meteo" in top["wind"]["source"]
    assert top["proportion"]["area_km2"] > 0 and top["access"]["nearest_brigade"]["agency"] == "prevfogo"
    assert all("lon" in t and "lat" in t for t in top["targets"]["near"] + top["targets"]["inside"])
    assert "Probabilidade" in d["not_modeled"][0]
    text = json.dumps(d).lower()
    assert '"score"' not in text and '"probability"' not in text


def test_modo_historico_e_validacoes(client, router):  # noqa: F811
    _routes(router)
    d = client.get("/api/v1/territory/santarem/hotspots", params={"start": "2016-11-08", "end": "2016-11-14"}).json()
    assert d["available"] and d["historical"] and d["detections"]["mode"] == "archive"
    assert d["sources"]["wind"]["available"] is False  # vento atual não se aplica ao passado
    assert client.get("/api/v1/territory/santarem/hotspots", params={"start": "2016-11-08"}).status_code in (400, 422)
    assert client.get("/api/v1/history/detections", params={"region": "santarem", "start": "2016-11-08", "end": "2016-11-14"}).json()["metadata"]["mode"] == "archive"
    if (BOUNDARIES / "amazonia.geojson").exists():
        a = client.get("/api/v1/territory/amazonia/hotspots", params={"start": "2016-11-08", "end": "2016-11-14"}).json()
        assert a["available"] is False and "Pará" in a["reason"]


def test_agrupamento_e_geometria():
    xy = np.array([[0, 0], [1000, 0], [5000, 0], [6400, 0], [20000, 0]], dtype=float)
    lab = cluster_labels(xy, 1500)
    assert lab[0] == lab[1] and lab[2] == lab[3] and len(set(lab.tolist())) == 3
    assert sector(225) == "SO" and sector(90) == "L" and angdiff(350, 10) == 20


def test_camadas_de_referencia_para_o_mapa(client, router):  # noqa: F811
    _routes(router)
    d = client.get("/api/v1/territory/santarem/map-layers").json()
    cats = {f["properties"]["category"] for f in d["areas"]["features"]}
    assert "indigenous" in cats
    ti = next(f["properties"] for f in d["areas"]["features"] if f["properties"]["category"] == "indigenous")
    assert ti["name"].startswith("TI Sintética") and ti["unit"] == "CR-TST" and ti["source"] == "FUNAI"
    road = d["roads"]["features"][0]["properties"]
    assert road["name"] == "BR-163" and road["source"] == "DNIT"
