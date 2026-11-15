"""Amazônia Viva — API FastAPI."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.api.container import build_container
from app.api.routes import analysis, detections, meta
from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.core.logging import configure_logging

log = logging.getLogger("app")


def create_app(settings: Settings | None = None, container=None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_format)

    async def warm_nrt_cache(c) -> None:
        """Mantém os arquivos NRT do FIRMS aquecidos: requisições do usuário não esperam o download."""
        from app.domain.sources import PRODUCTS

        while True:
            for pid in ("VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "MODIS_NRT"):
                try:
                    await c.firms.fetch_public_file(PRODUCTS[pid], "7d")
                except Exception as exc:  # noqa: BLE001 - registra e tenta no próximo ciclo
                    log.warning("warm cache failed", extra={"product": pid, "error": str(exc)})
            await asyncio.sleep(max(120, settings.firms_nrt_cache_ttl_seconds - 120))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.container = container or build_container(settings)
        log.info("startup", extra={"firms_key": settings.firms_key_configured,
                                   "regions": len(app.state.container.regions.all())})
        task = None
        if settings.environment != "test" and container is None and not settings.firms_key_configured:
            task = asyncio.create_task(warm_nrt_cache(app.state.container))
        yield
        if task:
            task.cancel()
        await app.state.container.aclose()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Plataforma de inteligência ambiental sobre detecções de calor NASA FIRMS (MODIS/VIIRS).",
        lifespan=lifespan,
    )
    app.add_middleware(GZipMiddleware, minimum_size=2048)
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET"], allow_headers=["*"],
    )

    @app.middleware("http")
    async def access_log(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        log.info("request", extra={"rid": rid, "method": request.method, "path": request.url.path,
                                   "status": response.status_code, "ms": int((time.perf_counter() - started) * 1000)})
        return response

    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError):
        level = logging.WARNING if exc.status_code < 500 else logging.ERROR
        log.log(level, "app error", extra={"code": exc.code, "error": exc.message, "source": exc.source})
        return JSONResponse(status_code=exc.status_code, content={
            "error": {"code": exc.code, "message": exc.message, "source": exc.source, "detail": exc.detail}
        })

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={
            "error": {"code": "invalid_parameters", "message": "Parâmetros inválidos", "detail": exc.errors()}
        })

    prefix = "/api/v1"
    app.include_router(meta.router, prefix=prefix)
    app.include_router(detections.router, prefix=prefix)
    for r in (analysis.weather, analysis.history, analysis.territory, analysis.reports):
        app.include_router(r, prefix=prefix)
    return app


app = create_app()
