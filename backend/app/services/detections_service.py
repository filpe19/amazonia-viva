"""Consulta de detecções recentes (NRT) por região, janela e produto."""

from __future__ import annotations

import asyncio
import logging
import math
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

import pandas as pd

from app.core.errors import AppError, ValidationAppError
from app.domain.regions import Region, RegionRegistry
from app.domain.sources import (
    DEFAULT_NRT_PRODUCTS,
    FIRMS_LATENCY_SOURCE,
    FIRMS_NOMINAL_LATENCY,
    FirmsProduct,
    get_product,
)
from app.integrations.firms import FirmsClient, FirmsFetch, parse_firms_csv

log = logging.getLogger("app.detections")

WINDOWS = {"24h": 24, "48h": 48, "7d": 168}
COVERAGE_TOLERANCE = timedelta(hours=3)


@dataclass
class ProductResult:
    product: FirmsProduct
    frame: pd.DataFrame
    fetch: FirmsFetch | None
    error: AppError | None = None
    source_earliest: datetime | None = None
    source_latest: datetime | None = None
    rows_in_source: int = 0
    coverage_note: str | None = None


@dataclass
class DetectionQuery:
    region: Region
    window: str
    window_start: datetime
    window_end: datetime
    generated_at: datetime
    daynight: str
    results: list[ProductResult] = field(default_factory=list)

    @property
    def frame(self) -> pd.DataFrame:
        frames = [r.frame for r in self.results if not r.frame.empty]
        return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def parse_products(spec: str | None) -> list[FirmsProduct]:
    ids = [p.strip() for p in (spec or "").split(",") if p.strip()] or DEFAULT_NRT_PRODUCTS
    products = [get_product(i) for i in dict.fromkeys(ids)]
    bad = [p.id for p in products if p.processing != "NRT"]
    if bad:
        raise ValidationAppError("A tela de situação atual aceita apenas produtos NRT", detail={"recebidos": bad})
    return products


