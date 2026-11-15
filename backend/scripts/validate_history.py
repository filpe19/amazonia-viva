"""Conferência independente dos cálculos históricos (dados reais).

Recalcula contagens diretamente do Parquet local (pandas + shapely, sem passar pelo
HistoryService/SQLite) e compara com a API em execução. Também confere coerência
interna (calendário × série mensal; somatório do Pará × linhas do importador).

Uso (a partir de backend/, com a API rodando):  python -m scripts.validate_history portel
"""

from __future__ import annotations

import sys

import httpx
import pandas as pd
import pyarrow.parquet as pq
import shapely
from shapely.geometry import shape

from app.core.config import get_settings
from app.persistence.history_store import HistoryStore

API = "http://127.0.0.1:8710/api/v1"


def main(region_id: str = "portel") -> int:
    settings = get_settings()
    store = HistoryStore(settings.history_db_path)
    files = store.source_files()
    boundary = httpx.get(f"{API}/regions/{region_id}/boundary", timeout=60).json()
    geom = shapely.union_all([shape(f["geometry"]) for f in boundary["features"]])
    shapely.prepare(geom)
    problems = 0
    for product in ("MODIS_SP", "VIIRS_NOAA20_SP", "VIIRS_SNPP_SP"):
        api = httpx.get(f"{API}/history/monthly", params={"region": region_id, "product": product}, timeout=120).json()
        api_m = {s["year_month"]: s["n"] for s in api["series"]}
        indep: dict[str, int] = {}
        for f in [x for x in files if x["product_id"] == product and x.get("parquet_path")]:
            t = pq.read_table(settings.runtime_dir / f["parquet_path"], columns=["acq_date", "lat", "lon"]).to_pandas()
            t = t[shapely.contains_xy(geom, t["lon"].to_numpy(), t["lat"].to_numpy())]
            for ym, n in t["acq_date"].str.slice(0, 7).value_counts().items():
                indep[ym] = indep.get(ym, 0) + int(n)
        keys = sorted(set(api_m) | set(indep))
        diffs = [(k, api_m.get(k, 0), indep.get(k, 0)) for k in keys if api_m.get(k, 0) != indep.get(k, 0)]
        total_api, total_ind = sum(api_m.values()), sum(indep.values())
        status = "ok" if not diffs else "DIVERGE"
        problems += bool(diffs)
        print(f"[{status}] {product:16s} {region_id}: {len(keys)} meses; total API {total_api:,} × independente {total_ind:,}; divergências {len(diffs)}")
        for d in diffs[:5]:
            print(f"        {d}")
        # calendário × série mensal (ano mais recente)
        if api["years"]:
            y = api["years"][-1]
            cal = httpx.get(f"{API}/history/calendar", params={"region": region_id, "product": product, "year": y}, timeout=60).json()
            m_sum = sum(v for k, v in api_m.items() if k.startswith(str(y)))
            ok = cal["total"] == m_sum
            problems += not ok
            print(f"[{'ok' if ok else 'DIVERGE'}] calendário {y} ({cal['total']:,}) = soma mensal ({m_sum:,})")
        # medianas recalculadas para o mês de setembro
        sep = pd.Series({s["year"]: s["n"] for s in api["series"] if s["month"] == 9})
        b = next(x for x in api["baseline_by_month"] if x["month"] == 9)
        ok = (b["median"] is None and sep.empty) or abs(float(sep.median()) - float(b["median"])) < 1e-9
        problems += not ok
        print(f"[{'ok' if ok else 'DIVERGE'}] mediana de setembro recalculada ({sep.median() if not sep.empty else None}) = API ({b['median']})")
    # Pará: soma diária × linhas lidas pelo importador
    for f in files:
        d = store.daily("para", f["product_id"], start=f"{f['year']}-01-01", end=f"{f['year']}-12-31")
        expected = (f.get("rows_by_region") or {}).get("para")
        if expected is not None and int(d["n"].sum()) != int(expected):
            problems += 1
            print(f"[DIVERGE] Pará {f['product_id']} {f['year']}: agregados {int(d['n'].sum())} × importador {expected}")
    print("[ok] Pará: agregados diários conferem com as linhas recortadas pelo importador em todos os arquivos" if not problems else "")
    print(f"\n{'Nenhuma divergência.' if not problems else f'{problems} divergência(s).'}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(*(sys.argv[1:] or ["portel"])))
