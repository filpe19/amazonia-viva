"""Integração com NASA FIRMS (Fire Information for Resource Management System).

Dois modos de obtenção, ambos oficiais da NASA:

* ``public_file`` — arquivos regionais públicos de quase tempo real (24h/48h/7d),
  sem credencial: https://firms.modaps.eosdis.nasa.gov/active_fire/
* ``area_api`` — API por área com MAP_KEY (DAY_RANGE 1..5, bbox oeste,sul,leste,norte):
  https://firms.modaps.eosdis.nasa.gov/api/area/

A MAP_KEY nunca é registrada em logs, proveniência ou respostas: toda URL
exibida passa por ``_redact``.
"""

from __future__ import annotations

import hashlib
import io
import logging
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

import numpy as np
import pandas as pd

from app.core.errors import SourceNotConfiguredError, UpstreamError, ValidationAppError
from app.core.http import HttpClient
from app.domain.sources import FirmsProduct, satellite_name
from app.persistence.cache import FileCache

log = logging.getLogger("app.firms")

API_MAX_DAY_RANGE = 5
REQUIRED_COLUMNS = {"latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence"}

# Colunas normalizadas devolvidas pelo parser (ordem estável para CSV/exportação).
NORMALIZED_COLUMNS = [
    "detection_id", "product_id", "sensor", "satellite", "satellite_name", "instrument",
    "latitude", "longitude", "acq_date", "acq_time", "acq_datetime_utc", "daynight",
    "confidence_raw", "confidence_class", "confidence_pct", "frp_mw",
    "bright_ti4_k", "bright_ti5_k", "brightness_k", "bright_t31_k",
    "scan_km", "track_km", "version", "type",
]

VIIRS_CONF_MAP = {"l": "low", "n": "nominal", "h": "high", "low": "low", "nominal": "nominal", "high": "high"}


class FirmsParseError(UpstreamError):
    code = "firms_parse_error"


def parse_firms_csv(content: bytes | str, product: FirmsProduct) -> pd.DataFrame:
    """Converte um CSV do FIRMS (NRT, SP ou arquivo anual) em DataFrame normalizado.

    - Não altera valores científicos; apenas tipa e renomeia com unidade.
    - Confiança é mantida na escala de cada sensor (VIIRS: classe; MODIS: %).
    - Lança ``FirmsParseError`` se a resposta não for um CSV de detecções
      (a API do FIRMS pode responder texto de erro com HTTP 200).
    """
    text = content.decode("utf-8", errors="replace") if isinstance(content, bytes) else content
    text = text.lstrip("﻿")
    first_line = text.split("\n", 1)[0].strip().lower()
    if "latitude" not in first_line or "longitude" not in first_line:
        raise FirmsParseError(
            "Resposta do FIRMS não é um CSV de detecções",
            source="NASA FIRMS",
            detail={"inicio_da_resposta": text[:200]},
        )

    raw = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False)
    raw.columns = [c.strip().lower() for c in raw.columns]
    missing = REQUIRED_COLUMNS - set(raw.columns)
    if missing:
        raise FirmsParseError(
            f"CSV do FIRMS sem colunas obrigatórias: {sorted(missing)}",
            source="NASA FIRMS",
            detail={"colunas": list(raw.columns)},
        )

    df = pd.DataFrame(index=raw.index)
    num = lambda col: pd.to_numeric(raw[col], errors="coerce") if col in raw else np.nan  # noqa: E731

    df["latitude"] = num("latitude")
    df["longitude"] = num("longitude")
    df["acq_date"] = raw["acq_date"].str.strip()
    df["acq_time"] = raw["acq_time"].str.strip().str.zfill(4)
    df["acq_datetime_utc"] = pd.to_datetime(
        df["acq_date"] + " " + df["acq_time"], format="%Y-%m-%d %H%M", errors="coerce", utc=True
    )
    df["satellite"] = raw["satellite"].str.strip()
    df["satellite_name"] = df["satellite"].map(satellite_name)
    df["sensor"] = product.sensor
    df["product_id"] = product.id
    df["instrument"] = raw["instrument"].str.strip() if "instrument" in raw else product.sensor
    df["daynight"] = raw["daynight"].str.strip().str.upper() if "daynight" in raw else None
    df["version"] = raw["version"].str.strip() if "version" in raw else None
    df["type"] = num("type")
    df["frp_mw"] = num("frp")
    df["scan_km"] = num("scan")
    df["track_km"] = num("track")

    conf = raw["confidence"].str.strip()
    df["confidence_raw"] = conf
    if product.sensor == "VIIRS":
        df["confidence_class"] = conf.str.lower().map(VIIRS_CONF_MAP)
        df["confidence_pct"] = np.nan
        df["bright_ti4_k"] = num("bright_ti4")
        df["bright_ti5_k"] = num("bright_ti5")
        df["brightness_k"] = np.nan
        df["bright_t31_k"] = np.nan
    else:
        df["confidence_class"] = None  # MODIS: escala percentual preservada
        df["confidence_pct"] = pd.to_numeric(conf, errors="coerce")
        df["bright_ti4_k"] = np.nan
        df["bright_ti5_k"] = np.nan
        df["brightness_k"] = num("brightness")
        df["bright_t31_k"] = num("bright_t31")

    invalid = df["latitude"].isna() | df["longitude"].isna() | df["acq_datetime_utc"].isna()
    if invalid.any():
        log.warning("firms rows dropped (invalid coords/time)", extra={"product": product.id, "rows": int(invalid.sum())})
        df = df[~invalid]

    key = (
        df["product_id"] + "|" + df["latitude"].round(5).astype(str) + "|" + df["longitude"].round(5).astype(str)
        + "|" + df["acq_date"] + "|" + df["acq_time"] + "|" + df["satellite"]
    )
    df["detection_id"] = key.map(lambda k: hashlib.sha1(k.encode()).hexdigest()[:16])
    return df[NORMALIZED_COLUMNS].reset_index(drop=True)


