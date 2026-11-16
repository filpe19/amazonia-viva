from __future__ import annotations

import io
from datetime import UTC, datetime
from enum import StrEnum

import pandas as pd
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.api.container import Container, get_container
from app.api.responses import big_json
from app.core.errors import NotFoundError
from app.services.detections_service import query_metadata, to_feature_collection

router = APIRouter(prefix="/detections", tags=["detecções"])


class Window(StrEnum):
    h24 = "24h"
    h48 = "48h"
    d7 = "7d"


class DayNight(StrEnum):
    all = "all"
    day = "D"
    night = "N"


PRODUCTS_HELP = "Lista separada por vírgula. Padrão: VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT"


@router.get("")
async def detections(
    region: str = Query("para", description="brasil | para | santarem"),
    window: Window = Query(Window.h24),
    products: str | None = Query(None, description=PRODUCTS_HELP),
    daynight: DayNight = Query(DayNight.all),
    c: Container = Depends(get_container),
) -> dict:
    """Últimas observações por satélite (GeoJSON compacto + metadados de proveniência)."""
    import asyncio

    q = await c.detections.query(region, window.value, products, daynight.value)
    # Serializar dezenas de milhares de feições (escala amazônica) fora do laço de eventos.
    return await big_json(await asyncio.to_thread(to_feature_collection, q))


@router.get("/summary")
async def summary(
    region: str = Query("para"),
    window: Window = Query(Window.h24),
    products: str | None = Query(None, description=PRODUCTS_HELP),
    daynight: DayNight = Query(DayNight.all),
    c: Container = Depends(get_container),
) -> dict:
    q = await c.detections.query(region, window.value, products, daynight.value)
    return query_metadata(q)


@router.get("/export.csv")
async def export_csv(
    region: str = Query("para"),
    window: Window = Query(Window.h24),
    products: str | None = Query(None, description=PRODUCTS_HELP),
    daynight: DayNight = Query(DayNight.all),
    c: Container = Depends(get_container),
) -> StreamingResponse:
    """Exporta os registros reais da consulta, com colunas de proveniência por linha."""
    q = await c.detections.query(region, window.value, products, daynight.value)
    frames = []
    for r in q.results:
        if r.frame.empty or not r.fetch:
            continue
        f = r.frame.copy()
        f["acq_datetime_utc"] = f["acq_datetime_utc"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        f["source"] = "NASA FIRMS"
        f["source_mode"] = r.fetch.mode
        f["source_url"] = " ".join(r.fetch.request_urls)
        f["source_fetched_at_utc"] = r.fetch.fetched_at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        f["source_sha256"] = r.fetch.sha256
        f["region_id"] = q.region.id
        f["query_window"] = q.window
        frames.append(f)
    out = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    buf = io.StringIO()
    out.to_csv(buf, index=False)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%MZ")
    name = f"amazonia-viva_deteccoes_{q.region.id}_{q.window}_{stamp}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/{product_id}/{detection_id}/evidence")
async def detection_evidence(product_id: str, detection_id: str, c: Container = Depends(get_container)) -> dict:
    """'É incêndio mesmo?': confirmação por outras passagens, fonte estática (FIRMS type 2), histórico local,
    mineração/garimpo (ANM, DETER) e desmatamento recente (DETER). Indícios, não diagnóstico."""
    out = await c.heat_source.evidence(product_id, detection_id)
    if not out:
        raise NotFoundError("Detecção não encontrada no conjunto NRT atual (pode ter saído da janela de 7 dias)")
    return out


@router.get("/{product_id}/{detection_id}")
async def detection_detail(product_id: str, detection_id: str, c: Container = Depends(get_container)) -> dict:
    rec = await c.detections.find(product_id, detection_id)
    if not rec:
        raise NotFoundError("Detecção não encontrada no conjunto NRT atual (pode ter saído da janela de 7 dias)")
    return rec
