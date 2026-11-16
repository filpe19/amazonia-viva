"""Configuração por ambiente (variáveis de ambiente / arquivo .env).

Nenhum segredo possui valor padrão. A MAP_KEY do FIRMS é lida apenas no
back-end e nunca é serializada para o navegador.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Amazônia Viva API"
    app_version: str = "0.1.0"
    environment: str = Field(default="development", description="development | test | production")

    # Logging
    log_level: str = "INFO"
    log_format: str = Field(default="json", description="json | console")

    # CORS (origens do front-end)
    cors_origins: list[str] = ["http://localhost:5710", "http://127.0.0.1:5710"]

    # HTTP externo
    http_timeout_seconds: float = 30.0
    http_max_retries: int = 3
    http_backoff_seconds: float = 1.0
    http_user_agent: str = "AmazoniaViva/0.1 (NASA Space Apps 2026 research prototype)"

    # NASA FIRMS
    firms_map_key: SecretStr | None = None
    firms_base_url: str = "https://firms.modaps.eosdis.nasa.gov"
    firms_nrt_cache_ttl_seconds: int = 900  # 15 min: arquivos NRT são atualizados continuamente

    # Pré-cálculo em segundo plano ("região:janela"). Em servidores com pouca memória, deixe a escala amazônica de fora.
    warm_targets: list[str] = ["santarem:24h", "santarem:7d", "portel:24h", "portel:7d", "para:24h", "amazonia:24h"]

    # NASA POWER
    power_base_url: str = "https://power.larc.nasa.gov"
    power_cache_ttl_seconds: int = 6 * 3600

    # Diretórios de dados
    data_dir: Path = BACKEND_DIR / "data"
    runtime_dir: Path = BACKEND_DIR / "data" / "runtime"
    boundaries_dir: Path = BACKEND_DIR / "data" / "boundaries"
    history_db_path: Path = BACKEND_DIR / "data" / "runtime" / "history.sqlite"

    @property
    def cache_dir(self) -> Path:
        return self.runtime_dir / "cache"

    @property
    def firms_key_configured(self) -> bool:
        return bool(self.firms_map_key and self.firms_map_key.get_secret_value().strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
