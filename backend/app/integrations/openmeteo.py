"""Vento atual e das próximas horas por modelo numérico (Open-Meteo, sem chave; CC BY 4.0).

É PREVISÃO/ANÁLISE DE MODELO (ECMWF IFS, GFS, ICON e outros combinados pelo Open-Meteo), não medição local.
Usado só para indicar a direção para onde o vento sopra a partir de um foco; não é modelo de propagação do fogo.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from urllib.parse import urlencode

from app.core.http import HttpClient
from app.persistence.cache import FileCache

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
SOURCE = "Open-Meteo (modelos numéricos ECMWF/GFS/ICON; CC BY 4.0)"
CELL_DEG = 0.25  # resolução típica dos modelos globais: focos na mesma célula compartilham o vento


def cell_of(lat: float, lon: float) -> tuple[float, float]:
    return (round(round(lat / CELL_DEG) * CELL_DEG, 2), round(round(lon / CELL_DEG) * CELL_DEG, 2))


async def wind_cells(http: HttpClient, cache: FileCache, cells: list[tuple[float, float]], ttl: int = 1800) -> dict:
    """Vento a 10 m (atual + 6 h) para células (lat, lon). Retorna {célula: {...}}; células falhas ficam ausentes."""
    out: dict[tuple[float, float], dict] = {}
    for i in range(0, len(cells), 50):
        chunk = cells[i:i + 50]
        params = {"latitude": ",".join(f"{c[0]:.2f}" for c in chunk), "longitude": ",".join(f"{c[1]:.2f}" for c in chunk),
                  "current": "wind_speed_10m,wind_direction_10m,wind_gusts_10m", "hourly": "wind_speed_10m,wind_direction_10m",
                  "forecast_hours": 6, "timezone": "UTC", "wind_speed_unit": "ms"}
        url = f"{OPEN_METEO}?{urlencode(params)}"
        key = f"openmeteo:{url}"
        entry = cache.get(key)
        if entry and entry.is_fresh(ttl):
            body = entry.content
        else:
            res = await http.get(url, source="Open-Meteo")
            body = res.content
            cache.put(key, body, {"url": url, "fetched_at": datetime.now(UTC).isoformat()})
        data = json.loads(body)
        data = data if isinstance(data, list) else [data]
        for c, d in zip(chunk, data, strict=False):
            cur = d.get("current") or {}
            if cur.get("wind_direction_10m") is None:
                continue
            hourly = d.get("hourly") or {}
            out[c] = {"speed_ms": cur.get("wind_speed_10m"), "from_deg": cur.get("wind_direction_10m"),
                      "toward_deg": (float(cur["wind_direction_10m"]) + 180.0) % 360.0, "gusts_ms": cur.get("wind_gusts_10m"),
                      "time_utc": f"{cur.get('time')}Z" if cur.get("time") else None,
                      "next_hours": [{"time_utc": f"{t}Z", "speed_ms": s, "from_deg": dd} for t, s, dd in
                                     zip(hourly.get("time", []), hourly.get("wind_speed_10m", []), hourly.get("wind_direction_10m", []), strict=False)],
                      "model_cell": list(c), "source": SOURCE}
    return out