def _none_if_nan(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


class DetectionsService:
    def __init__(self, firms: FirmsClient, regions: RegionRegistry) -> None:
        self._firms = firms
        self._regions = regions
        self._parsed: OrderedDict[str, pd.DataFrame] = OrderedDict()  # sha256 -> frame (LRU)

    def _parse_cached(self, fetch: FirmsFetch) -> pd.DataFrame:
        key = f"{fetch.product.id}:{fetch.sha256}"
        if key in self._parsed:
            self._parsed.move_to_end(key)
            return self._parsed[key]
        df = parse_firms_csv(fetch.content, fetch.product)
        self._parsed[key] = df
        while len(self._parsed) > 12:
            self._parsed.popitem(last=False)
        return df

    async def _fetch_product(self, product: FirmsProduct, region: Region, start: datetime, end: datetime) -> FirmsFetch:
        if self._firms.preferred_mode(product) == "area_api":
            return await self._firms.fetch_area(product, region.bbox, start.date(), end.date())
        return await self._firms.fetch_public_file(product, "7d")

    async def query(
        self,
        region_id: str,
        window: str = "24h",
        products: str | None = None,
        daynight: str = "all",
        now: datetime | None = None,
    ) -> DetectionQuery:
        if window not in WINDOWS:
            raise ValidationAppError("window deve ser 24h, 48h ou 7d")
        if daynight not in ("all", "D", "N"):
            raise ValidationAppError("daynight deve ser all, D ou N")
        region = self._regions.get(region_id)
        prods = parse_products(products)
        now = now or datetime.now(UTC)
        start = now - timedelta(hours=WINDOWS[window])
        q = DetectionQuery(region, window, start, now, now, daynight)

        fetches = await asyncio.gather(
            *(self._fetch_product(p, region, start, now) for p in prods), return_exceptions=True
        )
        for product, fetch in zip(prods, fetches, strict=True):
            if isinstance(fetch, AppError):
                log.warning("product unavailable", extra={"product": product.id, "error": fetch.message})
                q.results.append(ProductResult(product, pd.DataFrame(), None, error=fetch))
                continue
            if isinstance(fetch, BaseException):
                raise fetch
            df = self._parse_cached(fetch)
            res = ProductResult(product, pd.DataFrame(), fetch, rows_in_source=len(df))
            if not df.empty:
                res.source_earliest = df["acq_datetime_utc"].min().to_pydatetime()
                res.source_latest = df["acq_datetime_utc"].max().to_pydatetime()
                if res.source_earliest > start + COVERAGE_TOLERANCE:
                    res.coverage_note = (
                        f"A fonte cobre observações apenas a partir de {res.source_earliest:%d/%m %H:%M} UTC; "
                        "o início da janela pode estar incompleto."
                    )
                sel = df["acq_datetime_utc"] >= start
                if daynight != "all":
                    sel &= df["daynight"] == daynight
                sub = df[sel]
                if not sub.empty:
                    sub = sub[region.contains(sub["longitude"].to_numpy(), sub["latitude"].to_numpy())]
                res.frame = sub.reset_index(drop=True)
            q.results.append(res)
        return q

    async def find(self, product_id: str, detection_id: str) -> dict | None:
        product = get_product(product_id)
        try:
            fetch = await self._firms.fetch_public_file(product, "7d") if product.public_file_dir and not self._firms.key_configured else None
        except AppError:
            fetch = None
        frames = [self._parse_cached(fetch)] if fetch else []
        frames += [f for k, f in self._parsed.items() if k.startswith(f"{product_id}:")]
        for f in frames:
            hit = f[f["detection_id"] == detection_id]
            if not hit.empty:
                return record_to_dict(hit.iloc[0])
        return None


# ------------------------------------------------------------- serialização
def record_to_dict(row: pd.Series) -> dict:
    d = {k: _none_if_nan(v) for k, v in row.to_dict().items()}
    ts = row["acq_datetime_utc"]
    d["acq_datetime_utc"] = ts.isoformat().replace("+00:00", "Z") if pd.notna(ts) else None
    if d.get("type") is not None:
        d["type"] = int(d["type"])
    return d


def to_feature_collection(q: DetectionQuery) -> dict:
    """GeoJSON compacto para o mapa (detalhe completo em /detections/{produto}/{id})."""
    features = []
    for r in q.results:
        f = r.frame
        if f.empty:
            continue
        times = f["acq_datetime_utc"].dt.strftime("%Y-%m-%dT%H:%MZ").tolist()
        if r.product.sensor == "VIIRS":
            conf = [c if isinstance(c, str) else None for c in f["confidence_class"].tolist()]
        else:
            conf = [None if pd.isna(c) else int(c) for c in f["confidence_pct"].tolist()]
        frp = [None if pd.isna(v) else float(v) for v in f["frp_mw"].tolist()]
        rows = zip(
            f["longitude"].round(5).tolist(), f["latitude"].round(5).tolist(), f["detection_id"].tolist(),
            f["satellite_name"].tolist(), times, frp, conf, f["daynight"].tolist(), strict=True,
        )
        pid = r.product.id
        features.extend(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {"id": did, "p": pid, "s": sat, "t": t, "frp": fv, "c": c, "dn": dn},
            }
            for lon, lat, did, sat, t, fv, c, dn in rows
        )
    return {"type": "FeatureCollection", "features": features, "metadata": query_metadata(q)}


def _iso(dt: datetime | None) -> str | None:
    return dt.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z") if dt else None


