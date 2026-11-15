from datetime import date, timedelta

import httpx
import pytest

from app.core.errors import SourceNotConfiguredError, UpstreamError, UpstreamUnavailableError
from app.domain.sources import PRODUCTS
from app.integrations.firms import FirmsClient
from app.integrations.power import PowerClient, parse_power_climatology, parse_power_timeseries
from app.persistence.cache import FileCache
from tests.fixtures import synthetic_power_climatology, synthetic_power_daily, synthetic_viirs_nrt_csv, utc_now

N20 = PRODUCTS["VIIRS_NOAA20_NRT"]


def firms(http, settings, key=None, ttl=900):
    return FirmsClient(http, FileCache(settings.cache_dir), base_url="https://firms.test", map_key=key, cache_ttl=ttl)


# ------------------------------------------------------------------ HTTP
async def test_http_retry_e_sucesso(http, router):
    state = {"n": 0}

    def flaky(_req):
        state["n"] += 1
        return httpx.Response(503) if state["n"] == 1 else httpx.Response(200, text="ok")

    router.add("/flaky", flaky)
    res = await http.get("https://x.test/flaky", source="teste")
    assert res.text == "ok" and res.attempts == 2


async def test_http_esgota_tentativas(http, router):
    router.add("/down", httpx.Response(503))
    with pytest.raises(UpstreamUnavailableError):
        await http.get("https://x.test/down", source="teste")


async def test_http_404_nao_repete(http, router):
    router.add("/missing", httpx.Response(404, text="nope"))
    with pytest.raises(UpstreamError) as exc:
        await http.get("https://x.test/missing", source="teste")
    assert exc.value.detail["status"] == 404
    assert len(router.calls) == 1


# ------------------------------------------------------------------ FIRMS
async def test_arquivo_publico_usa_cache(http, router, settings):
    router.add("J1_VIIRS_C2_South_America_7d.csv", httpx.Response(200, text=synthetic_viirs_nrt_csv(utc_now())))
    client = firms(http, settings)
    a = await client.fetch_public_file(N20)
    b = await client.fetch_public_file(N20)
    assert not a.cache_hit and b.cache_hit
    assert a.sha256 == b.sha256
    assert len(router.calls) == 1
    assert a.request_urls[0].startswith("https://firms.test/data/active_fire/noaa-20-viirs-c2/csv/")


async def test_resposta_invalida_nao_entra_no_cache(http, router, settings):
    router.add("J1_VIIRS", httpx.Response(200, text="Service temporarily unavailable"))
    client = firms(http, settings)
    with pytest.raises(UpstreamError):
        await client.fetch_public_file(N20)
    assert not list(settings.cache_dir.glob("*.bin"))


async def test_copia_anterior_quando_fonte_cai(http, router, settings):
    ok = {"on": True}
    router.add("J1_VIIRS", lambda _r: httpx.Response(200, text=synthetic_viirs_nrt_csv(utc_now())) if ok["on"] else httpx.Response(503))
    client = firms(http, settings, ttl=0)  # tudo expira imediatamente
    await client.fetch_public_file(N20)
    ok["on"] = False
    res = await client.fetch_public_file(N20)
    assert res.stale and res.warnings


async def test_api_area_exige_chave(http, settings):
    with pytest.raises(SourceNotConfiguredError):
        await firms(http, settings).fetch_area(N20, (-56, -3, -54, -2), date(2026, 1, 1), date(2026, 1, 2))


async def test_api_area_divide_em_blocos_e_oculta_chave(http, router, settings):
    router.add("/api/area/csv/", lambda _r: httpx.Response(200, text=synthetic_viirs_nrt_csv(utc_now())))
    client = firms(http, settings, key="SEGREDO123")
    start = date(2026, 1, 1)
    res = await client.fetch_area(N20, (-56.3, -3.3, -54.0, -2.0), start, start + timedelta(days=6))
    assert len(res.request_urls) == 2  # 7 dias -> blocos de 5 + 2 (DAY_RANGE máx. 5)
    assert "/5/2026-01-01" in res.request_urls[0] and "/2/2026-01-06" in res.request_urls[1]
    assert all("SEGREDO123" not in u for u in res.request_urls)
    assert all("***MAP_KEY***" in u for u in res.request_urls)
    # Cabeçalho único após concatenar os blocos
    assert res.content.decode().count("latitude,longitude") == 1


# ------------------------------------------------------------------ POWER
def test_power_fill_value_vira_nulo():
    df, params, header = parse_power_timeseries(synthetic_power_daily(utc_now() - timedelta(days=5), 5, fill_last=2))
    assert len(df) == 5
    assert df["T2M"].isna().sum() == 2
    assert header["fill_value"] == -999.0


def test_power_payload_sem_serie_e_erro():
    with pytest.raises(UpstreamError):
        parse_power_timeseries(b'{"messages": ["bad request"]}')


def test_power_climatologia_por_mes():
    df, _, header = parse_power_climatology(synthetic_power_climatology())
    assert list(df.index[:2]) == ["JAN", "FEB"] and len(df) == 12
    assert "ANN" not in df.index
    assert header["range"].startswith("SYNTHETIC")


async def test_power_cliente_valida_intervalo(http, settings):
    from app.core.errors import ValidationAppError

    client = PowerClient(http, FileCache(settings.cache_dir), base_url="https://power.test", cache_ttl=60)
    with pytest.raises(ValidationAppError):
        await client.daily(-2.0, -54.0, date(2024, 1, 1), date(2025, 6, 1))
    with pytest.raises(ValidationAppError):
        await client.daily(-95.0, -54.0, date(2026, 1, 1), date(2026, 1, 2))
