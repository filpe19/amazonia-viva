"""Inteligência histórica sobre os agregados importados do arquivo FIRMS."""

from __future__ import annotations

import logging
import threading
from datetime import UTC, date, datetime
from pathlib import Path

import pandas as pd

from app.core.errors import DataUnavailableError, ValidationAppError
from app.domain.regions import RegionRegistry
from app.domain.sources import PRODUCTS, get_product
from app.persistence.detection_archive import read_archive_bbox
from app.persistence.history_store import PARQUET_BUILD_METHOD, HistoryStore
from app.science.aggregation import (
    LOCAL_GRID_SIZE_DEG,
    MIN_YEARS_FOR_PERCENTILES,
    aggregate_records,
    baseline_stats,
    empirical_percentile,
    monthly_from_daily,
    window_totals_by_year,
)
from app.science.harmonization import (
    detect_anomalies,
    leave_one_year_out,
    normalized_series,
    overlap_comparison,
    spatial_agreement,
)

HISTORY_PRODUCTS = [p for p in PRODUCTS.values() if p.archive_country_dir]
SATELLITE_FILTERS = {"Terra", "Aqua", "Suomi NPP", "NOAA-20"}


def _parse_sats(spec: str | None) -> list[str] | None:
    if not spec:
        return None
    sats = [s.strip() for s in spec.split(",") if s.strip()]
    bad = [s for s in sats if s not in SATELLITE_FILTERS]
    if bad:
        raise ValidationAppError("Satélite inválido", detail={"invalidos": bad, "validos": sorted(SATELLITE_FILTERS)})
    return sats


def _parse_types(vegetation_only: bool) -> list[int] | None:
    return [0] if vegetation_only else None


log = logging.getLogger("app.history")
ARCHIVE_PARENT = "para"  # o recorte local (Parquet) cobre o Pará


