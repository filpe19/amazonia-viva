"""Contexto territorial verificado: territórios sobrepostos, população censitária e eventos Censipam.

Regras:
* Só geometrias oficiais (FUNAI, MMA/CNUC, INCRA via GeoServer do Censipam; IBGE).
* População é dado censitário (Censo 2022) do território inteiro. A plataforma
  **não** estima pessoas afetadas a partir da proximidade de detecções.
* Eventos e índice de prioridade do Censipam são informação externa, exibida sem
  alteração e sem entrar nos critérios da plataforma.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

import pandas as pd
import shapely
from shapely.geometry import mapping, shape

from app.core.errors import AppError
from app.domain.regions import Region, RegionRegistry, geodesic_area_km2
from app.integrations.censipam import API_DOCS, LAYERS, WFS_BASE, CensipamClient, LayerDef
from app.integrations.ibge import IbgeClient

log = logging.getLogger("app.territory_context")

UF_BY_PARENT = {"para": "PA"}
CENSIPAM_INDEX_NOTE = (
    "Índice de Prioridade para Acionamento: indicador operacional do Censipam para apoiar o acionamento de brigadas. "
    "A fórmula e os pesos não estão publicados em formato verificável (o FAQ lista componentes como área, FRP, tempo, "
    "velocidade, variação de área e número de focos). Exibido sem alteração; não entra nos critérios desta plataforma."
)
EVENT_FIELDS = ("id_evento", "status_evento", "dt_minima", "dt_maxima", "dt_ultima_visao", "persistencia_dias",
                "dominio", "terra_indigena", "unidade_conservacao", "quilombola", "projeto_assentamento", "municipio")


def _iso_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _dedupe_names(value: str | None, limit: int = 6) -> list[str]:
    if not value:
        return []
    seen: list[str] = []
    for part in (p.strip() for p in str(value).split(",")):
        if part and part not in seen:
            seen.append(part)
    return seen[:limit]


def overlay_layer(region: Region, layer: LayerDef, features: list[dict], detections: pd.DataFrame | None) -> list[dict]:
    """Interseção de cada feição oficial com o território, com área geodésica e detecções dentro."""
    out = []
    region_area = region.area_km2
    for f in features:
        try:
            geom = shapely.make_valid(shape(f["geometry"]))
        except Exception:  # noqa: BLE001 - geometria inválida da fonte: registra e segue
            log.warning("geometria inválida", extra={"layer": layer.id})
            continue
        if not geom.intersects(region.geometry):
            continue
        inter = geom.intersection(region.geometry)
        if inter.is_empty:
            continue
        inter_km2 = geodesic_area_km2(inter)
        if inter_km2 < 0.01:  # toque só na borda
            continue
        props = f.get("properties", {})
        item = {
            "name": props.get(layer.name_field) or "(sem nome na fonte)",
            "attributes": {layer.attr_labels.get(a, a): props.get(a) for a in layer.attrs if props.get(a) not in (None, "")},
            "area_in_territory_km2": round(inter_km2, 1),
            "share_of_territory_pct": round(100 * inter_km2 / region_area, 1) if region_area else None,
            "share_of_feature_inside_pct": round(100 * inter_km2 / geodesic_area_km2(geom), 1),
            "geometry": mapping(shapely.simplify(inter, 0.002, preserve_topology=True)),
        }
        if detections is not None and not detections.empty:
            shapely.prepare(inter)
            inside = shapely.contains_xy(inter, detections["longitude"].to_numpy(), detections["latitude"].to_numpy())
            sub = detections[inside]
            item["detections_7d_by_product"] = {k: int(v) for k, v in sub["product_id"].value_counts().items()}
        out.append(item)
    return sorted(out, key=lambda x: -x["area_in_territory_km2"])


class TerritoryContextService:
    def __init__(self, censipam: CensipamClient, ibge: IbgeClient, regions: RegionRegistry) -> None:
        self._censipam = censipam
        self._ibge = ibge
        self._regions = regions

    async def context(self, region_id: str, detections: pd.DataFrame | None = None) -> dict:
        region = self._regions.get(region_id)
        layers_res, pop_res, events_res = await asyncio.gather(
            self._layers(region, detections), self._population(region), self._events(region), return_exceptions=True,
        )
        for r in (layers_res, pop_res, events_res):
            if isinstance(r, BaseException) and not isinstance(r, AppError):
                raise r
        return {
            "region": region.summary(),
            "generated_at": _iso_now(),
            "layers": layers_res if not isinstance(layers_res, BaseException) else
            {"available": False, "reason": layers_res.message},
            "population": pop_res if not isinstance(pop_res, BaseException) else
            {"available": False, "kind": "ausente", "reason": pop_res.message},
            "censipam": events_res if not isinstance(events_res, BaseException) else
            {"available": False, "kind": "ausente", "reason": events_res.message, "source": "Censipam — Painel do Fogo"},
        }

    # ------------------------------------------------------------- camadas
    async def _layers(self, region: Region, detections: pd.DataFrame | None) -> dict:
        if region.definition.level in ("pais", "bioma"):
            return {"available": False, "kind": "ausente",
                    "reason": "Camadas territoriais são calculadas para estados e municípios."}
        results = await asyncio.gather(*(self._censipam.layer_bbox(layer, region.bbox) for layer in LAYERS.values()),
                                       return_exceptions=True)
        out = []
        for layer, res in zip(LAYERS.values(), results, strict=True):
            base = {"id": layer.id, "label": layer.label, "primary_source": layer.primary_source,
                    "served_by": "GeoServer Panorama (Censipam)", "kind": "observacao"}
            if isinstance(res, AppError):
                out.append({**base, "available": False, "kind": "ausente", "reason": res.message, "items": []})
                continue
            if isinstance(res, BaseException):
                raise res
            feats = (res.data or {}).get("features", []) if isinstance(res.data, dict) else []
            items = overlay_layer(region, layer, feats, detections) if region.definition.level != "estado" else []
            out.append({
                **base, "available": True, "items": items, "count": len(items),
                "note": None if region.definition.level != "estado" else "Lista detalhada disponível por município.",
                "provenance": {"url": res.url, "fetched_at": res.fetched_at.isoformat(timespec="seconds"),
                               "cache_hit": res.cache_hit, "stale": res.stale, "warnings": res.warnings,
                               "features_in_bbox": len(feats)},
            })
        return {
            "available": True,
            "kind": "observacao",
            "layers": out,
            "method": "Interseção das geometrias oficiais com o limite IBGE; área geodésica (WGS84); "
                      "detecções VIIRS dos últimos 7 dias contadas dentro de cada interseção.",
            "gaps": ["Unidades de conservação municipais não estão nas camadas consultadas.",
                     "Comunidades e localidades não cadastradas em bases oficiais não aparecem aqui."],
            "wfs": WFS_BASE,
        }

    # ------------------------------------------------------------ população
    async def _population(self, region: Region) -> dict:
        res = await self._ibge.census_2022(region.definition.level, region.definition.ibge_code)
        return {
            "available": res.get("population") is not None,
            "kind": "observacao",
            "label": "População residente no território (Censo Demográfico 2022)",
            "population": res.get("population"),
            "area_km2_official": res.get("area_km2"),
            "density_per_km2": res.get("density_per_km2"),
            "reference_date": "2022-07-31",
            "source": "IBGE — Censo Demográfico 2022, tabela SIDRA 4714",
            "url": res.get("url"),
            "fetched_at": res.get("fetched_at"),
            "caveat": "Total do território inteiro. Não representa pessoas expostas ou afetadas por fogo; "
                      "a plataforma não estima pessoas afetadas a partir da proximidade de detecções.",
        }

    # ------------------------------------------------------------- Censipam
    async def _events(self, region: Region) -> dict:
        uf = region.uf
        if not uf:
            return {"available": False, "kind": "ausente", "reason": "Eventos do Censipam são consultados por estado (Pará).",
                    "source": "Censipam — Painel do Fogo"}
        ev_res, pr_res = await asyncio.gather(self._censipam.events_by_state(uf), self._censipam.priorities_bbox(region.bbox),
                                              return_exceptions=True)
        if isinstance(ev_res, BaseException):
            raise ev_res
        prio: dict[int, dict] = {}
        prio_error = None
        if isinstance(pr_res, AppError):
            prio_error = pr_res.message
        elif isinstance(pr_res, BaseException):
            raise pr_res
        else:
            for p in pr_res.data or []:
                prio[int(p["id_evento"])] = p
        events = []
        for e in ev_res.data or []:
            g = e.get("geom")
            try:
                geom = shape(g) if g else None
            except Exception:  # noqa: BLE001
                geom = None
            if geom is None or not geom.intersects(region.geometry):
                continue
            p = prio.get(int(e["id_evento"]))
            events.append({
                **{k: e.get(k) for k in EVENT_FIELDS},
                "terra_indigena": _dedupe_names(e.get("terra_indigena")),
                "unidade_conservacao": _dedupe_names(e.get("unidade_conservacao")),
                "quilombola": _dedupe_names(e.get("quilombola")),
                "projeto_assentamento": _dedupe_names(e.get("projeto_assentamento")),
                "priority": None if not p else {
                    "indice": round(p["indice"], 1) if p.get("indice") is not None else None,
                    "indice_referencia": round(p["indice_referencia"], 1) if p.get("indice_referencia") is not None else None,
                    "variacao_percentual": round(p["variacao_percentual"], 1) if p.get("variacao_percentual") is not None else None,
                    "dt_referencia": p.get("dt_referencia"),
                },
                "geometry": mapping(shapely.simplify(geom, 0.001, preserve_topology=True)),
            })
        events.sort(key=lambda x: x.get("dt_ultima_visao") or "", reverse=True)
        status = pd.Series([e["status_evento"] for e in events]).value_counts().to_dict() if events else {}
        return {
            "available": True,
            "kind": "indicador_externo",
            "source": "Censipam — Painel do Fogo (API pública)",
            "docs": API_DOCS,
            "events": events,
            "count": len(events),
            "by_status": {k: int(v) for k, v in status.items()},
            "with_priority": sum(1 for e in events if e["priority"]),
            "priority_note": CENSIPAM_INDEX_NOTE,
            "priority_error": prio_error,
            "area_note": "A área dos eventos não é exibida: a unidade de 'area_total_evento' não está documentada na API.",
            "selection": "Eventos cuja geometria intersecta o limite IBGE do território (lista estadual filtrada localmente; "
                         "o filtro por município da API respondeu erro em 14/11/2026).",
            "provenance": {"events_url": ev_res.url, "events_fetched_at": ev_res.fetched_at.isoformat(timespec="seconds"),
                           "priorities_url": None if isinstance(pr_res, BaseException) else pr_res.url,
                           "stale": ev_res.stale, "warnings": ev_res.warnings},
        }
