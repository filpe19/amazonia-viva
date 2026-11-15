"""Fixtures SINTÉTICAS para testes.

Nenhum valor aqui é observação real. Os CSVs imitam apenas o FORMATO dos
arquivos da NASA FIRMS e do NASA POWER para exercitar parsers e agregações.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta


def synthetic_viirs_nrt_csv(now: datetime, rows: list[tuple[float, float, float, str, str]] | None = None, satellite: str = "N20") -> str:
    """rows: (lat, lon, horas_atrás, confiança, dia/noite)."""
    rows = rows or [
        (-2.50, -54.90, 1.0, "nominal", "D"),   # dentro de Santarém
        (-2.60, -55.10, 30.0, "high", "N"),     # dentro de Santarém, fora de 24h
        (-1.45, -48.49, 2.0, "low", "D"),       # Belém (PA), fora de Santarém
        (-23.55, -46.63, 3.0, "nominal", "D"),  # São Paulo, fora do Pará
    ]
    lines = ["latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight"]
    for lat, lon, h, conf, dn in rows:
        t = now - timedelta(hours=h)
        lines.append(f"{lat},{lon},330.1,0.4,0.5,{t:%Y-%m-%d},{t:%H%M},{satellite},{conf},2.0NRT,290.2,5.5,{dn}")
    return "\n".join(lines) + "\n"


def synthetic_modis_nrt_csv(now: datetime) -> str:
    t = now - timedelta(hours=5)
    return (
        "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight\n"
        f"-2.55,-54.95,320.5,1.1,1.0,{t:%Y-%m-%d},{t:%H%M},A,85,6.1NRT,295.0,12.3,D\n"
    )


SYNTHETIC_MODIS_ARCHIVE = (
    "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type\n"
    "-2.5,-54.9,310.0,1.0,1.0,2020-09-01,1330,Aqua,MODIS,90,6.03,290.0,20.0,D,0\n"
    "-2.5,-54.9,305.0,1.0,1.0,2020-09-01,0130,Terra,MODIS,25,6.03,288.0,8.0,N,2\n"
)


def synthetic_power_daily(start: datetime, days: int, fill_last: int = 2) -> bytes:
    params = {"T2M": {}, "T2M_MAX": {}, "RH2M": {}, "WS10M": {}, "WD10M": {}, "PRECTOTCORR": {}}
    for i in range(days):
        d = (start + timedelta(days=i)).strftime("%Y%m%d")
        fill = i >= days - fill_last
        params["T2M"][d] = -999.0 if fill else 30.0
        params["T2M_MAX"][d] = -999.0 if fill else 35.0
        params["RH2M"][d] = -999.0 if fill else 60.0
        params["WS10M"][d] = -999.0 if fill else 2.0
        params["WD10M"][d] = -999.0 if fill else 90.0
        params["PRECTOTCORR"][d] = -999.0 if fill else 1.0
    return json.dumps({
        "type": "Feature",
        "properties": {"parameter": params},
        "header": {"fill_value": -999.0, "time_standard": "LST", "sources": ["SYNTHETIC"], "api": {"version": "test"}},
        "parameters": {k: {"units": "x", "longname": k} for k in params},
    }).encode()


def synthetic_power_hourly(end: datetime, hours: int = 48) -> bytes:
    params = {"T2M": {}, "RH2M": {}, "WS10M": {}, "WD10M": {}, "PRECTOTCORR": {}}
    for i in range(hours):
        t = (end - timedelta(hours=hours - i)).strftime("%Y%m%d%H")
        params["T2M"][t] = 29.0
        params["RH2M"][t] = 65.0
        params["WS10M"][t] = 2.5
        params["WD10M"][t] = 90.0  # de leste
        params["PRECTOTCORR"][t] = 0.0
    return json.dumps({"properties": {"parameter": params}, "header": {"fill_value": -999.0, "time_standard": "UTC"}, "parameters": {}}).encode()


def synthetic_power_climatology() -> bytes:
    months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC", "ANN"]
    params = {k: {m: v for m in months} for k, v in {"T2M": 28.0, "RH2M": 70.0, "WS10M": 2.0, "PRECTOTCORR": 2.0}.items()}
    return json.dumps({"properties": {"parameter": params}, "header": {"fill_value": -999.0, "range": "SYNTHETIC 2001-2025"}, "parameters": {}}).encode()


def utc_now() -> datetime:
    return datetime.now(UTC).replace(second=0, microsecond=0)
