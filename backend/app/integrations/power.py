"""Integração com NASA POWER (Prediction Of Worldwide Energy Resources).

https://power.larc.nasa.gov/docs/services/api/

Os valores do POWER são **reanálise/modelo em grade** (GEOS-IT / MERRA-2), com
latência de alguns dias e resolução de ~0,5° × 0,625°. Não são medições de
estação nem medições instantâneas no local de uma detecção.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

import pandas as pd

from app.core.errors import UpstreamError, ValidationAppError
from app.core.http import HttpClient
from app.persistence.cache import FileCache

log = logging.getLogger("app.power")

DAILY_PARAMS = ["T2M", "T2M_MAX", "RH2M", "WS10M", "WD10M", "PRECTOTCORR"]
HOURLY_PARAMS = ["T2M", "RH2M", "WS10M", "WD10M", "PRECTOTCORR"]
# T2M_MAX não entra na climatologia: nela o valor é a máxima horária do MÊS, não
# comparável com a máxima diária da série recente. Compare T2M com T2M.
CLIMATOLOGY_PARAMS = ["T2M", "RH2M", "WS10M", "PRECTOTCORR"]
MONTH_KEYS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


class PowerParseError(UpstreamError):
    code = "power_parse_error"


@dataclass
class PowerSeries:
    frame: pd.DataFrame  # índice: data/hora; colunas: parâmetros (NaN = sem dado)
    parameters: dict[str, dict]  # unidades e nomes longos devolvidos pela API
    header: dict
    request_url: str
    fetched_at: datetime
    cache_hit: bool
    stale: bool = False
    warnings: list[str] = field(default_factory=list)


def parse_power_timeseries(payload: dict | bytes, *, hourly: bool = False) -> tuple[pd.DataFrame, dict, dict]:
    data = json.loads(payload) if isinstance(payload, (bytes, str)) else payload
    if "properties" not in data or "parameter" not in data.get("properties", {}):
        msgs = data.get("messages") or data.get("errors") or data.get("detail")
        raise PowerParseError("Resposta do NASA POWER sem série temporal", source="NASA POWER", detail={"mensagens": msgs})
    header = data.get("header", {})
    fill = header.get("fill_value", -999.0)
    series = data["properties"]["parameter"]
    df = pd.DataFrame(series)
    if df.empty:
        return df, data.get("parameters", {}), header
    df = df.apply(pd.to_numeric, errors="coerce").mask(lambda x: x == fill)
    fmt = "%Y%m%d%H" if hourly else "%Y%m%d"
    df.index = pd.to_datetime(df.index, format=fmt)
    df = df.sort_index()
    return df, data.get("parameters", {}), header


def parse_power_climatology(payload: dict | bytes) -> tuple[pd.DataFrame, dict, dict]:
    data = json.loads(payload) if isinstance(payload, (bytes, str)) else payload
    if "properties" not in data:
        raise PowerParseError("Resposta de climatologia do NASA POWER inválida", source="NASA POWER")
    header = data.get("header", {})
    fill = header.get("fill_value", -999.0)
    df = pd.DataFrame(data["properties"]["parameter"]).reindex(MONTH_KEYS)
    df = df.apply(pd.to_numeric, errors="coerce").mask(lambda x: x == fill)
    return df, data.get("parameters", {}), header


class PowerClient:
    def __init__(self, http: HttpClient, cache: FileCache, *, base_url: str, cache_ttl: int) -> None:
        self._http = http
        self._cache = cache
        self._base = base_url.rstrip("/")
        self._ttl = cache_ttl

    @staticmethod
    def _validate_point(lat: float, lon: float) -> None:
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValidationAppError("Coordenadas fora do intervalo válido")

    async def daily(self, lat: float, lon: float, start: date, end: date, params: list[str] | None = None) -> PowerSeries:
        self._validate_point(lat, lon)
        if (end - start).days > 366:
            raise ValidationAppError("Intervalo máximo de 366 dias por consulta diária")
        p = ",".join(params or DAILY_PARAMS)
        url = (
            f"{self._base}/api/temporal/daily/point?parameters={p}&community=AG"
            f"&longitude={lon:.4f}&latitude={lat:.4f}&start={start:%Y%m%d}&end={end:%Y%m%d}&format=JSON"
        )
        content, meta, hit, stale, warnings = await self._cached(url)
        df, parameters, header = parse_power_timeseries(content, hourly=False)
        return PowerSeries(df, parameters, header, url, meta, hit, stale, warnings)

    async def hourly(self, lat: float, lon: float, start: date, end: date, params: list[str] | None = None) -> PowerSeries:
        self._validate_point(lat, lon)
        if (end - start).days > 31:
            raise ValidationAppError("Intervalo máximo de 31 dias por consulta horária")
        p = ",".join(params or HOURLY_PARAMS)
        url = (
            f"{self._base}/api/temporal/hourly/point?parameters={p}&community=AG"
            f"&longitude={lon:.4f}&latitude={lat:.4f}&start={start:%Y%m%d}&end={end:%Y%m%d}"
            f"&format=JSON&time-standard=UTC"
        )
        content, meta, hit, stale, warnings = await self._cached(url)
        df, parameters, header = parse_power_timeseries(content, hourly=True)
        return PowerSeries(df, parameters, header, url, meta, hit, stale, warnings)

    async def climatology(self, lat: float, lon: float, params: list[str] | None = None) -> PowerSeries:
        self._validate_point(lat, lon)
        p = ",".join(params or CLIMATOLOGY_PARAMS)
        url = (
            f"{self._base}/api/temporal/climatology/point?parameters={p}&community=AG"
            f"&longitude={lon:.4f}&latitude={lat:.4f}&format=JSON"
        )
        content, meta, hit, stale, warnings = await self._cached(url, ttl=30 * 86400)
        df, parameters, header = parse_power_climatology(content)
        return PowerSeries(df, parameters, header, url, meta, hit, stale, warnings)

    async def _cached(self, url: str, ttl: int | None = None):
        ttl = self._ttl if ttl is None else ttl
        key = f"power:{url}"
        entry = self._cache.get(key)
        if entry and entry.is_fresh(ttl):
            return entry.content, datetime.fromisoformat(entry.meta["fetched_at"]), True, False, []
        try:
            res = await self._http.get(url, source="NASA POWER")
            json.loads(res.content)
        except (UpstreamError, ValueError) as exc:
            if entry:
                msg = exc.message if isinstance(exc, UpstreamError) else "resposta inválida"
                return (entry.content, datetime.fromisoformat(entry.meta["fetched_at"]), True, True,
                        [f"NASA POWER indisponível agora ({msg}); exibindo cópia anterior."])
            if isinstance(exc, ValueError):
                raise PowerParseError("NASA POWER devolveu conteúdo não-JSON", source="NASA POWER") from exc
            raise
        meta = self._cache.put(key, res.content, {"url": url, "fetched_at": datetime.now(UTC).isoformat()})
        return res.content, datetime.fromisoformat(meta["fetched_at"]), False, False, []