class HistoryService:
    def __init__(self, store: HistoryStore, regions: RegionRegistry, runtime_dir: Path | None = None) -> None:
        self._store = store
        self._regions = regions
        self._runtime = runtime_dir
        self._build_lock = threading.Lock()

    def ensure_region(self, region_id: str, product_id: str) -> None:
        """Calcula, a partir do Parquet local, os agregados de um território dentro do Pará.

        Idempotente: só processa arquivos (source_files) ainda não recortados para o território.
        """
        region = self._regions.get(region_id)
        if region_id in ("brasil", ARCHIVE_PARENT) or region.definition.parent != ARCHIVE_PARENT or self._runtime is None:
            return
        with self._build_lock:
            built = self._store.built_source_ids(region_id, ("import", PARQUET_BUILD_METHOD))
            for f in self._store.source_files():
                if f["product_id"] != product_id or f["id"] in built or not f.get("parquet_path"):
                    continue
                path = self._runtime / f["parquet_path"]
                if not path.exists():
                    log.warning("parquet ausente", extra={"path": str(path), "source_file_id": f["id"]})
                    continue
                df = read_archive_bbox(path, region.bbox)
                if not df.empty:
                    df = df[region.contains(df["lon"].to_numpy(), df["lat"].to_numpy())]
                daily, grid = aggregate_records(df, region_id, with_grid=True, grid_size=LOCAL_GRID_SIZE_DEG)
                self._store.replace_region_aggregates(
                    region_id, f["id"], product_id, daily, grid, int(len(df)),
                    datetime.now(UTC).isoformat(timespec="seconds"),
                )
                log.info("region built", extra={"region": region_id, "product": product_id, "year": f["year"], "rows": int(len(df))})

    def _require_product(self, product_id: str, region_id: str | None = None):
        product = get_product(product_id)
        if not product.archive_country_dir:
            raise ValidationAppError(f"{product_id} não é um produto histórico")
        if region_id is not None:
            self.ensure_region(region_id, product_id)
        years = self._store.years_available(product_id, region_id)
        if not years:
            imported = self._store.years_available(product_id)
            if imported and region_id is not None:
                raise DataUnavailableError(
                    f"Histórico de {product_id} ainda não disponível para este território",
                    detail={"anos_importados": imported,
                            "motivo": "O recorte local (Parquet) cobre apenas territórios dentro do Pará e arquivos importados pelo importador 2.x."},
                )
            raise DataUnavailableError(
                f"Histórico de {product_id} ainda não importado",
                detail={"como_importar": f"python -m scripts.import_history --product {product_id} --years 2016-2025"},
            )
        return product, years

    # ------------------------------------------------------------------ status
    def status(self) -> dict:
        files = self._store.source_files()
        by_product: dict[str, dict] = {}
        for f in files:
            e = by_product.setdefault(f["product_id"], {"years": [], "files": 0, "bytes": 0, "satellites": set()})
            e["years"].append(f["year"])
            e["files"] += 1
            e["bytes"] += f.get("bytes") or 0
            e["satellites"].update(f.get("satellites") or [])
        products = []
        for p in HISTORY_PRODUCTS:
            e = by_product.get(p.id)
            products.append({
                "product_id": p.id, "sensor": p.sensor, "platform": p.platform, "resolution_m": p.resolution_m,
                "status_note": p.status_note, "imported": bool(e),
                "years": sorted(e["years"]) if e else [], "files": e["files"] if e else 0,
                "satellites": sorted(e["satellites"]) if e else [],
                "bytes_processed": e["bytes"] if e else 0,
            })
        return {
            "empty": not files,
            "products": products,
            "source_files": files,
            "regions": [r.summary() for r in self._regions.all()],
            "storage": "Agregados por dia × território × satélite × turno × tipo × classe de confiança, e grade mensal "
                       "(0,5° no Pará; 0,1° nos municípios). O arquivo bruto anual é descartado; as detecções dentro do Pará "
                       "ficam em Parquet local para recortar novos territórios. A proveniência (URL, SHA-256) é mantida.",
        }

    # ----------------------------------------------------------------- mensal
    def monthly(self, region_id: str, product_id: str, satellites: str | None = None,
                start_year: int | None = None, end_year: int | None = None,
                daynight: str | None = None, vegetation_only: bool = False) -> dict:
        self._regions.get(region_id)
        product, years = self._require_product(product_id, region_id)
        sats = _parse_sats(satellites)
        sy, ey = start_year or years[0], end_year or years[-1]
        daily = self._store.daily(region_id, product_id, satellites=sats, start=f"{sy}-01-01", end=f"{ey}-12-31",
                                  daynight=daynight, types=_parse_types(vegetation_only))
        monthly = monthly_from_daily(daily)
        imported_years = [y for y in years if sy <= y <= ey]
        # Completa meses sem detecções com zero (somente em anos importados)
        full = pd.DataFrame([{"year": y, "month": m} for y in imported_years for m in range(1, 13)])
        full["year_month"] = full.apply(lambda r: f"{int(r.year)}-{int(r.month):02d}", axis=1) if not full.empty else []
        monthly = full.merge(monthly[["year_month", "n"]], on="year_month", how="left").fillna({"n": 0}) if not full.empty else monthly
        # Linha de base por mês do calendário (mesmo produto, mesmos filtros)
        baseline = []
        for m in range(1, 13):
            vals = {int(r.year): float(r.n) for r in monthly[monthly["month"] == m].itertuples()}
            st = baseline_stats(vals)
            baseline.append({"month": m, **st.to_dict()})
        series = [
            {"year_month": r.year_month, "year": int(r.year), "month": int(r.month), "n": int(r.n)}
            for r in monthly.itertuples()
        ]
        for s in series:
            b = baseline[s["month"] - 1]
            hist = [float(x.n) for x in monthly[(monthly["month"] == s["month"]) & (monthly["year"] != s["year"])].itertuples()]
            s["percentile_vs_other_years"] = empirical_percentile(float(s["n"]), hist)
            s["baseline_median"] = b["median"]
        return {
            "region_id": region_id, "product_id": product_id, "sensor": product.sensor,
            "satellites": sats or "todos", "daynight": daynight or "todos",
            "vegetation_only": vegetation_only, "years": imported_years,
            "series": series, "baseline_by_month": baseline,
            "anomalies": detect_anomalies(monthly),
            "anomaly_rule": "Mês acima do percentil 90 (ou abaixo do 10) dos mesmos meses nos demais anos do mesmo produto E com "
                            "|z robusto| ≥ 1,5 (z = (n − mediana) / (1,4826 × MAD)) e diferença de ao menos 10 detecções; exige ≥ 5 anos de comparação.",
            "min_years_for_percentiles": MIN_YEARS_FOR_PERCENTILES,
            "note": "Série de um único produto. Não combine com séries de outros sensores.",
        }

    # -------------------------------------------------------------- calendário
    def calendar(self, region_id: str, product_id: str, year: int, satellites: str | None = None) -> dict:
        self._regions.get(region_id)
        product, years = self._require_product(product_id, region_id)
        if year not in years:
            raise DataUnavailableError(f"Ano {year} de {product_id} não importado", detail={"anos": years})
        daily = self._store.daily(region_id, product_id, satellites=_parse_sats(satellites),
                                  start=f"{year}-01-01", end=f"{year}-12-31")
        counts = {r.acq_date: int(r.n) for r in daily.itertuples()}
        days = pd.date_range(f"{year}-01-01", f"{year}-12-31", freq="D")
        return {
            "region_id": region_id, "product_id": product_id, "year": year,
            "days": [{"date": d.date().isoformat(), "n": counts.get(d.date().isoformat(), 0)} for d in days],
            "max": max(counts.values()) if counts else 0,
            "total": int(sum(counts.values())),
        }

    # ---------------------------------------------------- comparação de períodos
    def compare_periods(self, region_id: str, product_id: str, a_start: date, a_end: date,
                        b_start: date, b_end: date, satellites: str | None = None) -> dict:
        self._regions.get(region_id)
        self._require_product(product_id, region_id)
        sats = _parse_sats(satellites)

        def total(s: date, e: date) -> dict:
            d = self._store.daily(region_id, product_id, satellites=sats, start=s.isoformat(), end=e.isoformat())
            return {"start": s.isoformat(), "end": e.isoformat(), "days": (e - s).days + 1,
                    "n": int(d["n"].sum()) if not d.empty else 0}

        a, b = total(a_start, a_end), total(b_start, b_end)
        return {
            "region_id": region_id, "product_id": product_id, "a": a, "b": b,
            "difference": b["n"] - a["n"],
            "ratio_b_over_a": round(b["n"] / a["n"], 3) if a["n"] else None,
            "note": "Mesma série de produto nos dois períodos; diferenças de duração entre períodos não são normalizadas.",
        }

    # ------------------------------------------------- mesma janela do calendário
    def same_window(self, region_id: str, product_id: str, start: date, end: date,
                    satellites: list[str] | None = None, exclude_year: int | None = None) -> dict:
        _, years = self._require_product(product_id, region_id)
        base_years = [y for y in years if y != exclude_year and (y < start.year or exclude_year is None)]
        daily = self._store.daily(region_id, product_id, satellites=satellites)
        totals = window_totals_by_year(daily, (start.month, start.day), (end.month, end.day), base_years)
        st = baseline_stats(totals)
        return {"product_id": product_id, "window_month_day": [f"{start:%m-%d}", f"{end:%m-%d}"],
                "totals_by_year": totals, "stats": st.to_dict()}

    # ------------------------------------------------------ sobreposição MODIS × VIIRS
    def overlap(self, region_id: str, ref_product: str = "MODIS_SP", other_product: str = "VIIRS_SNPP_SP",
                ref_satellites: str | None = "Aqua") -> dict:
        self._regions.get(region_id)
        if other_product not in ("VIIRS_SNPP_SP", "VIIRS_NOAA20_SP"):
            raise ValidationAppError("Produto VIIRS de comparação deve ser VIIRS_SNPP_SP ou VIIRS_NOAA20_SP")
        _, ref_years = self._require_product(ref_product, region_id)
        _, other_years = self._require_product(other_product, region_id)
        common_years = sorted(set(ref_years) & set(other_years))
        if not common_years:
            raise DataUnavailableError("Sem anos de sobreposição importados para os dois produtos",
                                       detail={ref_product: ref_years, other_product: other_years})
        sats = _parse_sats(ref_satellites)
        s, e = f"{common_years[0]}-01-01", f"{common_years[-1]}-12-31"
        ref = monthly_from_daily(self._store.daily(region_id, ref_product, satellites=sats, start=s, end=e))
        oth = monthly_from_daily(self._store.daily(region_id, other_product, start=s, end=e))
        ref = ref[ref["year"].isin(common_years)]
        oth = oth[oth["year"].isin(common_years)]
        # Meses sem detecção em anos importados contam como zero (não como ausência de dado).
        months = [f"{y}-{m:02d}" for y in common_years for m in range(1, 13)]
        fill = lambda df: pd.DataFrame({"year_month": months}).merge(df[["year_month", "n"]], on="year_month", how="left").fillna({"n": 0})  # noqa: E731
        comp = overlap_comparison(fill(ref), fill(oth))
        other_label = get_product(other_product).platform
        out = {
            "region_id": region_id,
            "reference": {"product_id": ref_product, "satellites": sats or "todos"},
            "other": {"product_id": other_product, "platform": other_label},
            "overlap_years": common_years,
            "comparison": comp,
            "interpretation_limits": [
                "Razões e correlações são descritivas; não constituem um fator de harmonização validado.",
                "MODIS (1 km) e VIIRS (375 m) diferem em sensibilidade a focos pequenos; a razão varia por região, estação e tamanho do fogo.",
                f"Aqua (MODIS) e {other_label} (VIIRS) passam perto de 13h30/01h30, mas não no mesmo instante; Terra tem outro horário.",
                "A auditoria de cobertura usa apenas meses presentes nos arquivos; a disponibilidade de grânulos e a nebulosidade ainda não são consideradas.",
            ],
        }
        if region_id != "brasil":
            g_ref = self._store.grid_monthly(region_id, ref_product, sats)
            g_oth = self._store.grid_monthly(region_id, other_product)
            g_ref = g_ref[g_ref["year_month"].str.slice(0, 4).astype(int).isin(common_years)]
            g_oth = g_oth[g_oth["year_month"].str.slice(0, 4).astype(int).isin(common_years)]
            grid_deg = 0.5 if region_id == ARCHIVE_PARENT else LOCAL_GRID_SIZE_DEG
            out["spatial"] = spatial_agreement(g_ref, g_oth, grid_deg)
        return out