def _redact(url: str, key: str | None) -> str:
    return url.replace(key, "***MAP_KEY***") if key else url


@dataclass
class FirmsFetch:
    product: FirmsProduct
    mode: str
    request_urls: list[str]
    content: bytes
    fetched_at: datetime
    cache_hit: bool
    stale: bool = False
    http_last_modified: str | None = None
    sha256: str = ""
    warnings: list[str] = field(default_factory=list)


class FirmsClient:
    def __init__(
        self,
        http: HttpClient,
        cache: FileCache,
        *,
        base_url: str,
        map_key: str | None,
        cache_ttl: int,
    ) -> None:
        self._http = http
        self._cache = cache
        self._base = base_url.rstrip("/")
        self._key = (map_key or "").strip() or None
        self._ttl = cache_ttl

    @property
    def key_configured(self) -> bool:
        return self._key is not None

    def preferred_mode(self, product: FirmsProduct) -> str:
        if product.processing == "NRT" and product.public_file_dir and not self._key:
            return "public_file"
        if self._key:
            return "area_api"
        return "public_file" if product.public_file_dir else "unavailable"

    # ------------------------------------------------------------------ NRT
    async def fetch_public_file(self, product: FirmsProduct, period: str = "7d") -> FirmsFetch:
        if period not in {"24h", "48h", "7d"}:
            raise ValidationAppError("period deve ser 24h, 48h ou 7d")
        url = product.public_file_url(self._base, "South_America", period)
        if not url:
            raise ValidationAppError(f"{product.id} não possui arquivo público NRT")
        return await self._cached_get(f"public:{url}", url, safe_url=url, product=product, mode="public_file")

    async def fetch_area(
        self, product: FirmsProduct, bbox: tuple[float, float, float, float], start: date, end: date
    ) -> FirmsFetch:
        """Consulta a API por área cobrindo [start, end] em blocos de até 5 dias."""
        if not self._key:
            raise SourceNotConfiguredError(
                "A API por área do FIRMS exige FIRMS_MAP_KEY no back-end",
                source="NASA FIRMS",
                detail={"como_obter": "https://firms.modaps.eosdis.nasa.gov/api/map_key/"},
            )
        if end < start:
            raise ValidationAppError("intervalo de datas inválido")
        w, s, e, n = bbox
        area = f"{w:.4f},{s:.4f},{e:.4f},{n:.4f}"
        parts: list[bytes] = []
        urls: list[str] = []
        hits: list[bool] = []
        stale_any = False
        newest: FirmsFetch | None = None
        cursor = start
        while cursor <= end:
            span = min(API_MAX_DAY_RANGE, (end - cursor).days + 1)
            url = f"{self._base}/api/area/csv/{self._key}/{product.id}/{area}/{span}/{cursor.isoformat()}"
            safe = _redact(url, self._key)
            res = await self._cached_get(f"area:{safe}", url, safe_url=safe, product=product, mode="area_api")
            parse_firms_csv(res.content, product)  # valida antes de concatenar
            parts.append(res.content)
            urls.append(safe)
            hits.append(res.cache_hit)
            stale_any = stale_any or res.stale
            newest = res if newest is None or res.fetched_at > newest.fetched_at else newest
            cursor += timedelta(days=span)
        header, *_ = parts[0].decode().split("\n", 1)
        body = [header] + [line for p in parts for line in p.decode().split("\n")[1:] if line.strip()]
        content = ("\n".join(body) + "\n").encode()
        assert newest is not None
        return FirmsFetch(
            product=product, mode="area_api", request_urls=urls, content=content,
            fetched_at=newest.fetched_at, cache_hit=all(hits), stale=stale_any,
            sha256=hashlib.sha256(content).hexdigest(),
        )

    async def data_availability(self, sensor: str = "ALL") -> str:
        if not self._key:
            raise SourceNotConfiguredError("data_availability exige FIRMS_MAP_KEY", source="NASA FIRMS")
        url = f"{self._base}/api/data_availability/csv/{self._key}/{sensor}"
        res = await self._http.get(url, source="NASA FIRMS", safe_url=_redact(url, self._key))
        return res.text

    # ------------------------------------------------------------ internals
    async def _cached_get(self, cache_key: str, url: str, *, safe_url: str, product: FirmsProduct, mode: str) -> FirmsFetch:
        entry = self._cache.get(cache_key)
        if entry and entry.is_fresh(self._ttl):
            return self._from_entry(entry, product, mode, cache_hit=True, stale=False)
        try:
            res = await self._http.get(url, source="NASA FIRMS", safe_url=safe_url)
            parse_firms_csv(res.content, product)  # não cacheia respostas inválidas
        except UpstreamError as exc:
            if entry:
                log.warning("firms upstream failed, serving stale cache", extra={"product": product.id, "error": exc.message})
                fetch = self._from_entry(entry, product, mode, cache_hit=True, stale=True)
                fetch.warnings.append(f"Fonte indisponível agora ({exc.message}); exibindo cópia anterior.")
                return fetch
            raise
        meta = self._cache.put(
            cache_key,
            res.content,
            {
                "url": safe_url,
                "fetched_at": datetime.now(UTC).isoformat(),
                "http_last_modified": res.headers.get("last-modified"),
                "product_id": product.id,
                "mode": mode,
            },
        )
        return FirmsFetch(
            product=product, mode=mode, request_urls=[safe_url], content=res.content,
            fetched_at=datetime.fromisoformat(meta["fetched_at"]), cache_hit=False,
            http_last_modified=meta.get("http_last_modified"), sha256=meta["sha256"],
        )

    @staticmethod
    def _from_entry(entry, product: FirmsProduct, mode: str, *, cache_hit: bool, stale: bool) -> FirmsFetch:
        m = entry.meta
        return FirmsFetch(
            product=product, mode=mode, request_urls=[m.get("url", "")], content=entry.content,
            fetched_at=datetime.fromisoformat(m["fetched_at"]), cache_hit=cache_hit, stale=stale,
            http_last_modified=m.get("http_last_modified"), sha256=m.get("sha256", ""),
        )
