"""Contexto meteorológico a partir do NASA POWER.

Três categorias são sempre separadas na resposta:
* ``historical``  — climatologia mensal (média 2001–2025 informada pela API);
* ``recent_analysis`` — reanálise diária/horária recente (latência de dias);
* ``forecast`` — previsão: NÃO disponível no NASA POWER (não integrada).
"""

from __future__ import annotations

import asyncio
import math
from datetime import UTC, date, datetime, timedelta

import numpy as np
import pandas as pd

from app.core.errors import AppError
from app.integrations.power import MONTH_KEYS, PowerClient

SECTORS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
SPEED_BINS = [0, 1, 2, 3, 5, math.inf]
SPEED_LABELS = ["0–1", "1–2", "2–3", "3–5", "≥5"]

GRID_NOTE = (
    "Valores de reanálise em grade (~0,5° × 0,625°, GEOS-IT/MERRA-2) para a célula que contém o ponto. "
    "Não são medições de estação nem medições instantâneas no local de uma detecção."
)


def _clean(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else round(f, 2)


def wind_rose(direction_deg: pd.Series, speed_ms: pd.Series) -> dict:
    """Frequência (%) por setor de 22,5° (de onde o vento sopra) e classe de velocidade."""
    d = pd.DataFrame({"dir": direction_deg, "spd": speed_ms}).dropna()
    if d.empty:
        return {"n_hours": 0, "sectors": SECTORS_16, "speed_classes_ms": SPEED_LABELS, "freq_pct": []}
    sector_idx = (((d["dir"] % 360) + 11.25) // 22.5).astype(int) % 16
    speed_cls = pd.cut(d["spd"], SPEED_BINS, labels=SPEED_LABELS, right=False)
    table = pd.crosstab(sector_idx, speed_cls).reindex(index=range(16), columns=SPEED_LABELS, fill_value=0)
    pct = table / len(d) * 100
    # Direção resultante (média vetorial ponderada pela velocidade)
    rad = np.deg2rad(d["dir"].to_numpy())
    u = -(d["spd"] * np.sin(rad)).mean()
    v = -(d["spd"] * np.cos(rad)).mean()
    resultant_from = (math.degrees(math.atan2(-u, -v)) + 360) % 360
    return {
        "n_hours": int(len(d)),
        "sectors": SECTORS_16,
        "speed_classes_ms": SPEED_LABELS,
        "freq_pct": [[round(float(x), 2) for x in row] for row in pct.to_numpy()],
        "prevailing_sector": SECTORS_16[int(table.sum(axis=1).idxmax())],
        "resultant_direction_from_deg": round(resultant_from, 1),
        "mean_speed_ms": round(float(d["spd"].mean()), 2),
        "convention": "Direção meteorológica: de onde o vento sopra (0° = norte, sentido horário).",
    }


def climatology_expected(clim: pd.DataFrame, param: str, days: list[date]) -> float | None:
    """Soma das médias climatológicas diárias (média mensal mm/dia) para os dias informados."""
    if param not in clim:
        return None
    total = 0.0
    for d in days:
        v = clim.loc[MONTH_KEYS[d.month - 1], param]
        if pd.isna(v):
            return None
        total += float(v)
    return total


class WeatherService:
    def __init__(self, power: PowerClient) -> None:
        self._power = power

    async def context(self, lat: float, lon: float, days: int = 30, today: date | None = None) -> dict:
        today = today or datetime.now(UTC).date()
        days = max(7, min(days, 90))
        start = today - timedelta(days=days + 7)  # margem para a latência da fonte
        h_start = today - timedelta(days=10)

        daily_r, hourly_r, clim_r = await asyncio.gather(
            self._power.daily(lat, lon, start, today),
            self._power.hourly(lat, lon, h_start, today),
            self._power.climatology(lat, lon),
            return_exceptions=True,
        )
        errors = {}
        for name, r in (("daily", daily_r), ("hourly", hourly_r), ("climatology", clim_r)):
            if isinstance(r, AppError):
                errors[name] = {"code": r.code, "message": r.message}
            elif isinstance(r, BaseException):
                raise r

        out: dict = {
            "point": {"lat": lat, "lon": lon},
            "grid_note": GRID_NOTE,
            "generated_at": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "errors": errors,
            "forecast": {
                "available": False,
                "note": "O NASA POWER não fornece previsão. Nenhuma previsão meteorológica está integrada nesta versão.",
            },
        }

        # ---------------------------------------------------------- recente
        recent: dict = {"available": False}
        if not isinstance(daily_r, BaseException):
            df = daily_r.frame
            valid = df.dropna(how="all")
            last_valid = valid.index.max().date() if not valid.empty else None
            window = valid[valid.index >= pd.Timestamp(last_valid - timedelta(days=days - 1))] if last_valid else valid
            series = [
                {"date": idx.date().isoformat(), **{k: _clean(v) for k, v in row.items()}}
                for idx, row in window.iterrows()
            ]
            recent = {
                "available": not valid.empty,
                "kind": "Reanálise diária (não é previsão nem medição de estação)",
                "time_standard": daily_r.header.get("time_standard"),
                "sources": daily_r.header.get("sources"),
                "api_version": (daily_r.header.get("api") or {}).get("version"),
                "parameters": daily_r.parameters,
                "last_available_date": last_valid.isoformat() if last_valid else None,
                "latency_days": (today - last_valid).days if last_valid else None,
                "series": series,
                "provenance": {
                    "source": "NASA POWER",
                    "request_url": daily_r.request_url,
                    "fetched_at": daily_r.fetched_at.isoformat(timespec="seconds"),
                    "cache_hit": daily_r.cache_hit,
                    "stale": daily_r.stale,
                    "warnings": daily_r.warnings,
                },
            }
            if not valid.empty:
                last = valid.iloc[-1]
                recent["latest"] = {"date": last_valid.isoformat(), **{k: _clean(v) for k, v in last.items()}}
                for n in (7, 14, 30):
                    sub = valid[valid.index > pd.Timestamp(last_valid - timedelta(days=n))]
                    p = sub["PRECTOTCORR"].dropna() if "PRECTOTCORR" in sub else pd.Series(dtype=float)
                    rh = sub["RH2M"].dropna() if "RH2M" in sub else pd.Series(dtype=float)
                    recent[f"last_{n}d"] = {
                        "days_with_data": int(len(p)),
                        "precip_total_mm": round(float(p.sum()), 1) if len(p) else None,
                        "rh_mean_pct": round(float(rh.mean()), 1) if len(rh) else None,
                        "t2m_max_mean_c": _clean(sub["T2M_MAX"].mean()) if "T2M_MAX" in sub else None,
                        "period": [
                            (last_valid - timedelta(days=n - 1)).isoformat(), last_valid.isoformat()
                        ],
                    }
        out["recent_analysis"] = recent

        # ---------------------------------------------------------- horário
        hourly: dict = {"available": False}
        if not isinstance(hourly_r, BaseException):
            h = hourly_r.frame.dropna(how="all")
            if not h.empty:
                last_h = h.index.max()
                h7 = h[h.index > last_h - pd.Timedelta(days=7)]
                hourly = {
                    "available": True,
                    "kind": "Reanálise horária (UTC)",
                    "last_available_hour_utc": last_h.strftime("%Y-%m-%dT%H:00Z"),
                    "latest": {k: _clean(v) for k, v in h.iloc[-1].items()},
                    "wind_rose_7d": wind_rose(h7.get("WD10M", pd.Series(dtype=float)), h7.get("WS10M", pd.Series(dtype=float))),
                    "wind_height_m": 10,
                    "provenance": {
                        "source": "NASA POWER",
                        "request_url": hourly_r.request_url,
                        "fetched_at": hourly_r.fetched_at.isoformat(timespec="seconds"),
                        "cache_hit": hourly_r.cache_hit,
                        "stale": hourly_r.stale,
                    },
                }
        out["recent_hourly"] = hourly

        # ---------------------------------------------------- climatologia
        hist: dict = {"available": False}
        if not isinstance(clim_r, BaseException):
            clim = clim_r.frame
            hist = {
                "available": True,
                "kind": "Climatologia mensal (média de longo prazo)",
                "range": clim_r.header.get("range"),
                "sources": clim_r.header.get("sources"),
                "parameters": clim_r.parameters,
                "monthly": {m: {k: _clean(v) for k, v in clim.loc[m].items()} for m in MONTH_KEYS},
                "provenance": {
                    "source": "NASA POWER",
                    "request_url": clim_r.request_url,
                    "fetched_at": clim_r.fetched_at.isoformat(timespec="seconds"),
                },
            }
            # Comparação: chuva recente × esperado pela climatologia no mesmo período
            if recent.get("available"):
                comps = {}
                for n in (7, 14, 30):
                    blk = recent.get(f"last_{n}d") or {}
                    if not blk.get("days_with_data"):
                        continue
                    d0, d1 = (date.fromisoformat(x) for x in blk["period"])
                    period_days = [d0 + timedelta(days=i) for i in range((d1 - d0).days + 1)]
                    exp = climatology_expected(clim, "PRECTOTCORR", period_days)
                    obs = blk["precip_total_mm"]
                    comps[f"last_{n}d"] = {
                        "observed_mm": obs,
                        "climatology_expected_mm": round(exp, 1) if exp is not None else None,
                        "ratio": round(obs / exp, 2) if (exp and obs is not None) else None,
                        "days_with_data": blk["days_with_data"],
                    }
                hist["precip_vs_climatology"] = comps
        out["historical"] = hist
        return out