PRODUCT_PROCESSING = {
    "MODIS_SP": {
        "instrument": "MODIS (Terra e Aqua)", "resolution": "1 km", "algorithm": "MOD14/MYD14, Coleção 6 / 6.1",
        "overpass_local": "Terra ~10h30 e ~22h30; Aqua ~13h30 e ~01h30 (horários nominais; ambos com deriva orbital nos últimos anos)",
        "processing": "Arquivo anual por país da NASA FIRMS (processamento padrão; versão registrada por arquivo)",
    },
    "VIIRS_SNPP_SP": {
        "instrument": "VIIRS (Suomi NPP)", "resolution": "375 m", "algorithm": "VNP14IMG, Coleção 2",
        "overpass_local": "~13h30 e ~01h30", "processing": "Arquivo anual por país da NASA FIRMS; produção encerrada em 02/11/2026",
    },
    "VIIRS_NOAA20_SP": {
        "instrument": "VIIRS (NOAA-20)", "resolution": "375 m", "algorithm": "VJ114IMG, Coleção 2",
        "overpass_local": "~13h30 e ~01h30 (cerca de 50 min de diferença do S-NPP)",
        "processing": "Arquivo anual por país da NASA FIRMS (mesmo satélite do quase tempo real VIIRS_NOAA20_NRT)",
    },
}

