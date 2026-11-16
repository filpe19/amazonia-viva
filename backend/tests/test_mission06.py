"""Missão 06 — rastreabilidade da detecção e sedes municipais (dados SINTÉTICOS)."""

import httpx
import pytest

from tests.conftest import BOUNDARIES
from tests.test_api import client  # noqa: F401 — reaproveita o cliente com FIRMS sintético

pytestmark = pytest.mark.skipif(not (BOUNDARIES / "pa_municipios.geojson").exists(), reason="malha municipal do Pará ausente")


def test_detalhe_tem_produto_unidades_e_proveniencia(client):  # noqa: F811
    fc = client.get("/api/v1/detections", params={"region": "santarem", "window": "24h"}).json()
    p = fc["features"][0]["properties"]
    rec = client.get(f"/api/v1/detections/{p['p']}/{p['id']}").json()
    assert rec["product"]["resolution_m"] == 375 and rec["product"]["sensor"] == "VIIRS"
    assert rec["units"]["frp_mw"] == "MW" and rec["units"]["bright_ti4_k"] == "K"
    prov = rec["provenance"]
    assert prov["source"] == "NASA FIRMS" and prov["request_urls"][0].endswith("_South_America_7d.csv")
    assert prov["fetched_at"] and len(prov["sha256"]) == 64
    assert "source_file_last_modified" in prov  # pode ser None quando o servidor não informa


def test_sedes_municipais_do_ibge(client, router):  # noqa: F811
    router.add("BC250_2025_lml_posic_geo_localidade_p", httpx.Response(200, json={"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-54.71561553, -2.43779046]},
         "properties": {"identificador": "Santarém", "tipolocalidade": "Cidade", "geometriaaproximada": "Não"}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-50.42, -1.68]},
         "properties": {"identificador": "Breves", "tipolocalidade": "Cidade", "geometriaaproximada": "Não"}},
    ]}))
    r = client.get("/api/v1/regions/santarem/seats")
    assert r.status_code == 200
    d = r.json()
    assert "Cidade" in d["metadata"]["source"] and "CQL_FILTER" in d["metadata"]["url"]
    by = {f["properties"]["name"]: f["properties"] for f in d["features"]}
    assert by["Santarém"]["region_id"] == "santarem" and by["Santarém"]["in_region"] is True
    assert by["Breves"]["region_id"] == "breves" and by["Breves"]["in_region"] is False


def test_sedes_indisponiveis_viram_erro_explicito(client, router):  # noqa: F811
    router.add("BC250_2025_lml_posic_geo_localidade_p", httpx.Response(503, text="indisponível"))
    r = client.get("/api/v1/regions/para/seats")
    assert r.status_code in (502, 503)
    assert r.json()["error"]["code"].startswith("upstream")
