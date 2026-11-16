"""Focos com impacto potencial: agrupamentos de detecções, proporção, vento, alvos no caminho, confiabilidade e grau.

Regras (Missão 09):
* Um "foco" é um agrupamento de detecções (4 satélites) cujos centros de pixel estão a ≤ 1,5 km uns dos outros na
  janela. Não é perímetro de incêndio nem área queimada.
* Proporção = número de pixels, passagens, área coberta pelos pixels (scan × track), FRP e duração observada.
* Vento = modelo numérico (Open-Meteo), atual e próximas 6 h. "A favor do vento" = alvo a ≤ 20 km dentro de ± 30° da
  direção para onde o vento sopra. É triagem geométrica, NÃO previsão de propagação nem probabilidade de chegada.
* Grau de alerta e confiabilidade = escadas de regras públicas (sem pontuação, sem pesos), não calibradas em campo.
* Proximidade não indica dano; pessoas perto não são vítimas.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time as _time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.dataset as ds
import shapely
from shapely.geometry import mapping, shape
from shapely.ops import nearest_points

from app.core.errors import AppError, ValidationAppError
from app.core.heavy import run_heavy
from app.domain.regions import Region, RegionRegistry
from app.integrations.censipam import LAYERS, CensipamClient
from app.integrations.ibge import BC250_LAYERS, ibge_municipal_seats, ibge_wfs_bbox
from app.integrations.openmeteo import SOURCE as WIND_SOURCE
from app.integrations.openmeteo import cell_of, wind_cells
from app.services.detections_service import DetectionsService
from app.services.impact_service import _Projector
from app.services.indigenous_service import BRIGADES, ROADS

log = logging.getLogger("app.hotspots")

ALL_PRODUCTS = "VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT,MODIS_NRT"
LINK_KM = 1.5
NEAR_KM = 10.0
CITY_KM = 30.0
DOWNWIND_KM = 20.0
DOWNWIND_HALF_ANGLE = 30.0
CLOSE_KM = 5.0
WIND_MAX_CELLS = 120
MAX_ITEMS = 400
CACHE_SECONDS = 1800
ARCHIVE = {"MODIS_SP": "MODIS_SP", "VIIRS_NOAA20_SP": "VIIRS_NOAA20_SP"}
SECTORS_PT = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"]
POLY_LAYERS = {"terras_indigenas": "indigenous", "ucs_federais": "conservation", "ucs_estaduais": "conservation", "quilombolas": "quilombola"}

RULES = {
    "levels": {
        "alto": "Foco confirmado (≥ 2 passagens) com detecção nas últimas 24 h E (dentro de terra indígena, unidade de conservação "
                "ou território quilombola; OU cidade, localidade ou terra indígena a ≤ 5 km; OU alvo a favor do vento a ≤ 10 km).",
        "moderado": "Foco confirmado com algum alvo a ≤ 10 km; OU qualquer foco dentro de área protegida/indígena/quilombola; "
                    "OU cidade a ≤ 5 km.",
        "baixo": "Demais focos com algum alvo a ≤ 10 km (cidade, localidade, rodovia federal, área oficial).",
        "sem_alvo": "Nenhum alvo mapeado a ≤ 10 km (não listado individualmente).",
    },
    "veracity": {
        "alta": "Visto por ≥ 2 satélites em ≥ 3 passagens, ou por ≥ 2 satélites e coincidente com evento ativo do Censipam.",
        "media": "Visto em ≥ 2 passagens (mesmo satélite ou não).",
        "baixa": "Uma única passagem, ou todos os pixels com confiança baixa: pode ser fogo curto, nuvem nas outras passagens ou falso positivo.",
    },
    "downwind": f"Alvo a ≤ {DOWNWIND_KM:g} km dentro de ± {DOWNWIND_HALF_ANGLE:g}° da direção para onde o vento sopra (modelo).",
}
DISCLAIMER = ("Focos e graus calculados pela plataforma com regras públicas para triagem. Não são alertas oficiais, não medem dano "
              "e não preveem propagação: 'a favor do vento' é uma indicação geométrica com vento de modelo. Confirme em campo e com "
              "os órgãos responsáveis.")


def sector(deg: float) -> str:
    return SECTORS_PT[int(((deg % 360) + 22.5) // 45) % 8]


def angdiff(a: float, b: float) -> float:
    d = abs((a - b) % 360.0)
    return min(d, 360.0 - d)


def bearing_xy(dx: float, dy: float) -> float:
    return (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0


def cluster_labels(xy: np.ndarray, link_m: float) -> np.ndarray:
    """Componentes conexos de pontos com distância ≤ link_m (união-busca sobre pares do STRtree)."""
    n = len(xy)
    parent = np.arange(n)
    if n == 0:
        return parent
    pts = shapely.points(xy)
    tree = shapely.STRtree(pts)
    a, b = tree.query(pts, predicate="dwithin", distance=link_m)

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, j in zip(a.tolist(), b.tolist(), strict=True):
        if i < j:
            ri, rj = find(i), find(j)
            if ri != rj:
                parent[max(ri, rj)] = min(ri, rj)
    return np.array([find(i) for i in range(n)])


def archive_frame(runtime_dir: Path, region: Region, start: date, end: date) -> pd.DataFrame:
    """Detecções do arquivo FIRMS (processamento padrão; recorte do Pará) no intervalo, no formato do quase tempo real."""
    w, s, e, n = region.bbox
    frames = []
    for pid in ARCHIVE:
        path = runtime_dir / "detections" / pid
        files = [path / f"{y}.parquet" for y in range(start.year, end.year + 1) if (path / f"{y}.parquet").exists()]
        if not files:
            continue
        flt = ((ds.field("lat") >= s) & (ds.field("lat") <= n) & (ds.field("lon") >= w) & (ds.field("lon") <= e)
               & (ds.field("acq_date") >= start.isoformat()) & (ds.field("acq_date") <= end.isoformat()))
        t = ds.dataset([str(f) for f in files], format="parquet").to_table(
            columns=["acq_date", "acq_time", "satellite", "daynight", "type", "confidence", "frp", "lat", "lon"], filter=flt).to_pandas()
        if t.empty:
            continue
        t = t[region.contains(t["lon"].to_numpy(), t["lat"].to_numpy())]
        hhmm = t["acq_time"].astype(str).str.zfill(4)
        t = pd.DataFrame({
            "latitude": t["lat"].astype(float), "longitude": t["lon"].astype(float),
            "acq_datetime_utc": pd.to_datetime(t["acq_date"] + " " + hhmm.str[:2] + ":" + hhmm.str[2:], utc=True),
            "acq_date": t["acq_date"], "satellite_name": t["satellite"], "product_id": pid, "frp_mw": pd.to_numeric(t["frp"], errors="coerce"),
            "confidence_raw": t["confidence"].astype(str), "daynight": t["daynight"], "type": t["type"],
        })
        t["detection_id"] = (t["product_id"] + "|" + t["latitude"].round(4).astype(str) + "|" + t["longitude"].round(4).astype(str)
                             + "|" + t["acq_datetime_utc"].dt.strftime("%Y%m%d%H%M"))
        frames.append(t)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


class HotspotService:
    def __init__(self, detections: DetectionsService, regions: RegionRegistry, http, cache, censipam: CensipamClient, indigenous,
                 runtime_dir: Path) -> None:
        self._det = detections
        self._regions = regions
        self._http = http
        self._cache = cache
        self._censipam = censipam
        self._ind = indigenous
        self._runtime = runtime_dir
        self._memo: dict[tuple, tuple[float, dict]] = {}
        self._inflight: dict[tuple, asyncio.Future] = {}

    async def hotspots(self, region_id: str, window: str = "24h", start: date | None = None, end: date | None = None) -> dict:
        region = self._regions.get(region_id)
        if (start is None) != (end is None):
            raise ValidationAppError("Informe start e end juntos (modo histórico)")
        if start and end and (end < start or (end - start).days > 31):
            raise ValidationAppError("Período histórico inválido (máximo de 31 dias)")
        key = (region_id, window if not start else f"{start}:{end}", int(_time.time() // CACHE_SECONDS))
        if key in self._memo:
            return self._memo[key][1]
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.ensure_future(self._compute(region, window, start, end))
            self._inflight[key] = task
        try:
            out = await asyncio.shield(task)
        finally:
            if task.done():
                self._inflight.pop(key, None)
        self._memo = {k: v for k, v in self._memo.items() if k[2] == key[2]}
        self._memo[key] = (_time.monotonic(), out)
        return out

    async def _compute(self, region: Region, window: str, start: date | None, end: date | None) -> dict:
        now = datetime.now(UTC)
        level = region.definition.level
        historical = start is not None
        in_para = region.id == "para" or region.definition.parent == "para"
        if historical and not in_para:
            return {"available": False, "region": region.summary(), "historical": True,
                    "reason": "O arquivo histórico de detecções foi importado para o Pará e seus municípios; selecione-os para estudar outros anos."}
        # Detecções
        if historical:
            frame = await run_heavy(archive_frame, self._runtime, region, start, end)
            det_meta = {"mode": "archive", "products": list(ARCHIVE), "start": start.isoformat(), "end": end.isoformat(),
                        "note": "Arquivo FIRMS de processamento padrão (MODIS 2001–2025; VIIRS NOAA-20 2021–2025)."}
        else:
            q = await self._det.query(region.id, window, ALL_PRODUCTS, now=now)
            frame = q.frame
            det_meta = {"mode": "nrt", "window": window, "products": ALL_PRODUCTS.split(",")}
        frame = frame.reset_index(drop=True)

        # Camadas de alvos (oficiais)
        w, s, e, n = region.bbox
        pad = 0.3
        bbox = (w - pad, s - pad, e + pad, n + pad)
        tasks: dict = {lid: self._censipam.layer_bbox(LAYERS[lid], bbox) for lid in POLY_LAYERS}
        tasks["roads"] = self._censipam.layer_bbox(ROADS, bbox)
        tasks["brigades"] = self._censipam.layer_bbox(BRIGADES, (w - 1.5, s - 1.5, e + 1.5, n + 1.5))
        tasks["seats"] = ibge_municipal_seats(self._http, self._cache, bbox)
        if level in ("estado", "municipio"):
            tasks["localities"] = ibge_wfs_bbox(self._http, self._cache, BC250_LAYERS["localidades"], bbox)
        if region.uf and not historical:
            tasks["events"] = self._censipam.events_by_state(region.uf)
        res = dict(zip(tasks, await asyncio.gather(*tasks.values(), return_exceptions=True), strict=True))
        for v in res.values():
            if isinstance(v, BaseException) and not isinstance(v, AppError | ValueError | KeyError):
                raise v
        foreign = self._ind._foreign_shapes() if level == "bioma" else []

        items, summary, sources = await run_heavy(self._assemble, region, frame, res, foreign, now, historical, start, end)

        # Vento (modelo) para as células dos focos mais relevantes; reavalia "a favor do vento" e o grau
        if not historical and items:
            order = sorted(items, key=lambda x: (x["_pre"], -x["proportion"]["pixels"]))
            cells = list(dict.fromkeys(cell_of(i["centroid"][1], i["centroid"][0]) for i in order))[:WIND_MAX_CELLS]
            try:
                winds = await wind_cells(self._http, self._cache, cells)
                sources["wind"] = {"available": True, "label": WIND_SOURCE, "cells": len(winds), "kind": "previsao"}
            except AppError as exc:
                winds = {}
                sources["wind"] = {"available": False, "label": WIND_SOURCE, "reason": exc.message}
            for it in items:
                wd = winds.get(cell_of(it["centroid"][1], it["centroid"][0]))
                it["wind"] = wd
                if wd:
                    for tg in it["_all_targets"]:
                        tg["downwind"] = bool(tg["km"] <= DOWNWIND_KM and angdiff(wd["toward_deg"], tg["bearing_deg"]) <= DOWNWIND_HALF_ANGLE)
        else:
            sources["wind"] = {"available": False, "label": WIND_SOURCE, "reason": "Modo histórico: vento atual não se aplica." if historical else "Sem focos."}

        for it in items:
            self._grade(it, now, historical)
        rank = {"alto": 0, "moderado": 1, "baixo": 2, "sem_alvo": 3}
        listed = sorted((i for i in items if i["level"] != "sem_alvo"), key=lambda x: (rank[x["level"]], -(pd.Timestamp(x["proportion"]["last_utc"]).value)))
        by_level = {k: sum(1 for i in items if i["level"] == k) for k in rank}
        by_ver = {k: sum(1 for i in items if i["veracity"] == k) for k in ("alta", "media", "baixa")}
        hi = [i for i in listed if i["level"] in ("alto", "moderado")]
        summary.update({
            "by_level": by_level, "by_veracity": by_ver,
            "cities_close_or_downwind": sorted({t["name"] for i in hi for t in i["targets"]["downwind"] + i["targets"]["near"] if t["type"] == "city" and (t["downwind"] or t["km"] <= CLOSE_KM)}),
            "federal_roads_near": sorted({t["name"] for i in hi for t in i["targets"]["near"] + i["targets"]["downwind"] if t["type"] == "road"}),
            "indigenous_lands_touched": sorted({t["name"] for i in hi for t in i["targets"]["inside"] + i["targets"]["near"] + i["targets"]["downwind"] if t["type"] == "indigenous"}),
            "listed": min(len(listed), MAX_ITEMS), "truncated": len(listed) > MAX_ITEMS,
        })
        for it in items:
            it.pop("_all_targets", None)
            it.pop("_pre", None)
        return {
            "available": True, "official": False, "experimental": True, "historical": historical,
            "region": region.summary(), "generated_at": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
            "detections": det_meta, "rules": RULES, "disclaimer": DISCLAIMER,
            "method": f"Agrupamento: centros de pixel a ≤ {LINK_KM:g} km (componentes conexos, 4 satélites). Distâncias em projeção azimutal "
                      f"equidistante centrada na região. Cidades = sedes municipais IBGE (≤ {CITY_KM:g} km); localidades IBGE BC250, rodovias "
                      f"federais DNIT, terras indígenas FUNAI, UCs ICMBio/CNUC e quilombolas INCRA (≤ {NEAR_KM:g} km).",
            "summary": summary, "items": listed[:MAX_ITEMS], "sources": sources,
            "not_modeled": ["Probabilidade de o fogo chegar a um alvo (exige modelo de propagação calibrado: combustível, umidade, relevo, vento local)",
                            "Taxa de propagação e tempo de chegada", "Área queimada final (ver DETER cicatrizes e produtos de área queimada)"],
        }

    # ----------------------------------------------------------------- parte pesada (thread)
    def _assemble(self, region: Region, frame: pd.DataFrame, res: dict, foreign: list, now: datetime, historical: bool,
                  start: date | None, end: date | None):
        sources: dict[str, dict] = {}
        lon0, lat0 = region.centroid
        proj = _Projector(lon0, lat0)
        summary: dict = {"detections": int(len(frame)), "clusters": 0}
        if frame.empty:
            return [], summary, sources
        xy = proj.points(frame["longitude"], frame["latitude"])
        labels = cluster_labels(xy, LINK_KM * 1000.0)
        frame = frame.assign(_c=labels, _x=xy[:, 0], _y=xy[:, 1])

        # Alvos projetados
        def feats(key):
            r = res.get(key)
            if r is None or isinstance(r, BaseException):
                sources[key] = {"available": False, "reason": getattr(r, "message", "não consultado") if r is not None else "não consultado"}
                return []
            data = r.data if hasattr(r, "data") else r.get("data")
            fs = (data or {}).get("features", []) if isinstance(data, dict) else []
            sources[key] = {"available": True, "features": len(fs)}
            return fs

        targets: list[dict] = []  # {type, name, geom_xy, extra}
        for lid, cat in POLY_LAYERS.items():
            ld = LAYERS[lid]
            for f in feats(lid):
                try:
                    g = shapely.make_valid(shape(f["geometry"]))
                except Exception:  # noqa: BLE001
                    continue
                p = f.get("properties", {})
                extra = {"layer": ld.label, "source": ld.primary_source}
                if cat == "indigenous":
                    extra.update(peoples=p.get("etnia_nome"), funai_unit=p.get("undadm_sig"))
                targets.append({"type": cat, "name": p.get(ld.name_field) or "(sem nome)", "geom": proj.geom(g), "extra": extra})
        for g, p in foreign:
            targets.append({"type": "indigenous", "name": p.get("name_es") or "(sem nome)", "geom": proj.geom(g), "extra": {"layer": "OTCA", "country": p.get("pais")}})
        for f in feats("roads"):
            try:
                g = shape(f["geometry"])
            except Exception:  # noqa: BLE001
                continue
            p = f.get("properties", {})
            targets.append({"type": "road", "name": f"BR-{p.get('vl_br')}" if p.get("vl_br") else "rodovia federal", "geom": proj.geom(g),
                            "extra": {"surface": p.get("ds_superfi"), "source": "DNIT"}})
        for f in feats("seats"):
            c = (f.get("geometry") or {}).get("coordinates")
            if c:
                targets.append({"type": "city", "name": (f.get("properties") or {}).get("identificador"), "geom": shapely.Point(proj.points([c[0]], [c[1]])[0]),
                                "extra": {"source": "IBGE BC250 (sede municipal)"}})
        for f in feats("localities"):
            p = f.get("properties") or {}
            if p.get("tipolocalidade") in ("Cidade", "Capital"):
                continue
            c = (f.get("geometry") or {}).get("coordinates")
            if c:
                targets.append({"type": "locality", "name": p.get("identificador"), "geom": shapely.Point(proj.points([c[0]], [c[1]])[0]),
                                "extra": {"kind": p.get("tipolocalidade"), "source": "IBGE BC250"}})
        brig = feats("brigades")
        brig_xy = proj.points([b["geometry"]["coordinates"][0] for b in brig], [b["geometry"]["coordinates"][1] for b in brig]) if brig else np.empty((0, 2))
        events = []
        ev_res = res.get("events")
        if ev_res is not None and not isinstance(ev_res, BaseException):
            for e in ev_res.data or []:
                try:
                    g = shape(e["geom"]) if e.get("geom") else None
                except Exception:  # noqa: BLE001
                    g = None
                if g is not None:
                    events.append((proj.geom(g), e))
            sources["events"] = {"available": True, "features": len(events), "label": "Censipam — eventos de fogo (Painel do Fogo)"}
        tgt_tree = shapely.STRtree([t["geom"] for t in targets]) if targets else None
        ev_tree = shapely.STRtree([g for g, _ in events]) if events else None

        # Recorrência histórica no local (arquivo, mesmo mês): Pará, modo atual
        rec_tree = rec_years = None
        if not historical and (region.id == "para" or region.definition.parent == "para"):
            month = now.month
            try:
                w, s, e, n = region.bbox
                path = self._runtime / "detections" / "MODIS_SP"
                files = sorted(path.glob("*.parquet"))
                if files:
                    t = ds.dataset([str(f) for f in files], format="parquet").to_table(
                        columns=["acq_date", "lat", "lon"],
                        filter=(ds.field("lat") >= s) & (ds.field("lat") <= n) & (ds.field("lon") >= w) & (ds.field("lon") <= e)).to_pandas()
                    t = t[t["acq_date"].str[5:7] == f"{month:02d}"]
                    if not t.empty:
                        rxy = proj.points(t["lon"], t["lat"])
                        rec_tree = shapely.STRtree(shapely.points(rxy))
                        rec_years = t["acq_date"].str[:4].astype(int).to_numpy()
                        summary["recurrence_archive"] = {"product": "MODIS (Terra/Aqua)", "years": [int(files[0].stem), int(files[-1].stem)], "month": month}
            except Exception as exc:  # noqa: BLE001 — arquivo local opcional
                log.warning("recorrência indisponível", extra={"error": str(exc)})

        items = []
        groups = frame.groupby("_c", sort=False)
        summary["clusters"] = int(groups.ngroups)
        for cid, g in groups:
            pts_xy = g[["_x", "_y"]].to_numpy()
            geom = shapely.multipoints(pts_xy) if len(pts_xy) > 1 else shapely.Point(pts_xy[0])
            cx, cy = pts_xy.mean(axis=0)
            clon, clat = float(g["longitude"].mean()), float(g["latitude"].mean())
            # proporção
            sc = g["scan_km"].fillna(0.375).to_numpy() if "scan_km" in g else np.where(g["product_id"].str.startswith("MODIS"), 1.0, 0.375)
            tr = g["track_km"].fillna(0.375).to_numpy() if "track_km" in g else sc
            boxes = shapely.box(pts_xy[:, 0] - sc * 500, pts_xy[:, 1] - tr * 500, pts_xy[:, 0] + sc * 500, pts_xy[:, 1] + tr * 500)
            area = float(shapely.union_all(boxes).area) / 1e6
            passes = g.groupby(["satellite_name", "acq_datetime_utc"])
            last_t = g["acq_datetime_utc"].max()
            first_t = g["acq_datetime_utc"].min()
            latest = g[g["acq_datetime_utc"] == last_t]
            disp = None
            if passes.ngroups >= 2 and (last_t - first_t) >= pd.Timedelta(hours=6):
                f0 = g[g["acq_datetime_utc"] == first_t]
                dx, dy = latest["_x"].mean() - f0["_x"].mean(), latest["_y"].mean() - f0["_y"].mean()
                km = math.hypot(dx, dy) / 1000.0
                if km >= 0.5:
                    disp = {"km": round(km, 1), "toward_deg": round(bearing_xy(dx, dy)), "toward_sector": sector(bearing_xy(dx, dy)),
                            "hours": round((last_t - first_t).total_seconds() / 3600, 1)}
            low = g["confidence_raw"].astype(str).str.lower().isin(["l", "low"]).mean() if "confidence_raw" in g else 0.0
            prop = {
                "pixels": int(len(g)), "by_satellite": {k: int(v) for k, v in g["satellite_name"].value_counts().items()},
                "overpasses": int(passes.ngroups), "satellites": int(g["satellite_name"].nunique()),
                "area_km2": round(area, 2), "frp_latest_pass_mw": None if latest["frp_mw"].dropna().empty else round(float(latest["frp_mw"].sum()), 1),
                "frp_max_mw": None if g["frp_mw"].dropna().empty else round(float(g["frp_mw"].max()), 1),
                "first_utc": first_t.isoformat().replace("+00:00", "Z"), "last_utc": last_t.isoformat().replace("+00:00", "Z"),
                "duration_h": round((last_t - first_t).total_seconds() / 3600, 1), "displacement": disp, "low_confidence_share": round(float(low), 2),
            }
            # alvos
            all_t = []
            if tgt_tree is not None:
                minx, miny, maxx, maxy = geom.bounds
                lim = max(CITY_KM, DOWNWIND_KM) * 1000.0
                for ti in tgt_tree.query(shapely.box(minx - lim, miny - lim, maxx + lim, maxy + lim)):
                    t = targets[int(ti)]
                    d = float(shapely.distance(geom, t["geom"])) / 1000.0
                    cap = CITY_KM if t["type"] == "city" else max(NEAR_KM, DOWNWIND_KM)
                    if d > cap:
                        continue
                    tp = nearest_points(t["geom"], shapely.Point(cx, cy))[0] if t["geom"].geom_type != "Point" else t["geom"]
                    brg = bearing_xy(tp.x - cx, tp.y - cy)
                    is_in = t["type"] in ("indigenous", "conservation", "quilombola") and bool(shapely.intersects(t["geom"], geom))
                    tlon, tlat = proj._t.transform(tp.x, tp.y, direction="INVERSE")
                    rec = {"type": t["type"], "name": t["name"], "km": 0.0 if is_in else round(d, 1), "bearing_deg": round(brg), "sector": sector(brg),
                           "lon": round(float(tlon), 5), "lat": round(float(tlat), 5),
                           "inside": is_in, "downwind": False, **{k: v for k, v in t["extra"].items() if v not in (None, "")}}
                    all_t.append(rec)
            # Um alvo por (tipo, nome): rodovias com vários trechos ou áreas multipartes ficam com a parte mais próxima.
            best: dict[tuple, dict] = {}
            for r in all_t:
                k = (r["type"], r["name"])
                if k not in best or (r["inside"], -r["km"]) > (best[k]["inside"], -best[k]["km"]):
                    best[k] = r
            all_t = sorted(best.values(), key=lambda r: r["km"])
            # recorrência
            recurrence = None
            if rec_tree is not None:
                idx = rec_tree.query(shapely.Point(cx, cy), predicate="dwithin", distance=1000.0)
                yrs = sorted(set(rec_years[idx].tolist())) if len(idx) else []
                recurrence = {"years_with_detection": len(yrs), "last_year": yrs[-1] if yrs else None, "month": now.month, "km": 1.0}
            # evento Censipam (confirmação operacional independente)
            event = None
            if ev_tree is not None:
                hits = ev_tree.query(geom, predicate="intersects")
                if len(hits):
                    e = events[int(hits[0])][1]
                    event = {"id": e.get("id_evento"), "status": e.get("status_evento"), "persistence_days": e.get("persistencia_dias"),
                             "last_seen": e.get("dt_ultima_visao")}
            # acesso
            access = {}
            roads = [r for r in all_t if r["type"] == "road"]
            if roads:
                access["nearest_federal_road"] = {"name": roads[0]["name"], "km": roads[0]["km"], "sector": roads[0]["sector"]}
            if len(brig_xy):
                dd = np.hypot(brig_xy[:, 0] - cx, brig_xy[:, 1] - cy) / 1000.0
                j = int(np.argmin(dd))
                bp = brig[j].get("properties", {})
                access["nearest_brigade"] = {"name": (bp.get("nome") or "").replace("_", " "), "agency": bp.get("orgao_responsavel"),
                                             "municipality": bp.get("municipio"), "km": round(float(dd[j]), 1)}
            refs = [{"p": r.product_id, "id": r.detection_id, "s": r.satellite_name, "t": r.acq_datetime_utc.strftime("%Y-%m-%dT%H:%MZ"),
                     "lon": round(float(r.longitude), 5), "lat": round(float(r.latitude), 5)}
                    for r in g.sort_values("acq_datetime_utc", ascending=False).head(30).itertuples()]
            hull = shapely.convex_hull(shapely.multipoints(g[["longitude", "latitude"]].to_numpy())) if len(g) > 2 else None
            item = {
                "id": f"f{int(cid)}-{int(last_t.timestamp())}", "centroid": [round(clon, 5), round(clat, 5)],
                "bbox": [round(float(g["longitude"].min()), 4), round(float(g["latitude"].min()), 4), round(float(g["longitude"].max()), 4), round(float(g["latitude"].max()), 4)],
                "hull": mapping(hull) if hull is not None and hull.geom_type == "Polygon" else None,
                "proportion": prop, "_all_targets": all_t, "wind": None, "access": access,
                "censipam_event": event, "recurrence": recurrence, "detections": refs,
            }
            # pré-grau (para priorizar quais células recebem vento)
            item["_pre"] = 0 if any(r["inside"] for r in all_t) or any(r["km"] <= CLOSE_KM and r["type"] in ("city", "locality", "indigenous") for r in all_t) else (1 if all_t else 2)
            items.append(item)
        sources["seats"] = sources.get("seats", {}) | {"label": "IBGE BC250 — sedes municipais"}
        return items, summary, sources

    # ----------------------------------------------------------------- escadas de regras
    @staticmethod
    def _grade(it: dict, now: datetime, historical: bool) -> None:
        p = it["proportion"]
        ts = it["_all_targets"]
        confirmed = p["overpasses"] >= 2
        recent = historical or pd.Timestamp(p["last_utc"]) >= now - timedelta(hours=24)
        inside = [t for t in ts if t["inside"]]
        close_people = [t for t in ts if t["km"] <= CLOSE_KM and t["type"] in ("city", "locality", "indigenous")]
        city_close = [t for t in ts if t["type"] == "city" and t["km"] <= CLOSE_KM]
        down10 = [t for t in ts if t["downwind"] and t["km"] <= NEAR_KM]
        near10 = [t for t in ts if t["km"] <= NEAR_KM and t["type"] != "city"] + [t for t in ts if t["type"] == "city" and t["km"] <= NEAR_KM]
        reasons = []
        if confirmed:
            reasons.append({"id": "confirmed", "params": {"overpasses": p["overpasses"], "satellites": p["satellites"]}})
        if inside:
            reasons.append({"id": "inside", "params": {"names": [t["name"] for t in inside][:3]}})
        if close_people:
            reasons.append({"id": "close_people", "params": {"names": [f"{t['name']} ({t['km']} km)" for t in close_people][:3], "km": CLOSE_KM}})
        if down10:
            reasons.append({"id": "downwind", "params": {"names": [f"{t['name']} ({t['km']} km)" for t in down10][:3], "km": NEAR_KM}})
        if confirmed and recent and (inside or close_people or down10):
            level = "alto"
        elif (confirmed and near10) or inside or city_close:
            level = "moderado"
        elif near10:
            level = "baixo"
        else:
            level = "sem_alvo"
        if not recent and level == "alto":
            level = "moderado"
        it["level"], it["level_reasons"] = level, reasons
        ev = it.get("censipam_event")
        if p["satellites"] >= 2 and (p["overpasses"] >= 3 or (ev and str(ev.get("status", "")).lower().startswith("ativ"))):
            ver = "alta"
        elif p["overpasses"] >= 2 and p["low_confidence_share"] < 1:
            ver = "media"
        else:
            ver = "baixa"
        it["veracity"] = ver
        it["targets"] = {
            "inside": inside,
            "downwind": [t for t in ts if t["downwind"] and not t["inside"]][:8],
            "near": [t for t in ts if not t["inside"] and not t["downwind"] and (t["km"] <= NEAR_KM or (t["type"] == "city" and t["km"] <= CITY_KM))][:10],
        }