UNCERTAINTIES = [
    "Contagens dependem de nebulosidade, ângulo de visada e horário de passagem; meses sem detecção podem ser meses sem observação útil.",
    "MODIS e VIIRS diferem em resolução (1 km × 375 m) e sensibilidade: o VIIRS detecta focos menores e mais numerosos.",
    "As órbitas de Terra e Aqua derivaram para horários mais cedo nos últimos anos, reduzindo detecções da tarde (pico do fogo).",
    "O arquivo MODIS mistura coleções entre anos (6.2, 6.03, 61.03), o que pode criar descontinuidades.",
    "A disponibilidade de grânulos (passagens efetivamente processadas) não foi auditada; só os meses presentes nos arquivos.",
    "Agregados de municípios vêm do recorte local em Parquet; contagens pequenas tornam percentis e razões instáveis.",
]


def _coverage_for(store, region_id: str, product_id: str, files: list[dict]) -> dict:
    daily = store.daily(region_id, product_id)
    years = sorted({f["year"] for f in files})
    per_year = []
    d = daily.copy()
    if not d.empty:
        d["year"] = d["acq_date"].str.slice(0, 4).astype(int)
        d["month"] = d["acq_date"].str.slice(5, 7)
    for f in sorted(files, key=lambda x: x["year"]):
        y = f["year"]
        sub = d[d["year"] == y] if not d.empty else d
        per_year.append({
            "year": y,
            "detections_in_territory": int(sub["n"].sum()) if not sub.empty else 0,
            "days_with_detection": int(sub["acq_date"].nunique()) if not sub.empty else 0,
            "months_with_detection": int(sub["month"].nunique()) if not sub.empty else 0,
            "versions": f.get("version_values") or [],
            "satellites": f.get("satellites") or [],
            "file_first_date": f.get("min_acq_date"),
            "file_last_date": f.get("max_acq_date"),
            "sha256": f.get("sha256"),
        })
    return {"product_id": product_id, "years": years, "per_year": per_year, **PRODUCT_PROCESSING.get(product_id, {})}


