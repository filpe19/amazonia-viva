"""Análise territorial e Ficha de Atenção Territorial.

O resumo é gerado por regras explícitas a partir dos dados (sem modelo de
linguagem). Os "sinais de atenção" são EXPERIMENTAIS: critérios e limiares são
escolhas declaradas para discussão, sem calibração nem validação operacional.

Toda afirmação recebe um tipo (`kind`):
* observacao — medida ou registro de satélite/censo/cadastro oficial;
* estimativa — valor modelado ou derivado (reanálise, estatística de linha de base);
* previsao — projeção futura (nenhuma integrada nesta versão);
* indicador_externo — produto operacional de outra instituição (Censipam), sem alteração;
* ausente — informação indisponível, com o motivo.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, time, timedelta

import numpy as np
import pandas as pd

from app.core.errors import AppError
from app.domain.regions import RegionRegistry
from app.science.aggregation import empirical_percentile
from app.services.detections_service import DetectionsService, product_summary
from app.services.history_service import HistoryService
from app.services.weather_service import WeatherService

ANOMALY_PERCENTILE = 90
PERSISTENCE_MIN_DAYS = 5
PERSISTENCE_CELL_DEG = 0.1
DRY_RATIO = 0.5

# Pares comparáveis: produto NRT atual × arquivo do MESMO instrumento/satélite.
COMPARISONS = [
    {"current": "MODIS_NRT", "baseline": "MODIS_SP", "label": "MODIS (Terra e Aqua)", "satellites_from_current": True},
    {"current": "VIIRS_NOAA20_NRT", "baseline": "VIIRS_NOAA20_SP", "label": "VIIRS NOAA-20", "satellites_from_current": False},
    # Experimental: NOAA-20 atual × série harmonizada (NOAA-20 observado + MODIS Aqua convertido). Informativa, não é critério.
    {"current": "VIIRS_NOAA20_NRT", "baseline": "HARMONIZED", "label": "Série harmonizada (experimental)", "satellites_from_current": False},
]

LIMITATIONS = [
    "Detecções de calor indicam pixels com anomalia térmica no momento da passagem do satélite; não equivalem a incêndios individuais nem a área queimada.",
    "Nuvens, fumaça densa, horário de passagem e geometria de visada reduzem ou impedem detecções; ausência de detecção não comprova ausência de fogo.",
    "MODIS (1 km) e VIIRS (375 m) têm sensibilidades diferentes; suas contagens não são somadas nem comparadas diretamente.",
    "Cada comparação histórica usa o mesmo instrumento nos dois lados (MODIS×MODIS, NOAA-20×NOAA-20); dados NRT e de processamento padrão podem diferir ligeiramente.",
    "As órbitas de Terra e Aqua derivaram nos últimos anos, alterando o horário de passagem e, portanto, as contagens esperadas.",
    "Variáveis meteorológicas vêm de reanálise em grade (NASA POWER), com latência de dias; não são medições locais.",
    "Nenhum modelo de propagação de fogo foi aplicado e nenhuma previsão está integrada.",
    "A população informada é o total censitário do território; não é uma estimativa de pessoas afetadas.",
]

HUMAN_REVIEW = [
    "Confirmar em campo ou com brigadas se as detecções correspondem a incêndio florestal, queima agrícola, limpeza de pasto ou outra fonte de calor.",
    "Verificar a nebulosidade nas passagens recentes: dias sem detecção podem ser dias sem observação.",
    "Conferir o status atual dos eventos no Painel do Fogo do Censipam antes de qualquer acionamento.",
    "Verificar se há comunidades, aldeias ou estruturas não mapeadas nas bases oficiais usadas aqui.",
    "Confirmar se o território está entre as áreas de emergência Nível II identificadas pela Cedec (Decreto estadual nº 5.782/2026).",
    "Avaliar condições locais de vento e chuva com observações de estação ou previsão oficial (não integradas nesta versão).",
]


FUTURE_LAYERS = [
    {"id": "infraestrutura_saude", "label": "Unidades de saúde", "status": "não integrado",
     "candidate_source": "CNES — API de dados abertos do Ministério da Saúde (com coordenadas; testada em 14/11/2026)"},
    {"id": "escolas", "label": "Escolas", "status": "não integrado", "candidate_source": "INEP — Catálogo de Escolas"},
    {"id": "comunidades", "label": "Comunidades e localidades", "status": "não integrado",
     "candidate_source": "IBGE — localidades do Censo 2022, com validação local"},
    {"id": "ucs_municipais", "label": "Unidades de conservação municipais", "status": "não integrado",
     "candidate_source": "MMA/CNUC (arquivo completo; o espelho consultado tem só UCs estaduais)"},
    {"id": "areas_interesse", "label": "Áreas de interesse do usuário", "status": "não integrado",
     "candidate_source": "Upload de GeoJSON validado"},
]


def _br_num(v: float | None, decimals: int = 1) -> str:
    """Número no padrão brasileiro; inteiros sem casas decimais (40.5 -> '40,5'; 40.0 -> '40')."""
    if v is None:
        return "—"
    if float(v).is_integer():
        return f"{int(v):,}".replace(",", ".")
    return f"{v:,.{decimals}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _br_date(iso: str | None) -> str:
    return f"{iso[8:10]}/{iso[5:7]}/{iso[0:4]}" if iso else "—"


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _complete_days_window(source_earliest: datetime | None, today: date, max_days: int = 7) -> int:
    """Maior n ≤ max_days tal que a fonte cobre integralmente os n dias UTC anteriores a hoje."""
    if source_earliest is None:
        return 0
    for n in range(max_days, 0, -1):
        if source_earliest <= datetime.combine(today - timedelta(days=n), time(0, 0), tzinfo=UTC):
            return n
    return 0


def persistent_cells(frame: pd.DataFrame, days: list[str], min_days: int = PERSISTENCE_MIN_DAYS,
                     cell_deg: float = PERSISTENCE_CELL_DEG) -> list[dict]:
    """Células de grade (canto SW) com ao menos uma detecção em ≥ `min_days` dos `days` informados.

    Presença diária por célula: contagens de satélites diferentes não são somadas.
    """
    if frame.empty or not days:
        return []
    f = frame[frame["acq_date"].isin(days)]
    if f.empty:
        return []
    la = np.floor(f["latitude"].to_numpy() / cell_deg) * cell_deg
    lo = np.floor(f["longitude"].to_numpy() / cell_deg) * cell_deg
    cells = pd.DataFrame({"lat": la.round(2), "lon": lo.round(2), "day": f["acq_date"].to_numpy()})
    per_cell = cells.groupby(["lat", "lon"])["day"].nunique().reset_index(name="days_with_detection")
    hits = per_cell[per_cell["days_with_detection"] >= min_days].sort_values("days_with_detection", ascending=False)
    return [{"cell_sw": [float(r.lon), float(r.lat)], "size_deg": cell_deg, "days_with_detection": int(r.days_with_detection)}
            for r in hits.itertuples()]


class TerritoryService:
    def __init__(self, detections: DetectionsService, history: HistoryService, weather: WeatherService,
                 regions: RegionRegistry, context=None, impact=None) -> None:
        self._det = detections
        self._hist = history
        self._wx = weather
        self._regions = regions
        self._ctx = context
        self._impact = impact

    # ------------------------------------------------------------------ comparação
    def _compare(self, region_id: str, spec: dict, result, today: date) -> dict:
        base = {"label": spec["label"], "product_current": spec["current"], "product_baseline": spec["baseline"],
                "kind": "estimativa"}
        if result is None or result.error is not None:
            return {**base, "available": False, "kind": "ausente",
                    "reason": "Produto NRT indisponível" if result is None else result.error.message}
        n_days = _complete_days_window(result.source_earliest, today)
        if n_days < 3:
            return {**base, "available": False, "kind": "ausente",
                    "reason": "Cobertura do arquivo NRT insuficiente (menos de 3 dias UTC completos)."}
        end_d, start_d = today - timedelta(days=1), today - timedelta(days=n_days)
        frame = result.frame
        cur = frame[(frame["acq_date"] >= start_d.isoformat()) & (frame["acq_date"] <= end_d.isoformat())] if not frame.empty else frame
        current = int(len(cur))
        sats = (sorted(frame["satellite_name"].unique().tolist()) if (spec["satellites_from_current"] and not frame.empty)
                else (["Terra", "Aqua"] if spec["satellites_from_current"] else None))
        try:
            if spec["baseline"] == "HARMONIZED":
                sw = self._hist.harmonized_same_window(region_id, start_d, end_d, exclude_year=today.year)
            else:
                sw = self._hist.same_window(region_id, spec["baseline"], start_d, end_d, satellites=sats, exclude_year=today.year)
        except AppError as exc:
            return {**base, "available": False, "kind": "ausente", "reason": exc.message, "detail": exc.detail}
        st = sw["stats"]
        pct = empirical_percentile(current, list(sw["totals_by_year"].values()))
        if spec["baseline"] == "HARMONIZED":
            base.update(experimental=True, units=sw.get("units"), origins=sw.get("origins"), ratio_source=sw.get("ratio_source"),
                        note="Atual: NOAA-20 observado. Anos anteriores: NOAA-20 observado (2021–2025) ou MODIS Aqua convertido "
                             "por razão sazonal (antes de 2021). Série experimental, não validada operacionalmente.")
        return {
            **base, "available": True, "satellites": sats, "period": [start_d.isoformat(), end_d.isoformat()],
            "n_days": n_days, "current_count": current, "current_kind": "observacao", "baseline": sw,
            "percentile": pct, "ratio_to_median": round(current / st["median"], 2) if st["median"] else None,
        }

    # ------------------------------------------------------------------ resumo
    async def brief(self, region_id: str, lat: float | None = None, lon: float | None = None) -> dict:
        region = self._regions.get(region_id)
        now = datetime.now(UTC)
        today = now.date()
        clon, clat = region.centroid
        wlat, wlon = (lat, lon) if (lat is not None and lon is not None) else (clat, clon)

        viirs_q, modis_q, wx = await asyncio.gather(
            self._det.query(region_id, "7d", "VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT", now=now),
            self._det.query(region_id, "7d", "MODIS_NRT", now=now),
            self._wx.context(wlat, wlon, days=30, today=today),
            return_exceptions=True,
        )
        for r in (viirs_q, modis_q, wx):
            if isinstance(r, BaseException) and not isinstance(r, AppError):
                raise r

        facts: list[dict] = []
        signals: list[dict] = []
        out: dict = {
            "region": region.summary(),
            "generated_at": _iso(now),
            "weather_point": {"lat": wlat, "lon": wlon,
                              "basis": "coordenada informada" if lat is not None else "centroide do limite IBGE"},
        }

        # ----------------------------------------------- detecções recentes (VIIRS)
        recent: dict = {"available": False, "kind": "ausente"}
        results_by_product = {}
        if not isinstance(viirs_q, BaseException):
            results_by_product.update({r.product.id: r for r in viirs_q.results})
            recent = {"available": True, "kind": "observacao", "window": "7d",
                      "products": [product_summary(r) for r in viirs_q.results]}
            usable = [r for r in viirs_q.results if not r.error and r.fetch is not None]
            n_days = min((_complete_days_window(r.source_earliest, today) for r in usable), default=0)
            days = [(today - timedelta(days=i)).isoformat() for i in range(n_days, 0, -1)]
            n7 = 0
            for r in usable:
                n7 += len(r.frame)
                if r.frame.empty:
                    continue
                facts.append({
                    "kind": "observacao",
                    "text": f"{r.product.platform} (VIIRS): {_br_num(len(r.frame))} detecções nos últimos 7 dias; "
                            f"última observação em {r.frame['acq_datetime_utc'].max():%d/%m/%Y %H:%M} UTC.",
                    "source": r.product.id,
                })
            if n7 == 0 and usable:
                facts.append({"kind": "observacao", "text": "Nenhuma detecção VIIRS NOAA-20/NOAA-21 nos últimos 7 dias no território.",
                              "source": "VIIRS NRT"})
            frames = [r.frame for r in usable if not r.frame.empty]
            vf = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=["acq_date", "latitude", "longitude"])
            cells = persistent_cells(vf, days)
            out["persistent_cells"] = cells
            signals.append({
                "id": "persistence_viirs",
                "label": "Atividade persistente (VIIRS NOAA-20/NOAA-21)",
                "rule": f"Ao menos uma célula de {PERSISTENCE_CELL_DEG}° (~11 km) com detecção VIIRS em ≥ {PERSISTENCE_MIN_DAYS} "
                        f"dos {n_days or 'N'} dias UTC completos mais recentes (presença diária; contagens dos satélites não são somadas).",
                "value": (f"{len(cells)} célula(s)" if n_days else None),
                "status": "unknown" if not n_days else ("met" if cells else "not_met"),
                "evidence": {"cells": cells[:20], "days": days},
                "uncertainty": "Nuvens e horário de passagem afetam quais dias registram detecções; a grade fixa pode dividir um mesmo foco.",
            })
        out["recent"] = recent

        # ------------------------------------------- comparações no mesmo instrumento
        if not isinstance(modis_q, BaseException):
            results_by_product.update({r.product.id: r for r in modis_q.results})
        # Consultas ao arquivo histórico (SQLite/Parquet) em threads: não bloqueiam o laço de eventos da API.
        comparisons = list(await asyncio.gather(*(asyncio.to_thread(self._compare, region_id, spec, results_by_product.get(spec["current"]), today)
                                                  for spec in COMPARISONS)))
        out["comparisons"] = comparisons
        out["historical_comparison"] = comparisons[0]  # compatibilidade com a versão anterior da interface
        for comp in comparisons:
            if comp["product_baseline"] == "HARMONIZED":
                if comp.get("available"):
                    st = comp["baseline"]["stats"]
                    facts.append({
                        "kind": "estimativa",
                        "text": (f"Série harmonizada experimental (equivalente NOAA-20), mesmo período em {st['n_years']} anos "
                                 f"({min(st['years'])}–{max(st['years'])}): mediana {_br_num(round(st['median'], 1))}; "
                                 f"atual {_br_num(comp['current_count'])} (posição: "
                                 f"{'acima de todos' if (comp.get('percentile') or 0) >= 100 else 'percentil ' + str(round(comp.get('percentile') or 0))})."),
                        "source": "VIIRS_NOAA20_NRT × (VIIRS_NOAA20_SP + MODIS Aqua convertido)",
                    })
                continue
            if comp.get("available"):
                st = comp["baseline"]["stats"]
                facts.append({
                    "kind": "estimativa",
                    "text": (f"{comp['label']}, {_br_date(comp['period'][0])[:5]} a {_br_date(comp['period'][1])[:5]}: "
                             f"{_br_num(comp['current_count'])} detecções. Mediana do mesmo período em {st['n_years']} anos "
                             f"({min(st['years'])}–{max(st['years'])}): {_br_num(st['median'])}."),
                    "source": f"{comp['product_current']} × {comp['product_baseline']}",
                })
            pct = comp.get("percentile")
            n_years = (comp.get("baseline") or {}).get("stats", {}).get("n_years")
            signals.append({
                "id": f"anomaly_{comp['product_baseline']}",
                "label": f"Atividade acima do usual para o período ({comp['label']})",
                "rule": f"Contagem da janela ≥ percentil {ANOMALY_PERCENTILE} do mesmo período nos anos anteriores, mesmo instrumento",
                "value": None if pct is None else (f"acima de todos os {n_years} anos" if pct == 100 else f"percentil {pct:.0f}"),
                "status": "unknown" if pct is None else ("met" if pct >= ANOMALY_PERCENTILE else "not_met"),
                "evidence": ({"atual": comp.get("current_count"), **{str(k): v for k, v in comp["baseline"]["totals_by_year"].items()}}
                             if comp.get("available") else {"motivo": comp.get("reason")}),
                "uncertainty": (f"Baseado em {n_years} anos; exige ≥ 5." if n_years else "Linha de base indisponível.")
                + (" Deriva orbital Terra/Aqua não corrigida." if comp["product_baseline"] == "MODIS_SP" else ""),
            })

        # ------------------------------------------------------------ meteorologia
        if isinstance(wx, BaseException):
            out["weather"] = {"available": False, "kind": "ausente", "reason": wx.message}
            signals.append({"id": "dryness", "label": "Chuva abaixo da climatologia (14 dias)", "rule": "", "value": None,
                            "status": "unknown", "evidence": {}, "uncertainty": "NASA POWER indisponível."})
        else:
            out["weather"] = wx
            comp = (wx.get("historical") or {}).get("precip_vs_climatology", {}).get("last_14d")
            rec = wx.get("recent_analysis") or {}
            if comp and comp.get("ratio") is not None:
                facts.append({
                    "kind": "estimativa",
                    "text": f"Chuva nos 14 dias até {_br_date(rec.get('last_available_date'))}: {_br_num(comp['observed_mm'])} mm "
                            f"(climatologia 2001–2025 para o período: {_br_num(comp['climatology_expected_mm'])} mm).",
                    "source": "NASA POWER (reanálise)",
                })
            if region.definition.level in ("pais", "bioma"):
                facts.append({"kind": "ausente", "text": "Para o Brasil inteiro, um único ponto meteorológico não é representativo.",
                              "source": "metodologia"})
            signals.append({
                "id": "dryness",
                "label": "Chuva abaixo da climatologia (14 dias)",
                "rule": f"Precipitação acumulada < {int(DRY_RATIO * 100)}% do esperado pela climatologia NASA POWER 2001–2025",
                "value": f"{comp['ratio'] * 100:.0f}% do esperado" if comp and comp.get("ratio") is not None else None,
                "status": "unknown" if not comp or comp.get("ratio") is None else ("met" if comp["ratio"] < DRY_RATIO else "not_met"),
                "evidence": comp or {},
                "uncertainty": "Reanálise em grade de ~50 km em um único ponto; precipitação convectiva é muito heterogênea.",
            })

        met = sum(1 for s in signals if s["status"] == "met")
        known = sum(1 for s in signals if s["status"] in ("met", "not_met"))
        level = "sem_sinais" if met == 0 else ("observar" if met == 1 else "examinar")
        out["attention"] = {
            "experimental": True,
            "validated": False,
            "disclaimer": "Classificação experimental para triagem e discussão. Critérios e limiares não foram calibrados "
                          "nem validados operacionalmente. Não indica risco, causa ou propagação de fogo.",
            "level": level,
            "level_rule": "nenhum sinal atendido: sem sinais; 1 sinal: observar; 2 ou mais: examinar com prioridade",
            "signals_met": met,
            "signals_evaluated": known,
            "signals_total": len(signals),
            "signals_not_applicable": sum(1 for s in signals if s["status"] == "not_applicable"),
            "signals": signals,
        }
        out["facts"] = facts
        out["limitations"] = LIMITATIONS
        out["future_layers"] = FUTURE_LAYERS
        out["forecast"] = {"available": False, "kind": "ausente",
                           "note": "Nenhuma previsão meteorológica ou de comportamento do fogo está integrada nesta versão."}
        out["_viirs_frame"] = vf if not isinstance(viirs_q, BaseException) else None
        return out

    # ------------------------------------------------------------------ ficha
    async def ficha(self, region_id: str) -> dict:
        brief = await self.brief(region_id)
        vf = brief.pop("_viirs_frame", None)
        if vf is not None and not vf.empty and "product_id" not in vf:
            vf = vf.assign(product_id="VIIRS")
        ctx_task = self._ctx.context(region_id, vf) if self._ctx else None
        imp_task = self._impact.impact(region_id) if self._impact else None
        results = await asyncio.gather(*(t for t in (ctx_task, imp_task) if t is not None), return_exceptions=True)
        context = results[0] if ctx_task is not None else {"available": False}
        impact = (results[1] if ctx_task is not None else results[0]) if imp_task is not None else {"available": False}
        if isinstance(context, BaseException):
            if not isinstance(context, AppError):
                raise context
            context = {"available": False, "reason": context.message}
        if isinstance(impact, BaseException):
            if not isinstance(impact, AppError):
                raise impact
            impact = {"available": False, "kind": "ausente", "reason": impact.message}
        cz = context.get("censipam", {}) if isinstance(context, dict) else {}
        pop = context.get("population", {}) if isinstance(context, dict) else {}
        layers = context.get("layers", {}) if isinstance(context, dict) else {}

        # Fatos adicionais do contexto verificado
        if pop.get("available"):
            brief["facts"].append({
                "kind": "observacao",
                "text": f"População residente no território: {_br_num(pop['population'])} pessoas (Censo 2022); "
                        f"densidade {_br_num(pop['density_per_km2'])} hab./km². Total do território, não pessoas afetadas.",
                "source": "IBGE Censo 2022",
            })
        for layer in layers.get("layers", []) if layers.get("available") else []:
            if layer.get("available") and layer.get("items"):
                total = sum(i["area_in_territory_km2"] for i in layer["items"])
                dets = sum(sum((i.get("detections_7d_by_product") or {}).values()) for i in layer["items"])
                brief["facts"].append({
                    "kind": "observacao",
                    "text": f"{layer['label']} com sobreposição ao território: {len(layer['items'])} "
                            f"({_br_num(round(total, 1))} km² dentro do município); {_br_num(dets)} detecções VIIRS "
                            f"dos últimos 7 dias nessas áreas.",
                    "source": f"{layer['primary_source']} via Censipam",
                })
        if impact.get("available"):
            loc, hl, ex = impact.get("localities", {}), impact.get("health", {}), impact.get("exposure", {})
            if loc.get("available"):
                brief["facts"].append({"kind": "estimativa", "source": "IBGE BC250 2025 × VIIRS 7 dias",
                                       "text": f"Localidades mapeadas pelo IBGE no território: {loc['count']}; com detecção VIIRS a até 5 km "
                                               f"nos últimos 7 dias: {loc['within_5km']}. Proximidade, não dano."})
            if hl.get("available"):
                brief["facts"].append({"kind": "estimativa", "source": "CNES × VIIRS 7 dias",
                                       "text": f"Unidades de saúde com coordenadas no CNES: {hl['count_with_coordinates']} "
                                               f"(de {hl['count_registered']} cadastradas); com detecção a até 5 km: {hl['within_5km']}."})
            if ex.get("available") and ex.get("population_total"):
                brief["facts"].append({"kind": "estimativa", "source": "IBGE Censo 2022 (setores) × VIIRS 7 dias",
                                       "text": f"Exposição potencial (limite superior): até {_br_num(ex['population_upper_bound'])} pessoas "
                                               f"({_br_num(ex.get('population_upper_bound_share_pct'))}% da população) vivem em setores "
                                               f"censitários a até {ex['radius_km']} km de detecções. Não são pessoas afetadas."})
        if cz.get("available"):
            brief["facts"].append({
                "kind": "indicador_externo",
                "text": f"Censipam: {cz['count']} eventos de fogo intersectam o território "
                        f"({', '.join(f'{v} {k.lower()}' for k, v in cz['by_status'].items()) or 'sem eventos'}).",
                "source": "Censipam — Painel do Fogo",
            })

        sections = [  # mantidas para compatibilidade; a interface usa `questions`
            {"id": "detectado", "title": "O que foi detectado", "kind": "observacao"},
            {"id": "comparacao", "title": "Comparação com os anos anteriores", "kind": "estimativa"},
            {"id": "ambiente", "title": "Condições ambientais", "kind": "estimativa"},
            {"id": "territorio", "title": "Território", "kind": "observacao"},
            {"id": "censipam", "title": "Eventos de fogo do Censipam", "kind": "indicador_externo"},
            {"id": "atencao", "title": "Por que merece atenção", "kind": "estimativa"},
            {"id": "avaliacao_humana", "title": "O que precisa de avaliação humana", "kind": "ausente"},
            {"id": "fontes", "title": "Fontes e evidências", "kind": "observacao"},
        ]
        return {
            "ficha_version": "1.0",
            "title": f"Ficha de Atenção Territorial — {brief['region']['name']}",
            "generated_at": brief["generated_at"],
            "region": brief["region"],
            "kinds": {
                "observacao": "Observação: registro de satélite, censo ou cadastro oficial.",
                "estimativa": "Estimativa: valor de reanálise ou estatística derivada.",
                "previsao": "Previsão: projeção futura (nenhuma integrada nesta versão).",
                "indicador_externo": "Indicador externo: produto operacional de outra instituição, sem alteração.",
                "ausente": "Ausente: informação indisponível ou que exige verificação.",
            },
            "sections": sections,
            "brief": brief,
            "context": context,
            "impact": impact,
            "questions": [
                {"id": "detectado", "question": "O que foi detectado?"},
                {"id": "quando", "question": "Quando ocorreu?"},
                {"id": "incomum", "question": "O comportamento é incomum?"},
                {"id": "ambiente", "question": "Quais condições ambientais estavam presentes?"},
                {"id": "proximos", "question": "Quais territórios habitados ou protegidos estão próximos?"},
                {"id": "verificar", "question": "Que informações precisam ser verificadas?"},
                {"id": "fontes", "question": "Quais são as fontes e limitações?"},
            ],
            "human_review": HUMAN_REVIEW,
            "decrees": [
                {"id": "5.767/2026", "date": "2026-11-11", "summary": "Emergência ambiental e climática em todo o Pará, por 120 dias.",
                 "verification": "Noticiado por veículos de imprensa; texto oficial no Diário Oficial do Estado a conferir."},
                {"id": "5.782/2026", "date": "2026-11-13", "summary": "Emergência de Nível II nas áreas atingidas por incêndios, por 180 dias.",
                 "verification": "Noticiado; lista de áreas da Cedec não localizada. A ficha não indica se o território está incluído."},
            ],
            "limitations": LIMITATIONS,
        }
