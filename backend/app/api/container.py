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
from app.services.detections_service import DetectionsService
from app.services.history_service import HistoryService
from app.services.impact_service import ImpactService
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
    impact = ImpactService(detections, regions, http, cache, censipam, CnesClient(http, cache),
                           str(settings.runtime_dir / "reference" / "PA_setores_CD2022.gpkg"))
    territory = TerritoryService(detections, history, weather, regions, context, impact)
    return Container(settings, http, regions, firms, power, store, detections, weather, history, territory, context, impact)


def get_container(request: Request) -> Container:
    return request.app.state.container