def coverage_report(self, region_id: str) -> dict:
    """Auditoria de cobertura e processamento por produto, para o território."""
    self._regions.get(region_id)
    products = []
    for pid in PRODUCT_PROCESSING:
        try:
            self._require_product(pid, region_id)
        except DataUnavailableError as exc:
            products.append({"product_id": pid, "available": False, "reason": exc.message, **PRODUCT_PROCESSING[pid]})
            continue
        built = self._store.built_source_ids(region_id, ("import", PARQUET_BUILD_METHOD))
        files = [f for f in self._store.source_files() if f["product_id"] == pid and f["id"] in built]
        products.append({"available": True, **_coverage_for(self._store, region_id, pid, files)})
    years = {p["product_id"]: set(p.get("years", [])) for p in products if p.get("available")}
    overlap = {}
    if "MODIS_SP" in years:
        for other in ("VIIRS_NOAA20_SP", "VIIRS_SNPP_SP"):
            if other in years:
                overlap[other] = sorted(years["MODIS_SP"] & years[other])
    return {"region_id": region_id, "products": products, "overlap_years_with_modis": overlap, "uncertainties": UNCERTAINTIES}


def harmonization_experiment(self, region_id: str, other_product: str = "VIIRS_NOAA20_SP", ref_satellites: str | None = "Aqua") -> dict:
    """Agregação temporal comum (mês) com séries normalizadas + validação deixa-um-ano-de-fora."""
    ov = self.overlap(region_id, "MODIS_SP", other_product, ref_satellites)
    series = ov["comparison"]["series"]
    ref = pd.DataFrame([{"year_month": r["year_month"], "n": r["ref"]} for r in series])
    oth = pd.DataFrame([{"year_month": r["year_month"], "n": r["other"]} for r in series])
    return {
        "region_id": region_id,
        "reference": ov["reference"], "other": ov["other"], "overlap_years": ov["overlap_years"],
        "experimental": True, "validated_fusion": False,
        "common_aggregation": "Mês civil (UTC) no mesmo território; grade espacial comum disponível em /history/overlap.",
        "normalized": normalized_series(ref, oth),
        "loyo": leave_one_year_out(ref, oth),
        "statement": "Nenhuma série harmonizada definitiva é produzida. O índice normalizado serve só para comparar a forma "
                     "das séries; a validação mostra o erro que uma conversão por razão teria em anos não usados no ajuste.",
    }


HistoryService.coverage_report = coverage_report
HistoryService.harmonization_experiment = harmonization_experiment


# ----------------------------------------------------------------------------
# Série harmonizada experimental e exportações (Missão 04)
# ----------------------------------------------------------------------------
from app.science.harmonization import _paired, harmonize_monthly, seasonal_ratios  # noqa: E402

