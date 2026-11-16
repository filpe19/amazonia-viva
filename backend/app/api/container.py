"""Montagem das dependências da aplicação (um container por processo)."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from app.core.config import Settings
from app.core.http import HttpClient
from app.domain.regions import RegionRegistry
from app.integrations.censipam import CensipamClient
from app.integrations.cnes import CnesClient
from app.integrations.firms import FirmsClient
from app.integrations.ibge import IbgeClient
from app.integrations.power import PowerClient
from app.persistence.cache import FileCache
from app.persistence.history_store import HistoryStore
from app.services.attention_service import AttentionService
from app.services.detections_service import DetectionsService
from app.services.heat_source_service import HeatSourceService
from app.services.history_service import HistoryService
from app.services.hotspot_service import HotspotService
from app.services.impact_service import ImpactService
from app.services.indigenous_service import IndigenousService
from app.services.map_layers_service import MapLayersService
from app.services.territory_context_service import TerritoryContextService
from app.services.territory_service import TerritoryService
from app.services.weather_service import WeatherService


@dataclass
class Container:
    settings: Settings
    http: HttpClient
    regions: RegionRegistry
    firms: FirmsClient
    power: PowerClient
    history_store: HistoryStore
    detections: DetectionsService
    weather: WeatherService
    history: HistoryService
    territory: TerritoryService
    context: TerritoryContextService
    impact: ImpactService
    cache: FileCache | None = None
    attention: AttentionService | None = None
    indigenous: IndigenousService | None = None
    heat_source: HeatSourceService | None = None
    hotspots: HotspotService | None = None
    map_layers: MapLayersService | None = None

    async def aclose(self) -> None:
        await self.http.aclose()


def build_container(settings: Settings, http: HttpClient | None = None) -> Container:
    http = http or HttpClient(
        timeout=settings.http_timeout_seconds,
        max_retries=settings.http_max_retries,
        backoff=settings.http_backoff_seconds,
        user_agent=settings.http_user_agent,
    )
    cache = FileCache(settings.cache_dir)
    regions = RegionRegistry(settings.boundaries_dir)
    firms = FirmsClient(
        http, cache, base_url=settings.firms_base_url,
        map_key=settings.firms_map_key.get_secret_value() if settings.firms_map_key else None,
        cache_ttl=settings.firms_nrt_cache_ttl_seconds,
    )
    power = PowerClient(http, cache, base_url=settings.power_base_url, cache_ttl=settings.power_cache_ttl_seconds)
    store = HistoryStore(settings.history_db_path)
    detections = DetectionsService(firms, regions)
    weather = WeatherService(power)
    history = HistoryService(store, regions, settings.runtime_dir)
    censipam = CensipamClient(http, cache)
    context = TerritoryContextService(censipam, IbgeClient(http, cache), regions)
    cnes = CnesClient(http, cache)
    attention = AttentionService(detections, regions, http, cache, censipam, cnes)
    indigenous = IndigenousService(detections, regions, http, cache, censipam, settings.runtime_dir / "reference")
    heat_source = HeatSourceService(detections, indigenous, http, cache, settings.runtime_dir)
    hotspots = HotspotService(detections, regions, http, cache, censipam, indigenous, settings.runtime_dir)
    map_layers = MapLayersService(regions, censipam)
    impact = ImpactService(detections, regions, http, cache, censipam, cnes,
                           str(settings.runtime_dir / "reference" / "PA_setores_CD2022.gpkg"))
    territory = TerritoryService(detections, history, weather, regions, context, impact)
    return Container(settings, http, regions, firms, power, store, detections, weather, history, territory, context, impact, cache, attention, indigenous, heat_source, hotspots, map_layers)


def get_container(request: Request) -> Container:
    return request.app.state.container
