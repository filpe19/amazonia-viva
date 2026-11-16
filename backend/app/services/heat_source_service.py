"""'É incêndio mesmo?' — indícios sobre a origem do calor de uma detecção, com fontes oficiais.

Nenhuma classificação é inventada: cada indício é um fato verificável e vem com a fonte.
* Confirmação: outras passagens de satélite a ≤ 1 km em ± 24 h (NASA FIRMS NRT).
* Fonte estática: no arquivo FIRMS (processamento padrão), o campo `type` = 2 marca "outra fonte terrestre estática"
  (ex.: indústria, olaria). Histórico local: anos com detecção a ≤ 500 m. (Arquivo disponível para o Pará.)
* Mineração/garimpo: processos minerários e reservas garimpeiras da ANM (SIGMINE); avisos DETER de mineração (INPE).
* Desmatamento: aviso DETER de desmatamento ou cicatriz de incêndio nos últimos 12 meses (INPE).
A "leitura" é uma regra explícita sobre esses fatos, nunca um diagnóstico. Sem dado de campo, nada é confirmado.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.dataset as ds
import shapely
from shapely.geometry import shape

from app.core.errors import AppError
from app.integrations.deter import DETER_CLASSES, deter_bbox
from app.services.detections_service import DetectionsService, detections_in_bbox

log = logging.getLogger("app.heat_source")

ALL_PRODUCTS = "VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT,MODIS_NRT"
CONFIRM_KM = 1.0
CONFIRM_HOURS = 24
ARCHIVE_KM = 0.5
ARCHIVE_PRODUCTS = {"MODIS_SP": "MODIS (Terra/Aqua), 2001–2025", "VIIRS_NOAA20_SP": "VIIRS NOAA-20, 2021–2025"}


def haversine_km(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = map(np.radians, (lon1, lat1, lon2, lat2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * np.arcsin(np.sqrt(a))


class HeatSourceService:
    def __init__(self, detections: DetectionsService, indigenous, http, cache, runtime_dir: Path) -> None:
        self._det = detections
        self._ind = indigenous  # reutiliza o cliente da ANM (cadeia TLS e cache)
        self._http = http
        self._cache = cache
        self._archive = runtime_dir / "detections"

    def _archive_near(self, lon: float, lat: float) -> dict:
        out = {}
        dlat = ARCHIVE_KM / 110.574
        dlon = ARCHIVE_KM / (111.32 * max(0.2, np.cos(np.radians(lat))))
        for pid, label in ARCHIVE_PRODUCTS.items():
            path = self._archive / pid
            if not path.exists():
                continue
            files = sorted(path.glob("*.parquet"))
            if not files:
                continue
            dset = ds.dataset([str(f) for f in files], format="parquet")
            f = ((ds.field("lat") >= lat - dlat) & (ds.field("lat") <= lat + dlat) & (ds.field("lon") >= lon - dlon) & (ds.field("lon") <= lon + dlon))
            t = dset.to_table(columns=["acq_date", "type", "lat", "lon"], filter=f).to_pandas()
            years = sorted({int(Path(x).stem) for x in map(str, files) if Path(x).stem.isdigit()})
            if not t.empty:
                t = t[haversine_km(lon, lat, t["lon"].to_numpy(), t["lat"].to_numpy()) <= ARCHIVE_KM]
            yrs = sorted({int(str(d)[:4]) for d in t["acq_date"]}) if not t.empty else []
            out[pid] = {"label": label, "records": int(len(t)), "years_with_detection": yrs, "years_in_archive": [years[0], years[-1]] if years else None,
                        "n_years_archive": len(years), "static_type2": int((t["type"] == 2).sum()) if not t.empty else 0,
                        "months": sorted({int(str(d)[5:7]) for d in t["acq_date"]}) if not t.empty else []}
        return out

    async def evidence(self, product_id: str, detection_id: str) -> dict | None:
        rec = await self._det.find(product_id, detection_id)
        if not rec:
            return None
        lon, lat = float(rec["longitude"]), float(rec["latitude"])
        t0 = pd.Timestamp(rec["acq_datetime_utc"])
        now = datetime.now(UTC)
        box = (lon - 0.03, lat - 0.03, lon + 0.03, lat + 0.03)
        near_task = detections_in_bbox(self._det, box, "7d", ALL_PRODUCTS, now=now)
        deter_task = deter_bbox(self._http, self._cache, (lon - 0.015, lat - 0.015, lon + 0.015, lat + 0.015), (now - timedelta(days=365)).date())
        anm_task = self._ind.anm((lon - 0.005, lat - 0.005, lon + 0.005, lat + 0.005))
        archive_task = asyncio.to_thread(self._archive_near, lon, lat)
        near_res, deter_res, anm_res, arch_res = await asyncio.gather(near_task, deter_task, anm_task, archive_task, return_exceptions=True)
        for r in (near_res, deter_res, anm_res, arch_res):
            if isinstance(r, BaseException) and not isinstance(r, AppError | OSError | ValueError):
                raise r
        items: list[dict] = []
        sources: dict[str, dict] = {}
        p = shapely.Point(lon, lat)

        # 1. confirmação por outras passagens
        if isinstance(near_res, BaseException):
            sources["firms"] = {"available": False, "reason": getattr(near_res, "message", str(near_res))}
        else:
            f = near_res[0]
            others = pd.DataFrame()
            if not f.empty:
                d = haversine_km(lon, lat, f["longitude"].to_numpy(), f["latitude"].to_numpy())
                dt = (f["acq_datetime_utc"] - t0).abs() <= pd.Timedelta(hours=CONFIRM_HOURS)
                mask = (d <= CONFIRM_KM) & dt.to_numpy() & (f["detection_id"] != detection_id).to_numpy()
                others = f[mask]
            same_pass = others[(others["satellite_name"] == rec["satellite_name"]) & (others["acq_datetime_utc"] == t0)] if len(others) else others
            other_passes = others.drop(same_pass.index) if len(others) else others
            n_pass = int(other_passes.groupby(["satellite_name", "acq_datetime_utc"]).ngroups) if len(other_passes) else 0
            sats = sorted(other_passes["satellite_name"].unique().tolist()) if len(other_passes) else []
            sources["firms"] = {"available": True, "label": "NASA FIRMS NRT (7 dias, 4 satélites)"}
            if n_pass:
                items.append({"id": "confirmed", "direction": "supports_fire", "params": {"passes": n_pass, "satellites": sats, "km": CONFIRM_KM, "hours": CONFIRM_HOURS},
                              "source": "NASA FIRMS"})
            else:
                items.append({"id": "single_pass", "direction": "caution", "params": {"km": CONFIRM_KM, "hours": CONFIRM_HOURS, "same_pass": int(len(same_pass))},
                              "source": "NASA FIRMS"})
        conf_low = (rec.get("sensor") == "VIIRS" and rec.get("confidence_class") == "low") or (
            rec.get("sensor") == "MODIS" and rec.get("confidence_pct") is not None and rec["confidence_pct"] < 30)
        if conf_low:
            items.append({"id": "low_confidence", "direction": "caution", "params": {"value": rec.get("confidence_class") or rec.get("confidence_pct")}, "source": "NASA FIRMS"})

        # 2. fonte estática e histórico local (arquivo FIRMS)
        if isinstance(arch_res, BaseException) or not arch_res:
            sources["archive"] = {"available": False, "reason": "Arquivo histórico local indisponível para este ponto (importado para o Pará)."}
        else:
            sources["archive"] = {"available": True, "label": "NASA FIRMS — arquivo de processamento padrão (recorte do Pará)"}
            static = sum(v["static_type2"] for v in arch_res.values())
            if static:
                items.append({"id": "static_source", "direction": "other_source", "params": {"records": static, "km": ARCHIVE_KM}, "source": "NASA FIRMS (type = 2)"})
            for pid, v in arch_res.items():
                if v["records"]:
                    items.append({"id": "history", "direction": "context", "params": {"product": v["label"], "years": len(v["years_with_detection"]),
                                  "n_years": v["n_years_archive"], "records": v["records"], "km": ARCHIVE_KM, "months": v["months"]}, "source": pid})
            if not any(v["records"] for v in arch_res.values()):
                items.append({"id": "no_history", "direction": "context", "params": {"km": ARCHIVE_KM}, "source": "NASA FIRMS (arquivo)"})

        # 3. mineração e garimpo (ANM)
        mining = None
        if isinstance(anm_res, BaseException):
            sources["anm"] = {"available": False, "reason": getattr(anm_res, "message", str(anm_res))}
        else:
            feats, _partial = anm_res
            sources["anm"] = {"available": True, "label": "ANM — SIGMINE"}
            hits = [f["properties"] for f in feats if f["geom"].contains(p)]
            if hits:
                garimpo = [h for h in hits if h.get("_layer") == "reserva_garimpeira" or "GARIMP" in str(h.get("FASE", "")).upper()]
                mining = "garimpo" if garimpo else "process"
                items.append({"id": "mining_garimpo" if garimpo else "mining_process", "direction": "other_source",
                              "params": {"titles": [f"{h.get('FASE') or 'Reserva garimpeira'} · {h.get('SUBS') or h.get('NMReservaGarimpeira') or '—'}" for h in (garimpo or hits)][:3],
                                         "processes": [h.get("PROCESSO") for h in hits if h.get("PROCESSO")][:3]},
                              "source": "ANM SIGMINE"})

        # 4. DETER (INPE): desmatamento, cicatriz, mineração
        if isinstance(deter_res, BaseException):
            sources["deter"] = {"available": False, "reason": getattr(deter_res, "message", str(deter_res))}
        else:
            sources["deter"] = {"available": True, "label": "INPE — DETER (12 meses)"}
            for f in deter_res["data"].get("features", []):
                if not f.get("geometry"):
                    continue
                g = shapely.make_valid(shape(f["geometry"]))
                if g.contains(p):
                    pr = f.get("properties", {})
                    grp = DETER_CLASSES.get(pr.get("classname") or "", ("other", pr.get("classname")))[0]
                    did = {"deforestation": "deter_deforestation", "burn_scar": "deter_burn_scar", "mining": "deter_mining",
                           "degradation": "deter_degradation", "selective_logging": "deter_logging"}.get(grp, "deter_other")
                    items.append({"id": did, "direction": "other_source" if grp == "mining" else "context",
                                  "params": {"class": pr.get("classname"), "view_date": pr.get("view_date"), "area_km2": round(float(pr.get("areamunkm") or 0), 2)},
                                  "source": "INPE DETER"})
                    if grp == "mining" and mining is None:
                        mining = "deter"
                    break

        ids = {i["id"] for i in items}
        if "static_source" in ids:
            reading = "static_source"
        elif mining:
            reading = "mining_context"
        elif "deter_deforestation" in ids:
            reading = "clearing_context"
        elif "confirmed" in ids:
            reading = "vegetation_fire_compatible"
        else:
            reading = "inconclusive"
        return {
            "available": True, "detection": {"product_id": product_id, "id": detection_id, "lon": lon, "lat": lat, "acq_datetime_utc": rec["acq_datetime_utc"],
                                             "satellite": rec["satellite_name"]},
            "evidence": items, "reading": reading,
            "reading_rules": [
                "Fonte estática (FIRMS type 2 a ≤ 500 m no arquivo) → provável fonte não florestal.",
                "Dentro de processo minerário/reserva garimpeira (ANM) ou aviso DETER de mineração → contexto de mineração.",
                "Dentro de aviso DETER de desmatamento (12 meses) → contexto de queima após desmatamento.",
                "Confirmada por outra passagem a ≤ 1 km em ± 24 h, sem os indícios acima → compatível com queima de vegetação.",
                "Caso contrário → inconclusivo (observação única ou sem bases para o ponto).",
            ],
            "disclaimer": "Indícios a partir de bases oficiais; não substituem verificação em campo nem determinam causa ou responsabilidade.",
            "sources": sources, "generated_at": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        }