AQUA_FIRST_MONTH = "2002-07"  # MODIS/Aqua começou a produzir detecções em julho de 2002
HARMONIZED_UNITS = "detecções equivalentes ao VIIRS NOAA-20 (375 m) por mês"


def _harmonization_inputs(self, region_id: str):
    self._regions.get(region_id)
    _, modis_years = self._require_product("MODIS_SP", region_id)
    _, viirs_years = self._require_product("VIIRS_NOAA20_SP", region_id)
    built = self._store.built_source_ids(region_id, ("import", PARQUET_BUILD_METHOD))
    aqua_years = sorted({f["year"] for f in self._store.source_files()
                         if f["product_id"] == "MODIS_SP" and f["id"] in built and "Aqua" in (f.get("satellites") or [])})
    modis_d = self._store.daily(region_id, "MODIS_SP", satellites=["Aqua"])
    viirs_d = self._store.daily(region_id, "VIIRS_NOAA20_SP")
    overlap = sorted(set(aqua_years) & set(viirs_years))
    m_mon, v_mon = monthly_from_daily(modis_d), monthly_from_daily(viirs_d)
    months = [f"{y}-{m:02d}" for y in overlap for m in range(1, 13)]
    full = lambda df: pd.DataFrame({"year_month": months}).merge(df[["year_month", "n"]], on="year_month", how="left").fillna({"n": 0})  # noqa: E731
    paired = _paired(full(m_mon), full(v_mon)) if overlap else pd.DataFrame(columns=["year_month", "year", "month", "ref", "other"])
    ratios = seasonal_ratios(paired) if not paired.empty else {"available": False, "reason": "Sem anos de sobreposição Aqua × NOAA-20."}
    ratio_source = region_id
    if (not ratios.get("available") or ratios["global"]["n_months"] < 12) and region_id != ARCHIVE_PARENT:
        # Território com pouca atividade na sobreposição: usa razões do Pará (declarado na resposta).
        parent = _harmonization_inputs(self, ARCHIVE_PARENT)
        ratios, ratio_source = parent["ratios"], f"{ARCHIVE_PARENT} (território com poucos meses ativos na sobreposição)"
    return {"modis_daily": modis_d, "viirs_daily": viirs_d, "modis_monthly": m_mon, "viirs_monthly": v_mon,
            "aqua_years": aqua_years, "viirs_years": viirs_years, "modis_years": modis_years, "overlap": overlap,
            "paired": paired, "ratios": ratios, "ratio_source": ratio_source}


