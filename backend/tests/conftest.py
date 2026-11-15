from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from app.core.config import BACKEND_DIR, Settings
from app.core.http import HttpClient

BOUNDARIES = BACKEND_DIR / "data" / "boundaries"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        environment="test",
        log_format="console",
        log_level="WARNING",
        runtime_dir=tmp_path / "runtime",
        boundaries_dir=BOUNDARIES,
        history_db_path=tmp_path / "runtime" / "history.sqlite",
        firms_map_key=None,
        http_max_retries=1,
        http_backoff_seconds=0.0,
    )


class Router:
    """Transporte simulado: mapeia trechos de URL para respostas e registra chamadas."""

    def __init__(self) -> None:
        self.routes: list[tuple[str, Callable[[httpx.Request], httpx.Response]]] = []
        self.calls: list[str] = []

    def add(self, fragment: str, handler: Callable[[httpx.Request], httpx.Response] | httpx.Response) -> None:
        fn = handler if callable(handler) else (lambda _req, r=handler: r)
        self.routes.append((fragment, fn))

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.calls.append(url)
        for frag, fn in self.routes:
            if frag in url:
                return fn(request)
        return httpx.Response(404, text=f"rota simulada inexistente: {url}")


@pytest.fixture
def router() -> Router:
    return Router()


@pytest.fixture
def http(router: Router) -> HttpClient:
    return HttpClient(timeout=5, max_retries=1, backoff=0.0, transport=httpx.MockTransport(router))


def boundaries_available() -> bool:
    return (BOUNDARIES / "santarem.geojson").exists() and (BOUNDARIES / "para.geojson").exists()
