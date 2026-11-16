"""Missão 08 — alertas para Terras Indígenas, 'É incêndio mesmo?' e região Amazônia (dados SINTÉTICOS, sem rede)."""

import json

import httpx
import pytest

from app.services.indigenous_service import esri_rings_to_geom, name_variants, parse_census
from tests.conftest import BOUNDARIES
from tests.test_api import client  # noqa: F401 — FIRMS sintético: N20 e N21 em -2.50,-54.90 (Santarém); MODIS em -2.55,-54.95

pytestmark = pytest.mark.skipif(not (BOUNDARIES / "pa_municipios.geojson").exists(), reason="malha municipal do Pará ausente")


def _square(w, s, e, n):
    return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


def _fc(*features):
    return {"type": "FeatureCollection", "features": list(features)}


def _censipam(request: httpx.Request) -> httpx.Response:
    layer = request.url.params.get("typeNames", "")
    if layer.endswith("funai_terra_indigena"):
        return httpx.Response(200, json=_fc({"type": "Feature", "geometry": _square(-54.92, -2.52, -54.88, -2.48), "properties": {
            "terrai_cod": 99901, "terrai_nom": "TI Sintética (Teste)", "etnia_nome": "Povo Teste, Povo Dois", "uf_sigla": "PA",
            "fase_ti": "Regularizada", "modalidade": "Tradicionalmente ocupada", "superficie": 1234.5, "municipio_": "Santarém",
            "undadm_nom": "COORDENACAO REGIONAL TESTE", "undadm_sig": "CR-TST", "faixa_fron": "Não"}}))
    if layer.endswith("dnit_rodovias_federais"):
        return httpx.Response(200, json=_fc({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[-54.80, -2.70], [-54.80, -2.30]]},
                                             "properties": {"vl_br": "163", "ds_superfi": "PAV"}}))
    if layer.endswith("tb_brigada_pto"):
        return httpx.Response(200, json=_fc({"type": "Feature", "geometry": {"type": "Point", "coordinates": [-54.70, -2.44]},
                                             "properties": {"nome": "BRIGADA_TESTE", "orgao_responsavel": "prevfogo", "municipio": "Santarém", "uf": "PA"}}))
    return httpx.Response(200, json=_fc())


SIDRA = [
    {"id": "576", "variavel": "Pessoas residentes em terras indígenas", "resultados": [{"classificacoes": [], "series": [
        {"localidade": {"id": "1599901", "nivel": {"id": "N125"}, "nome": "TI Sintética - PA"}, "serie": {"2022": "100"}}]}]},
    {"id": "1432", "variavel": "Pessoas indígenas residentes em terras indígenas", "resultados": [{"classificacoes": [], "series": [
        {"localidade": {"id": "1599901", "nivel": {"id": "N125"}, "nome": "TI Sintética - PA"}, "serie": {"2022": "90"}}]}]},
]
# Anel Esri no sentido horário (externo) contendo a detecção VIIRS de Santarém
ANM = {"features": [{"attributes": {"PROCESSO": "850001/2020", "FASE": "LAVRA GARIMPEIRA", "SUBS": "OURO"},
                     "geometry": {"rings": [[[-54.91, -2.51], [-54.91, -2.49], [-54.89, -2.49], [-54.89, -2.51], [-54.91, -2.51]]]}}]}


def _routes(router):
    router.add("geoserver/painel_do_fogo/wfs", _censipam)
    router.add("agregados/9719", httpx.Response(200, json=SIDRA))
    router.add("geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/MapServer/0/", httpx.Response(200, json=ANM))
    router.add("geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/MapServer/4/", httpx.Response(200, json={"features": []}))
    router.add("terrabrasilis.dpi.inpe.br", httpx.Response(200, json=_fc()))


def test_alerta_de_terra_indigena_com_contexto_social(client, router):  # noqa: F811
    _routes(router)
    r = client.get("/api/v1/territory/santarem/indigenous", params={"window": "7d"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["available"] and d["official"] is False
    item = next(i for i in d["items"] if i["name"].startswith("TI Sintética"))
    # N20 e N21 na mesma posição: duas passagens distintas → fogo dentro confirmado
    assert item["alert"] == "inside_confirmed" and item["inside"]["overpasses"] == 2
    assert item["inside"]["by_satellite"] == {"NOAA-20": 1, "NOAA-21": 1}
    assert item["peoples"] == ["Povo Teste", "Povo Dois"] and item["funai_unit"]["sigla"] == "CR-TST"
    assert item["population"]["indigenous"] == 90 and item["population"]["residents"] == 100  # casa "TI Sintética (Teste)" com "TI Sintética - PA"
    assert item["access"]["nearest_federal_road"]["name"] == "BR-163" and item["access"]["nearest_brigade"]["agency"] == "prevfogo"
    assert item["evidence"]["mining"]["detections_in_garimpo_areas"] >= 1
    assert d["summary"]["indigenous_residents_in_lands_with_fire_inside"] == 90
    text = json.dumps(d).lower()
    assert '"score"' not in text and '"risk' not in text


def test_e_incendio_mesmo_indicios_de_origem(client, router):  # noqa: F811
    _routes(router)
    fc = client.get("/api/v1/detections", params={"region": "santarem", "window": "24h"}).json()
    p = next(f["properties"] for f in fc["features"] if f["properties"]["s"] == "NOAA-20")
    e = client.get(f"/api/v1/detections/{p['p']}/{p['id']}/evidence").json()
    ids = {x["id"] for x in e["evidence"]}
    assert "confirmed" in ids  # NOAA-21 no mesmo local e horário
    assert "mining_garimpo" in ids and e["reading"] == "mining_context"
    assert e["sources"]["archive"]["available"] is False  # arquivo local ausente no teste: explícito, não zero
    assert client.get("/api/v1/detections/VIIRS_NOAA20_NRT/inexistente/evidence").status_code == 404


def test_regiao_amazonia_disponivel(client, router):  # noqa: F811
    if not (BOUNDARIES / "amazonia.geojson").exists():
        pytest.skip("limite amazônico ausente (rode scripts.fetch_amazonia)")
    _routes(router)
    regs = {r["id"]: r for r in client.get("/api/v1/regions").json()["regions"]}
    assert regs["amazonia"]["level"] == "bioma" and regs["amazonia"]["area_km2"] > 7_000_000
    d = client.get("/api/v1/territory/amazonia/indigenous").json()
    assert d["available"] and d["sources"]["otca"]["available"] in (True, False)
    assert client.get("/api/v1/territory/amazonia/brief").status_code == 200


def test_utilitarios_de_casamento_e_aneis():
    assert "tisintetica" in name_variants("TI Sintética (Teste)")
    data = parse_census(SIDRA)
    assert data[("tisintetica", "PA")]["indigenous"] == 90
    g = esri_rings_to_geom(ANM["features"][0]["geometry"]["rings"])
    assert g is not None and g.contains(__import__("shapely").Point(-54.90, -2.50))