def harmonized(self, region_id: str) -> dict:
    """Calendário mensal harmonizado (experimental) + linha de base + anomalias + validação."""
    inp = _harmonization_inputs(self, region_id)
    if not inp["ratios"].get("available"):
        raise DataUnavailableError("Não foi possível estimar razões de conversão para este território", detail={"motivo": inp["ratios"].get("reason")})
    rows = harmonize_monthly(inp["modis_monthly"], inp["viirs_monthly"], inp["ratios"], inp["viirs_years"], inp["aqua_years"])
    for r in rows:
        if r["origin"] == "convertido_modis" and r["year_month"] < AQUA_FIRST_MONTH:
            r.update(value=None, low=None, high=None, origin="sem_dado", modis_n=None)
    df = pd.DataFrame([r for r in rows if r["value"] is not None])
    baseline = []
    for m in range(1, 13):
        vals = {int(x.year): float(x.value) for x in df[df["month"] == m].itertuples()} if not df.empty else {}
        baseline.append({"month": m, **baseline_stats(vals).to_dict()})
    anomalies = detect_anomalies(df.rename(columns={"value": "n"})[["year_month", "year", "month", "n"]]) if not df.empty else []
    annual = (df.groupby("year").agg(value=("value", "sum"), low=("low", "sum"), high=("high", "sum"),
                                     converted=("origin", lambda s: int((s == "convertido_modis").sum()))).reset_index()
              if not df.empty else pd.DataFrame())
    loyo = leave_one_year_out(inp["paired"][["year_month", "ref"]].rename(columns={"ref": "n"}),
                              inp["paired"][["year_month", "other"]].rename(columns={"other": "n"})) if not inp["paired"].empty else {"available": False}
    return {
        "region_id": region_id,
        "experimental": True,
        "validated_fusion": False,
        "units": HARMONIZED_UNITS,
        "reference_sensor": "VIIRS NOAA-20 (observado 2021–2025)",
        "converted_sensor": "MODIS Aqua (convertido por razão sazonal)",
        "period": [rows[0]["year_month"], rows[-1]["year_month"]] if rows else None,
        "first_month_with_data": next((r["year_month"] for r in rows if r["value"] is not None), None),
        "overlap_years": inp["overlap"],
        "ratio_source": inp["ratio_source"],
        "ratios": inp["ratios"],
        "series": rows,
        "annual": [{"year": int(a.year), "value": float(a.value), "low": float(a.low), "high": float(a.high), "converted_months": int(a.converted)}
                   for a in annual.itertuples()] if not annual.empty else [],
        "baseline_by_month": baseline,
        "anomalies": anomalies,
        "validation": loyo,
        "method": ("Meses com arquivo VIIRS NOAA-20 usam a contagem observada. Meses anteriores usam a contagem do MODIS Aqua "
                   "(passagem ~13h30, como o NOAA-20) multiplicada pela razão VIIRS/MODIS mediana daquele mês do ano, estimada "
                   "nos anos de sobreposição no mesmo território; a faixa usa os percentis 10 e 90 dessas razões. Meses com menos "
                   "de 3 anos válidos usam a razão geral. Aqua só existe a partir de julho de 2002."),
        "limitations": [
            "Série experimental: não constitui um produto harmonizado validado operacionalmente.",
            "A conversão assume que a relação VIIRS/MODIS de 2021–2025 vale para 2002–2020 (estacionariedade não testada fora da sobreposição).",
            "A validação fora da amostra mostra erro típico moderado e cauda grande; meses convertidos isolados podem errar muito.",
            "Deriva orbital do Aqua e mudanças de coleção MODIS (6, 6.1) não são corrigidas.",
            "2026 não está no arquivo anual da NASA FIRMS; o ano atual entra só pela janela de 7 dias do quase tempo real.",
        ],
    }


def harmonized_same_window(self, region_id: str, start: date, end: date, exclude_year: int) -> dict:
    """Mesmo intervalo do calendário em cada ano, em unidades equivalentes NOAA-20 (observado ou convertido)."""
    inp = _harmonization_inputs(self, region_id)
    if not inp["ratios"].get("available"):
        raise DataUnavailableError("Razões de conversão indisponíveis", detail={"motivo": inp["ratios"].get("reason")})
    by_month = inp["ratios"]["by_month"]
    years = sorted((set(inp["viirs_years"]) | set(inp["aqua_years"])) - {exclude_year})
    (m1, d1), (m2, d2) = (start.month, start.day), (end.month, end.day)
    out, origins = {}, {}
    vd = inp["viirs_daily"].assign(acq_date=pd.to_datetime(inp["viirs_daily"]["acq_date"])) if not inp["viirs_daily"].empty else inp["viirs_daily"]
    md = inp["modis_daily"].assign(acq_date=pd.to_datetime(inp["modis_daily"]["acq_date"])) if not inp["modis_daily"].empty else inp["modis_daily"]
    for y in years:
        s = pd.Timestamp(year=y, month=m1, day=d1)
        e = pd.Timestamp(year=y + (1 if (m2, d2) < (m1, d1) else 0), month=m2, day=d2)
        if f"{s:%Y-%m}" < AQUA_FIRST_MONTH and y not in inp["viirs_years"]:
            continue
        if y in inp["viirs_years"]:
            sel = vd[(vd["acq_date"] >= s) & (vd["acq_date"] <= e)] if not vd.empty else vd
            out[y], origins[y] = float(sel["n"].sum()) if not sel.empty else 0.0, "observado_viirs"
        else:
            sel = md[(md["acq_date"] >= s) & (md["acq_date"] <= e)] if not md.empty else md
            val = float(sum(r.n * by_month[r.acq_date.month]["ratio"] for r in sel.itertuples())) if not sel.empty else 0.0
            out[y], origins[y] = val, "convertido_modis"
    st = baseline_stats(out)
    return {"totals_by_year": {str(k): round(v, 1) for k, v in out.items()}, "origins": origins, "stats": st.to_dict(),
            "ratio_source": inp["ratio_source"], "units": "detecções equivalentes ao VIIRS NOAA-20"}