def product_summary(r: ProductResult) -> dict:
    p = r.product
    f = r.frame
    base = {
        "product_id": p.id,
        "sensor": p.sensor,
        "platform": p.platform,
        "processing": p.processing,
        "collection": p.collection,
        "resolution_m": p.resolution_m,
        "confidence_scale": p.confidence_scale,
        "status": p.status,
        "status_note": p.status_note,
        "available": r.error is None,
        "error": None if r.error is None else {"code": r.error.code, "message": r.error.message, "detail": r.error.detail},
        "count": int(len(f)),
    }
    if r.fetch:
        fx = r.fetch
        base["provenance"] = {
            "source": "NASA FIRMS",
            "mode": fx.mode,
            "request_urls": fx.request_urls,
            "fetched_at": _iso(fx.fetched_at),
            "cache_hit": fx.cache_hit,
            "stale": fx.stale,
            "http_last_modified": fx.http_last_modified,
            "sha256": fx.sha256,
            "rows_in_source": r.rows_in_source,
            "source_earliest_observation_utc": _iso(r.source_earliest),
            "source_latest_observation_utc": _iso(r.source_latest),
            "nominal_latency": FIRMS_NOMINAL_LATENCY,
            "nominal_latency_source": FIRMS_LATENCY_SOURCE,
            "versions": sorted(f["version"].dropna().unique().tolist()) if not f.empty else [],
            "warnings": fx.warnings + ([r.coverage_note] if r.coverage_note else []),
        }
    if not f.empty:
        frp = f["frp_mw"].dropna()
        base["latest_observation_utc"] = _iso(f["acq_datetime_utc"].max().to_pydatetime())
        base["by_daynight"] = {k: int(v) for k, v in f["daynight"].value_counts().items()}
        base["by_satellite"] = {k: int(v) for k, v in f["satellite_name"].value_counts().items()}
        base["by_day_utc"] = {k: int(v) for k, v in f["acq_date"].value_counts().sort_index().items()}
        if p.sensor == "VIIRS":
            base["by_confidence"] = {k: int(v) for k, v in f["confidence_class"].value_counts().items()}
        else:
            pct = f["confidence_pct"].dropna()
            base["confidence_pct_quartiles"] = [float(x) for x in pct.quantile([0.25, 0.5, 0.75])] if len(pct) else None
        base["frp_mw"] = {
            "n_with_value": int(len(frp)),
            "median": float(frp.median()) if len(frp) else None,
            "p90": float(frp.quantile(0.9)) if len(frp) else None,
            "max": float(frp.max()) if len(frp) else None,
        }
    else:
        base["latest_observation_utc"] = None
    return base


def query_metadata(q: DetectionQuery) -> dict:
    latest = [r.frame["acq_datetime_utc"].max() for r in q.results if not r.frame.empty]
    fetched = [r.fetch.fetched_at for r in q.results if r.fetch]
    return {
        "region": q.region.summary(),
        "window": {"label": q.window, "start_utc": _iso(q.window_start), "end_utc": _iso(q.window_end)},
        "daynight": q.daynight,
        "generated_at": _iso(q.generated_at),
        "platform_data_fetched_at": _iso(max(fetched)) if fetched else None,
        "latest_observation_utc": _iso(max(latest).to_pydatetime()) if latest else None,
        "total_count_note": "Contagens são por produto. Não some produtos de sensores diferentes; "
                            "uma detecção é um pixel com anomalia térmica, não um incêndio individual.",
        "products": [product_summary(r) for r in q.results],
    }


def daily_counts_complete_days(df: pd.DataFrame, end_day: date, n_days: int) -> dict[str, int]:
    days = [(end_day - timedelta(days=i)).isoformat() for i in range(n_days - 1, -1, -1)]
    counts = df["acq_date"].value_counts() if not df.empty else pd.Series(dtype=int)
    return {d: int(counts.get(d, 0)) for d in days}


async def detections_in_bbox(service: DetectionsService, bbox: tuple[float, float, float, float], window: str = "7d",
                             products: str = "VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT",
                             now: datetime | None = None) -> tuple[pd.DataFrame, list[dict]]:
    """Detecções NRT num retângulo (sem recorte poligonal): usado em proximidade, para não perder
    focos logo além da divisa municipal. Devolve o DataFrame e a proveniência por produto."""
    now = now or datetime.now(UTC)
    start = now - timedelta(hours=WINDOWS[window])
    w, s, e, n = bbox
    frames, prov = [], []
    for product in parse_products(products):
        try:
            fetch = await service._firms.fetch_public_file(product, "7d") if not service._firms.key_configured \
                else await service._firms.fetch_area(product, bbox, start.date(), now.date())
        except AppError as exc:
            prov.append({"product_id": product.id, "available": False, "error": exc.message})
            continue
        df = service._parse_cached(fetch)
        sel = (df["acq_datetime_utc"] >= start) & df["longitude"].between(w, e) & df["latitude"].between(s, n)
        frames.append(df[sel])
        prov.append({"product_id": product.id, "available": True, "fetched_at": _iso(fetch.fetched_at),
                     "request_urls": fetch.request_urls, "sha256": fetch.sha256})
    out = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    return out, prov
