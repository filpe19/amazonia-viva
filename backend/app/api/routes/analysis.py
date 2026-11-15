"""Rotas de contexto ambiental, histórico, território e evidências."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.api.container import Container, get_container
from app.core.errors import ValidationAppError
from app.services.territory_service import LIMITATIONS

weather = APIRouter(prefix="/weather", tags=["contexto ambiental"])
history = APIRouter(prefix="/history", tags=["inteligência histórica"])
territory = APIRouter(prefix="/territory", tags=["análise territorial"])
reports = APIRouter(prefix="/reports", tags=["evidências"])


def _point(c: Container, region: str | None, lat: float | None, lon: float | None) -> tuple[float, float, str]:
    if lat is not None and lon is not None:
        return lat, lon, "coordenada informada"
    if lat is not None or lon is not None:
        raise ValidationAppError("Informe lat e lon juntos")
    r = c.regions.get(region or "santarem")
    lon_c, lat_c = r.centroid
    return lat_c, lon_c, f"centroide do limite IBGE de {r.definition.name}"


# ------------------------------------------------------------------ meteorologia
@weather.get("/context")
async def weather_context(
    region: str | None = Query("santarem"),
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    days: int = Query(30, ge=7, le=90),
    c: Container = Depends(get_container),
) -> dict:
    la, lo, basis = _point(c, region, lat, lon)
    data = await c.weather.context(la, lo, days)
    data["point"]["basis"] = basis
    return data


# --------------------------------------------------------------------- histórico
@history.get("/status")
def history_status(c: Container = Depends(get_container)) -> dict:
    return c.history.status()


@history.get("/monthly")
def history_monthly(
    region: str = Query("para"),
    product: str = Query("MODIS_SP"),
    satellites: str | None = Query(None, description="Terra,Aqua | Suomi NPP | NOAA-20"),
    start_year: int | None = Query(None, ge=2000, le=2100),
    end_year: int | None = Query(None, ge=2000, le=2100),
    daynight: Literal["D", "N"] | None = None,
    vegetation_only: bool = Query(False, description="Somente type=0 (vegetação presumida)"),
    c: Container = Depends(get_container),
) -> dict:
    return c.history.monthly(region, product, satellites, start_year, end_year, daynight, vegetation_only)


@history.get("/calendar")
def history_calendar(
    region: str = Query("para"), product: str = Query("MODIS_SP"), year: int = Query(..., ge=2000, le=2100),
    satellites: str | None = None, c: Container = Depends(get_container),
) -> dict:
    return c.history.calendar(region, product, year, satellites)


@history.get("/compare")
def history_compare(
    region: str = Query("para"), product: str = Query("MODIS_SP"),
    a_start: date = Query(...), a_end: date = Query(...), b_start: date = Query(...), b_end: date = Query(...),
    satellites: str | None = None, c: Container = Depends(get_container),
) -> dict:
    if a_end < a_start or b_end < b_start:
        raise ValidationAppError("Intervalos inválidos")
    return c.history.compare_periods(region, product, a_start, a_end, b_start, b_end, satellites)


@history.get("/overlap")
def history_overlap(
    region: str = Query("para"),
    ref_satellites: str | None = Query("Aqua", description="Satélites MODIS de referência"),
    other: Literal["VIIRS_SNPP_SP", "VIIRS_NOAA20_SP"] = Query("VIIRS_NOAA20_SP", description="Produto VIIRS comparado"),
    c: Container = Depends(get_container),
) -> dict:
    return c.history.overlap(region, "MODIS_SP", other, ref_satellites)


@history.get("/coverage")
def history_coverage(region: str = Query("portel"), c: Container = Depends(get_container)) -> dict:
    """Auditoria de cobertura, versão, processamento e incertezas por produto no território."""
    return c.history.coverage_report(region)


@history.get("/harmonization-experiment")
def history_harmonization_experiment(
    region: str = Query("portel"),
    other: Literal["VIIRS_SNPP_SP", "VIIRS_NOAA20_SP"] = Query("VIIRS_NOAA20_SP"),
    ref_satellites: str | None = Query("Aqua"),
    c: Container = Depends(get_container),
) -> dict:
    """Experimento: séries normalizadas (sem soma) e validação deixa-um-ano-de-fora de uma conversão por razão."""
    return c.history.harmonization_experiment(region, other, ref_satellites)


@history.get("/harmonized")
def history_harmonized(region: str = Query("portel"), c: Container = Depends(get_container)) -> dict:
    """Calendário harmonizado EXPERIMENTAL (equivalente VIIRS NOAA-20), com faixa de incerteza e validação."""
    return c.history.harmonized(region)


@history.get("/harmonized.csv")
def history_harmonized_csv(region: str = Query("portel"), start_year: int | None = None, end_year: int | None = None,
                           c: Container = Depends(get_container)):
    from fastapi.responses import StreamingResponse

    h = c.history.harmonized(region)
    rows = [r for r in h["series"] if (start_year is None or r["year"] >= start_year) and (end_year is None or r["year"] <= end_year)]
    import csv
    import io

    buf = io.StringIO()
    buf.write(f"# Amazônia Viva — série harmonizada EXPERIMENTAL ({h['units']}); não validada operacionalmente. Território: {region}.\n")
    buf.write(f"# Método: {h['method']}\n")
    w = csv.writer(buf)
    w.writerow(["year_month", "harmonized_value", "low_p10", "high_p90", "origin", "modis_aqua_count", "viirs_noaa20_count"])
    for r in rows:
        w.writerow([r["year_month"], None if r["value"] is None else round(r["value"], 1), None if r["low"] is None else round(r["low"], 1),
                    None if r["high"] is None else round(r["high"], 1), r["origin"], r["modis_n"], r["viirs_n"]])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="amazonia-viva_harmonizado_{region}.csv"'})


@history.get("/export.csv")
def history_export_csv(region: str = Query("portel"), product: Literal["MODIS_SP", "VIIRS_NOAA20_SP", "VIIRS_SNPP_SP"] = "VIIRS_NOAA20_SP",
                       start: date = Query(...), end: date = Query(...), c: Container = Depends(get_container)):
    """Focos (registros) do arquivo FIRMS no território e período, com proveniência por linha."""
    from fastapi.responses import StreamingResponse

    if end < start:
        raise ValidationAppError("Período inválido")
    gen = c.history.export_records(region, product, start, end)
    first = next(gen)  # valida parâmetros antes de iniciar a resposta
    return StreamingResponse(iter([first, *gen]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="amazonia-viva_focos_{product}_{region}_{start}_{end}.csv"'})


# --------------------------------------------------------------------- território
@territory.get("/{region_id}/brief")
async def territory_brief(
    region_id: str,
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    c: Container = Depends(get_container),
) -> dict:
    out = await c.territory.brief(region_id, lat, lon)
    out.pop("_viirs_frame", None)
    return out


@territory.get("/{region_id}/context")
async def territory_context(region_id: str, c: Container = Depends(get_container)) -> dict:
    """Territórios oficiais sobrepostos (FUNAI, CNUC, INCRA via Censipam), população Censo 2022 e eventos Censipam."""
    q = await c.detections.query(region_id, "7d", "VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT")
    return await c.context.context(region_id, q.frame if not q.frame.empty else None)


@territory.get("/{region_id}/impact")
async def territory_impact(region_id: str, c: Container = Depends(get_container)) -> dict:
    """Localidades (IBGE), unidades de saúde (CNES), pistas e brigadas perto das detecções; exposição potencial por setores."""
    return await c.impact.impact(region_id)


@territory.get("/{region_id}/ficha")
async def territory_ficha(region_id: str, c: Container = Depends(get_container)) -> dict:
    """Ficha de Atenção Territorial: detecções, comparação, ambiente, território, Censipam, sinais e avaliação humana."""
    return await c.territory.ficha(region_id)


# --------------------------------------------------------------------- evidências
@reports.get("/evidence")
async def evidence(
    region: str = Query("para"),
    window: Literal["24h", "48h", "7d"] = "24h",
    products: str | None = None,
    daynight: Literal["all", "D", "N"] = "all",
    c: Container = Depends(get_container),
) -> dict:
    """Manifesto de evidências: parâmetros, fontes, contagens, proveniência e limitações."""
    q = await c.detections.query(region, window, products, daynight)
    from app.services.detections_service import query_metadata

    meta = query_metadata(q)
    hist = c.history.status()
    return {
        "manifest_version": "1.0",
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "query": {"region": region, "window": window, "products": [p["product_id"] for p in meta["products"]],
                  "daynight": daynight},
        "region": meta["region"],
        "window": meta["window"],
        "observations": meta["products"],
        "historical_sources": [
            {k: f.get(k) for k in ("product_id", "year", "url", "http_last_modified", "sha256", "rows_read",
                                   "rows_by_region", "version_values", "imported_at")}
            for f in hist["source_files"]
        ],
        "boundary": {"source_url": meta["region"]["boundary_source"], "fetched_at": meta["region"]["boundary_fetched_at"]},
        "limitations": LIMITATIONS,
        "export": {"csv": f"/api/v1/detections/export.csv?region={region}&window={window}&daynight={daynight}"
                          + (f"&products={products}" if products else ""),
                   "pdf": {"available": False, "note": "Geração de PDF planejada; usar o manifesto JSON e o CSV."}},
    }
