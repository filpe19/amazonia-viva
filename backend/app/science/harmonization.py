"""Comparação MODIS × VIIRS no período de sobreposição (etapa exploratória).

Este módulo NÃO produz uma série harmonizada. Ele mede, para os meses em que os
dois sensores operaram simultaneamente, quão relacionadas são as contagens —
insumo para decidir se e como uma fusão pode ser validada estatisticamente.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

MIN_MONTHS_FOR_CORRELATION = 6


def _spearman(a: np.ndarray, b: np.ndarray) -> float | None:
    if len(a) < MIN_MONTHS_FOR_CORRELATION:
        return None
    ra = pd.Series(a).rank().to_numpy()
    rb = pd.Series(b).rank().to_numpy()
    if np.std(ra) == 0 or np.std(rb) == 0:
        return None
    return float(np.corrcoef(ra, rb)[0, 1])


def _pearson_log(a: np.ndarray, b: np.ndarray) -> float | None:
    if len(a) < MIN_MONTHS_FOR_CORRELATION:
        return None
    la, lb = np.log1p(a), np.log1p(b)
    if np.std(la) == 0 or np.std(lb) == 0:
        return None
    return float(np.corrcoef(la, lb)[0, 1])


def overlap_comparison(monthly_ref: pd.DataFrame, monthly_other: pd.DataFrame, value: str = "n") -> dict:
    """Compara séries mensais de dois produtos (ex.: MODIS Aqua × VIIRS S-NPP).

    Retorna os meses pareados, a razão outro/ref por mês (quando ref > 0) e
    medidas de associação. Meses ausentes em um dos produtos ficam fora do
    pareamento e são listados na auditoria de cobertura.
    """
    a = monthly_ref.set_index("year_month")[value]
    b = monthly_other.set_index("year_month")[value]
    common = sorted(set(a.index) & set(b.index))
    only_ref = sorted(set(a.index) - set(b.index))
    only_other = sorted(set(b.index) - set(a.index))
    rows = []
    for ym in common:
        ra, rb = float(a[ym]), float(b[ym])
        rows.append({"year_month": ym, "ref": ra, "other": rb, "ratio": (rb / ra) if ra > 0 else None})
    va = np.array([r["ref"] for r in rows])
    vb = np.array([r["other"] for r in rows])
    ratios = np.array([r["ratio"] for r in rows if r["ratio"] is not None], dtype=float)
    # Razão agregada só em meses com atividade relevante nos dois (evita razões instáveis de 1/0, 3/1...).
    active = [r for r in rows if r["ref"] >= 30 and r["other"] >= 30]
    act_ratios = np.array([r["other"] / r["ref"] for r in active], dtype=float)
    return {
        "months_paired": len(rows),
        "months_only_ref": only_ref,
        "months_only_other": only_other,
        "spearman_rho": _spearman(va, vb),
        "pearson_r_log1p": _pearson_log(va, vb),
        "ratio_median_all": float(np.median(ratios)) if len(ratios) else None,
        "ratio_median_active_months": float(np.median(act_ratios)) if len(act_ratios) else None,
        "ratio_iqr_active_months": (
            [float(np.percentile(act_ratios, 25)), float(np.percentile(act_ratios, 75))] if len(act_ratios) >= 4 else None
        ),
        "active_months_threshold": 30,
        "n_active_months": len(active),
        "series": rows,
    }


MIN_CELLS_FOR_AGREEMENT = 8


def spatial_agreement(cells_ref: pd.DataFrame, cells_other: pd.DataFrame, grid_deg: float = 0.5) -> dict:
    """Concordância espacial em grade comum (mesmo mês, mesmas células).

    cells_*: colunas year_month, cell_id, n. Calcula, por mês, a fração de
    células ativas em ambos os sensores (índice de Jaccard) e a correlação de
    Spearman entre contagens por célula.
    """
    out = []
    months = sorted(set(cells_ref["year_month"]) & set(cells_other["year_month"]))
    for ym in months:
        a = cells_ref[cells_ref["year_month"] == ym].set_index("cell_id")["n"]
        b = cells_other[cells_other["year_month"] == ym].set_index("cell_id")["n"]
        union = sorted(set(a.index) | set(b.index))
        both = set(a.index) & set(b.index)
        va = a.reindex(union, fill_value=0).to_numpy(dtype=float)
        vb = b.reindex(union, fill_value=0).to_numpy(dtype=float)
        out.append({
            "year_month": ym,
            "cells_ref": int(len(a)),
            "cells_other": int(len(b)),
            "jaccard": (len(both) / len(union)) if union else None,
            "spearman_cells": _spearman(va, vb) if len(union) >= MIN_MONTHS_FOR_CORRELATION else None,
            "reliable": len(union) >= MIN_CELLS_FOR_AGREEMENT,
        })
    reliable = [m["jaccard"] for m in out if m["reliable"] and m["jaccard"] is not None]
    return {
        "grid_deg": grid_deg,
        "min_cells_for_reliable": MIN_CELLS_FOR_AGREEMENT,
        "jaccard_median_reliable": float(np.median(reliable)) if reliable else None,
        "months": out,
    }


# ----------------------------------------------------------------------------
# Experimento de agregação comum e validação "deixa um ano de fora" (Missão 03)
# ----------------------------------------------------------------------------
ACTIVE_MIN = 30  # meses com menos detecções produzem razões instáveis


def _paired(monthly_ref: pd.DataFrame, monthly_other: pd.DataFrame, value: str = "n") -> pd.DataFrame:
    a = monthly_ref.set_index("year_month")[value].rename("ref")
    b = monthly_other.set_index("year_month")[value].rename("other")
    df = pd.concat([a, b], axis=1).dropna().reset_index().rename(columns={"index": "year_month"})
    df["year"] = df["year_month"].str.slice(0, 4).astype(int)
    df["month"] = df["year_month"].str.slice(5, 7).astype(int)
    return df.sort_values("year_month").reset_index(drop=True)


def normalized_series(monthly_ref: pd.DataFrame, monthly_other: pd.DataFrame) -> dict:
    """Cada série dividida pela própria média no período comum (índice adimensional, média = 1).

    Permite ver as duas séries na mesma escala SEM somar nem converter contagens:
    o índice mede só a variação relativa de cada sensor em torno do próprio nível.
    """
    df = _paired(monthly_ref, monthly_other)
    if df.empty:
        return {"months": [], "ref_mean": None, "other_mean": None}
    mr, mo = float(df["ref"].mean()), float(df["other"].mean())
    rows = [{"year_month": r.year_month,
             "ref_index": (r.ref / mr) if mr else None,
             "other_index": (r.other / mo) if mo else None} for r in df.itertuples()]
    diffs = [abs(x["ref_index"] - x["other_index"]) for x in rows if x["ref_index"] is not None and x["other_index"] is not None]
    return {"months": rows, "ref_mean": mr, "other_mean": mo,
            "median_abs_index_difference": float(np.median(diffs)) if diffs else None}


def leave_one_year_out(monthly_ref: pd.DataFrame, monthly_other: pd.DataFrame) -> dict:
    """Valida, ano a ano, a hipótese de converter MODIS em VIIRS por uma razão.

    Para cada ano de teste, a razão é estimada só com os demais anos e usada para prever
    a contagem VIIRS a partir da MODIS. Dois modelos: razão constante e razão por mês do ano.
    Métrica: erro percentual absoluto (EPA) nos meses ativos (≥ 30 detecções nos dois sensores).
    """
    df = _paired(monthly_ref, monthly_other)
    years = sorted(df["year"].unique().tolist())
    if len(years) < 3:
        return {"available": False, "reason": "São necessários ao menos 3 anos de sobreposição.", "years": years}
    df["active"] = (df["ref"] >= ACTIVE_MIN) & (df["other"] >= ACTIVE_MIN)
    df["ratio"] = np.where(df["ref"] > 0, df["other"] / df["ref"].where(df["ref"] > 0, 1), np.nan)
    per_year, all_err = [], {"constante": [], "sazonal": []}
    for y in years:
        train = df[(df["year"] != y) & df["active"]]
        test = df[(df["year"] == y) & df["active"]]
        if train.empty or test.empty:
            per_year.append({"year": y, "n_test_months": int(len(test)), "constante": None, "sazonal": None})
            continue
        r_const = float(train["ratio"].median())
        by_month = train.groupby("month")["ratio"].median()
        errs = {"constante": [], "sazonal": []}
        for t in test.itertuples():
            pred_c = r_const * t.ref
            r_m = float(by_month.get(t.month, r_const))
            pred_s = r_m * t.ref
            errs["constante"].append(abs(pred_c - t.other) / t.other)
            errs["sazonal"].append(abs(pred_s - t.other) / t.other)
        for k in errs:
            all_err[k] += errs[k]
        per_year.append({
            "year": y, "n_test_months": int(len(test)), "ratio_constante_treino": round(r_const, 3),
            "constante": {"median_ape": float(np.median(errs["constante"])), "max_ape": float(np.max(errs["constante"]))},
            "sazonal": {"median_ape": float(np.median(errs["sazonal"])), "max_ape": float(np.max(errs["sazonal"]))},
        })
    summary = {k: ({"median_ape": float(np.median(v)), "p90_ape": float(np.percentile(v, 90)), "n_months": len(v)} if v else None)
               for k, v in all_err.items()}
    return {
        "available": True,
        "years": years,
        "active_min": ACTIVE_MIN,
        "per_year": per_year,
        "summary": summary,
        "interpretation": "Erros de previsão fora da amostra medem o quanto uma conversão por razão falharia em um ano novo. "
                          "Eles são evidência para decidir sobre uma fusão; não constituem validação de uma série harmonizada.",
    }


ROBUST_Z_MIN = 1.5
MIN_ABS_DIFF = 10  # diferenças menores que 10 detecções são ruído de contagens pequenas


def detect_anomalies(monthly: pd.DataFrame, min_years: int = 5) -> list[dict]:
    """Meses incomuns frente aos MESMOS meses dos outros anos do mesmo produto.

    Para cada (ano, mês): percentil empírico (meio peso para empates) e z robusto
    (n − mediana) / (1,4826 × MAD). Marca 'acima' quando percentil ≥ 90 E z ≥ 1,5, ou
    'abaixo' quando percentil ≤ 10 E z ≤ −1,5 — exigir as duas condições evita marcar,
    em todo mês, o ano máximo e o mínimo apenas por serem extremos de uma amostra pequena.
    Só avalia com ≥ `min_years` anos de comparação.
    """
    out = []
    if monthly.empty:
        return out
    for m, grp in monthly.groupby("month"):
        for r in grp.itertuples():
            others = grp[grp["year"] != r.year]["n"].to_numpy(dtype=float)
            if len(others) < min_years:
                continue
            below = np.sum(others < r.n)
            ties = np.sum(others == r.n)
            pct = 100.0 * (below + 0.5 * ties) / len(others)
            med = float(np.median(others))
            mad = float(np.median(np.abs(others - med)))
            rz = (r.n - med) / (1.4826 * mad) if mad > 0 else None
            strong = ((abs(rz) >= ROBUST_Z_MIN) if rz is not None else (r.n != med)) and abs(r.n - med) >= MIN_ABS_DIFF
            flag = "acima" if (pct >= 90 and strong and r.n > med) else ("abaixo" if (pct <= 10 and strong and r.n < med) else None)
            if flag and not (flag == "abaixo" and med == 0):
                out.append({"year_month": r.year_month, "year": int(r.year), "month": int(m), "n": int(r.n),
                            "median_other_years": med, "percentile": round(pct, 1),
                            "robust_z": round(rz, 2) if rz is not None else None, "direction": flag,
                            "n_years_compared": int(len(others))})
    return sorted(out, key=lambda x: x["year_month"])


# ----------------------------------------------------------------------------
# Série harmonizada EXPERIMENTAL (Missão 04) — unidades "equivalente VIIRS NOAA-20"
# ----------------------------------------------------------------------------
RATIO_MIN_COUNT = 10        # meses com menos de 10 detecções em qualquer sensor não estimam razão
RATIO_MIN_YEARS = 3         # razão mensal só com ≥ 3 anos válidos; senão usa a razão geral


def seasonal_ratios(paired: pd.DataFrame) -> dict:
    """Razão VIIRS/MODIS por mês do ano no período de sobreposição, com faixa P10–P90.

    `paired`: colunas year_month, year, month, ref (MODIS), other (VIIRS).
    Meses com poucos anos válidos herdam a razão geral (meses ativos) e sua faixa.
    """
    valid = paired[(paired["ref"] >= RATIO_MIN_COUNT) & (paired["other"] >= RATIO_MIN_COUNT)].copy()
    valid["ratio"] = valid["other"] / valid["ref"]
    active = valid[(valid["ref"] >= ACTIVE_MIN) & (valid["other"] >= ACTIVE_MIN)]
    base = active if len(active) >= 6 else valid
    if base.empty:
        return {"available": False, "reason": "Sobreposição sem meses com atividade suficiente para estimar razões."}
    g_med = float(base["ratio"].median())
    g_lo, g_hi = float(base["ratio"].quantile(0.10)), float(base["ratio"].quantile(0.90))
    months = {}
    for m in range(1, 13):
        r = valid[valid["month"] == m]["ratio"]
        if len(r) >= RATIO_MIN_YEARS:
            months[m] = {"ratio": float(r.median()), "p10": float(r.quantile(0.10)), "p90": float(r.quantile(0.90)),
                         "n_years": int(len(r)), "source": "mês do ano"}
        else:
            months[m] = {"ratio": g_med, "p10": g_lo, "p90": g_hi, "n_years": int(len(r)), "source": "razão geral (poucos anos no mês)"}
    return {"available": True, "global": {"ratio": g_med, "p10": g_lo, "p90": g_hi, "n_months": int(len(base))}, "by_month": months}


def harmonize_monthly(modis_monthly: pd.DataFrame, viirs_monthly: pd.DataFrame, ratios: dict,
                      viirs_years: list[int], modis_years: list[int]) -> list[dict]:
    """Monta a série mensal harmonizada em unidades equivalentes ao VIIRS NOAA-20.

    * Anos com arquivo VIIRS: valor observado (origem 'observado_viirs').
    * Anos só com MODIS (Aqua): MODIS × razão do mês; faixa = MODIS × [P10, P90] (origem 'convertido_modis').
    * Sem dado em nenhum sensor: valor nulo (origem 'sem_dado').
    """
    mm = modis_monthly.set_index("year_month")["n"] if not modis_monthly.empty else pd.Series(dtype=float)
    vv = viirs_monthly.set_index("year_month")["n"] if not viirs_monthly.empty else pd.Series(dtype=float)
    years = sorted(set(viirs_years) | set(modis_years))
    rows = []
    for y in years:
        for m in range(1, 13):
            ym = f"{y}-{m:02d}"
            if y in viirs_years:
                v = float(vv.get(ym, 0.0))
                rows.append({"year_month": ym, "year": y, "month": m, "value": v, "low": v, "high": v,
                             "origin": "observado_viirs", "modis_n": float(mm.get(ym, 0.0)) if y in modis_years else None, "viirs_n": v})
            elif y in modis_years and ratios.get("available"):
                n = float(mm.get(ym, 0.0))
                r = ratios["by_month"][m]
                rows.append({"year_month": ym, "year": y, "month": m, "value": n * r["ratio"], "low": n * r["p10"], "high": n * r["p90"],
                             "origin": "convertido_modis", "modis_n": n, "viirs_n": None})
            else:
                rows.append({"year_month": ym, "year": y, "month": m, "value": None, "low": None, "high": None,
                             "origin": "sem_dado", "modis_n": None, "viirs_n": None})
    return rows