def export_records(self, region_id: str, product_id: str, start: date, end: date):
    """Gera linhas CSV com os registros (focos) do arquivo local no território e período pedidos."""
    import csv
    import io

    region = self._regions.get(region_id)
    if region.id != ARCHIVE_PARENT and region.definition.parent != ARCHIVE_PARENT:
        raise ValidationAppError("Exportação de registros históricos disponível para o Pará e seus municípios (recorte local).")
    self._require_product(product_id, region_id)
    files = [f for f in self._store.source_files() if f["product_id"] == product_id and f.get("parquet_path")
             and start.year <= f["year"] <= end.year]
    cols = ["product_id", "satellite", "acq_date", "acq_time", "latitude", "longitude", "confidence", "frp_mw", "daynight",
            "type", "version", "region_id", "source_url", "source_sha256"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    yield buf.getvalue()
    for f in sorted(files, key=lambda x: x["year"]):
        df = read_archive_bbox(self._runtime / f["parquet_path"], region.bbox)
        df = df[(df["acq_date"] >= start.isoformat()) & (df["acq_date"] <= end.isoformat())]
        if not df.empty:
            df = df[region.contains(df["lon"].to_numpy(), df["lat"].to_numpy())]
        buf = io.StringIO()
        w = csv.writer(buf)
        for r in df.itertuples():
            w.writerow([product_id, r.satellite, r.acq_date, r.acq_time, r.lat, r.lon, r.confidence,
                        None if pd.isna(r.frp) else round(float(r.frp), 2), r.daynight, r.type, r.version, region_id, f["url"], f["sha256"]])
        yield buf.getvalue()


HistoryService.harmonized = harmonized
HistoryService.harmonized_same_window = harmonized_same_window
HistoryService.export_records = export_records


def grid_layer(self, region_id: str, product_id: str = "VIIRS_NOAA20_SP", start_year: int | None = None,
               end_year: int | None = None) -> dict:
    """Camada de recorrência: detecções e anos com atividade por célula de grade (mesmo produto)."""
    region = self._regions.get(region_id)
    _, years = self._require_product(product_id, region_id)
    sy, ey = start_year or years[0], end_year or years[-1]
    g = self._store.grid_monthly(region_id, product_id)
    if g.empty:
        raise DataUnavailableError("Grade espacial indisponível para este território", detail={"produto": product_id})
    g = g.assign(year=g["year_month"].str.slice(0, 4).astype(int))
    g = g[(g["year"] >= sy) & (g["year"] <= ey)]
    size = 0.5 if region_id in ("brasil", ARCHIVE_PARENT) else LOCAL_GRID_SIZE_DEG
    agg = g.groupby("cell_id").agg(total=("n", "sum"), years_active=("year", "nunique"),
                                   months_active=("year_month", "nunique")).reset_index()
    n_years = len([y for y in years if sy <= y <= ey])
    feats = []
    for r in agg.itertuples():
        lat0, lon0 = (float(x) for x in r.cell_id.split("_"))
        ring = [[lon0, lat0], [lon0 + size, lat0], [lon0 + size, lat0 + size], [lon0, lat0 + size], [lon0, lat0]]
        feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]},
                      "properties": {"cell": r.cell_id, "total": int(r.total), "years_active": int(r.years_active),
                                     "months_active": int(r.months_active),
                                     "mean_per_year": round(float(r.total) / n_years, 1) if n_years else None}})
    return {"type": "FeatureCollection", "features": feats, "metadata": {
        "region": region.summary(), "product_id": product_id, "years": [sy, ey], "n_years": n_years, "grid_deg": size,
        "max_total": int(agg["total"].max()) if not agg.empty else 0,
        "source": "NASA FIRMS — arquivo anual por país (processamento padrão), recortado pelo limite IBGE",
        "meaning": "Detecções acumuladas e número de anos com ao menos uma detecção em cada célula. Não é área queimada.",
    }}


HistoryService.grid_layer = grid_layer
