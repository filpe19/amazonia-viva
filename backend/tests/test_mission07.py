"""Missão 07 — sinais de atenção (cruzamento espacial) e camada DETER (dados SINTÉTICOS, sem rede)."""

import json

import httpx
import pytest

from tests.conftest import BOUNDARIES
from tests.test_api import client  # noqa: F401 — cliente com FIRMS sintético (Santarém: N20/N21 em -2.50,-54.90; MODIS em -2.55,-54.95)

pytestmark = pytest.mark.skipif(not (BOUNDARIES / "pa_municipios.geojson").exists(), reason="malha municipal do Pará ausente")


def _square(w, s, e, n):
    return {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


def _fc(*features):
    return {"type": "FeatureCollection", "features": list(features)}


def _censipam(request: httpx.Request) -> httpx.Response:
    layer = request.url.params.get("typeNames", "")
    if layer.endswith("funai_terra_indigena"):  # contém a detecção VIIRS de Santarém
        return httpx.Response(200, json=_fc({"type": "Feature", "geometry": _square(-54.92, -2.52, -54.88, -2.48),
                                             "properties": {"terrai_nom": "TI Sintética", "etnia_nome": "Povo Teste"}}))
    if layer.endswith("assentamento_federal"):  # a ~1,1 km da detecção de -2.60,-55.10 (fora do polígono)
        return httpx.Response(200, json=_fc({"type": "Feature", "geometry": _square(-55.09, -2.64, -55.05, -2.56),
                                             "properties": {"nome_proje": "PA Sintético"}}))
    return httpx.Response(200, json=_fc())


def _routes(router, censipam=_censipam):
    router.add("geoserver/painel_do_fogo/wfs", censipam)
    router.add("BC250_2025_lml_posic_geo_localidade_p", httpx.Response(200, json=_fc(
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-54.905, -2.50]},
         "properties": {"identificador": "Vila Sintética", "tipolocalidade": "Vila", "geometriaaproximada": "Não"}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-55.40, -3.20]},
         "properties": {"identificador": "Longe", "tipolocalidade": "Vila", "geometriaaproximada": "Não"}},
    )))
    router.add("/cnes/tipounidades", httpx.Response(200, json={"tipos_unidade": [{"codigo_tipo_unidade": 2, "descricao_tipo_unidade": "CENTRO DE SAUDE"}]}))
    router.add("/cnes/estabelecimentos", httpx.Response(200, json={"estabelecimentos": [
        {"codigo_cnes": 1, "nome_fantasia": "POSTO SINTÉTICO", "codigo_tipo_unidade": 2,
         "latitude_estabelecimento_decimo_grau": -2.53, "longitude_estabelecimento_decimo_grau": -54.95},
    ]}))
    router.add("terrabrasilis.dpi.inpe.br/geoserver/deter-amz", httpx.Response(200, json=_fc(
        {"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": [_square(-54.96, -2.56, -54.94, -2.54)["coordinates"]]},
         "properties": {"gid": "1_curr", "classname": "CICATRIZ_DE_QUEIMADA", "view_date": "2026-10-23", "areamunkm": 3.7,
                        "satellite": "CBERS-4", "sensor": "AWFI"}},
        {"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": [_square(-55.30, -2.90, -55.29, -2.89)["coordinates"]]},
         "properties": {"gid": "2_curr", "classname": "DESMATAMENTO_CR", "view_date": "2026-11-06", "areamunkm": 0.1}},
    )))


def test_sinais_de_atencao_no_municipio(client, router):  # noqa: F811
    _routes(router)
    r = client.get("/api/v1/territory/santarem/attention", params={"window": "7d"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["available"] is True and d["official"] is False and d["experimental"] is True
    by = {(s["category"], s["relation"]): s for s in d["signals"]}
    ti = by[("indigenous", "inside")]
    assert ti["target"]["name"] == "TI Sintética" and ti["by_satellite"] == {"NOAA-20": 1, "NOAA-21": 1}
    assert {x["p"] for x in ti["detections"]} == {"VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"}
    near = by[("settlement", "near")]
    assert 0.9 <= near["nearest_km"] <= 1.4 and near["radius_km"] == 2.0
    loc = by[("locality", "within_km")]
    assert loc["target"]["name"] == "Vila Sintética" and loc["nearest_km"] < 1.0
    assert ("health", "within_km") in by
    deter = by[("deter_burn_scar", "inside")]
    assert deter["by_satellite"] == {"Aqua": 1} and deter["target"]["polygons"][0]["class"] == "CICATRIZ_DE_QUEIMADA"
    env = d["summary"]["environment"]
    assert env["deter_available"] and env["detections_over_deter"] == 1
    assert {c["class"] for c in env["classes"]} == {"CICATRIZ_DE_QUEIMADA", "DESMATAMENTO_CR"}
    # Sem pontuação, peso ou índice de risco em nenhuma parte da resposta.
    text = json.dumps(d).lower()
    assert '"score"' not in text and '"risk' not in text and '"weight' not in text


def test_fonte_indisponivel_fica_explicita_sem_derrubar_os_demais_sinais(client, router):  # noqa: F811
    _routes(router, censipam=httpx.Response(503, text="indisponível"))
    d = client.get("/api/v1/territory/santarem/attention").json()
    assert d["sources"]["terras_indigenas"]["available"] is False and d["sources"]["terras_indigenas"]["reason"]
    cats = {s["category"] for s in d["signals"]}
    assert "indigenous" not in cats and "locality" in cats and "deter_burn_scar" in cats


def test_escala_estadual_e_camada_deter(client, router):  # noqa: F811
    _routes(router)
    d = client.get("/api/v1/territory/para/attention").json()
    assert d["sources"]["health"].get("not_applicable") and d["sources"]["deter"].get("not_applicable")
    assert any(m["region_id"] == "santarem" for m in d["by_municipality"])
    lay = client.get("/api/v1/territory/santarem/deter").json()
    assert lay["metadata"]["available"] and lay["metadata"]["months"] == 12
    assert {f["properties"]["group"] for f in lay["features"]} == {"burn_scar", "deforestation"}
    assert client.get("/api/v1/territory/para/deter").json()["metadata"]["available"] is False


def test_geojson_compacto_traz_dimensoes_do_pixel(client):  # noqa: F811
    fc = client.get("/api/v1/detections", params={"region": "santarem", "window": "24h"}).json()
    p = fc["features"][0]["properties"]
    assert p["sc"] == 0.4 and p["tr"] == 0.5
