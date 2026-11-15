"""Cliente HTTP assíncrono com timeout, retry exponencial e erros tipados."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

import httpx

from app.core.errors import UpstreamError, UpstreamUnavailableError

log = logging.getLogger("app.http")

RETRYABLE_STATUS = {429, 500, 502, 503, 504}


@dataclass(frozen=True)
class FetchResult:
    url: str  # URL sem credenciais (seguro para logs e proveniência)
    status_code: int
    content: bytes
    headers: dict[str, str]
    elapsed_ms: int
    attempts: int

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")


class HttpClient:
    def __init__(
        self,
        *,
        timeout: float = 30.0,
        max_retries: int = 3,
        backoff: float = 1.0,
        user_agent: str = "AmazoniaViva/0.1",
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._max_retries = max(0, max_retries)
        self._backoff = backoff
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout, connect=min(10.0, timeout)),
            headers={"User-Agent": user_agent},
            follow_redirects=True,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def get(
        self,
        url: str,
        *,
        params: dict | None = None,
        source: str,
        safe_url: str | None = None,
    ) -> FetchResult:
        """GET com retry. `safe_url` substitui a URL real em logs/erros (oculta chaves)."""
        shown = safe_url or url
        last_exc: Exception | None = None
        attempts = 0
        for attempt in range(self._max_retries + 1):
            attempts = attempt + 1
            started = time.perf_counter()
            try:
                resp = await self._client.get(url, params=params)
                elapsed = int((time.perf_counter() - started) * 1000)
                if resp.status_code in RETRYABLE_STATUS and attempt < self._max_retries:
                    log.warning(
                        "upstream retryable status",
                        extra={"source": source, "url": shown, "status": resp.status_code, "attempt": attempts},
                    )
                    await asyncio.sleep(self._backoff * (2**attempt))
                    continue
                if resp.status_code >= 400:
                    exc_cls = UpstreamUnavailableError if resp.status_code in RETRYABLE_STATUS else UpstreamError
                    raise exc_cls(
                        f"{source} respondeu HTTP {resp.status_code}",
                        source=source,
                        detail={"status": resp.status_code, "url": shown, "body": resp.text[:300]},
                    )
                log.info(
                    "upstream ok",
                    extra={"source": source, "url": shown, "status": resp.status_code, "ms": elapsed,
                           "bytes": len(resp.content), "attempts": attempts},
                )
                return FetchResult(
                    url=shown,
                    status_code=resp.status_code,
                    content=resp.content,
                    headers={k.lower(): v for k, v in resp.headers.items()},
                    elapsed_ms=elapsed,
                    attempts=attempts,
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_exc = exc
                log.warning(
                    "upstream network error",
                    extra={"source": source, "url": shown, "error": type(exc).__name__, "attempt": attempts},
                )
                if attempt < self._max_retries:
                    await asyncio.sleep(self._backoff * (2**attempt))
                    continue
        raise UpstreamUnavailableError(
            f"{source} indisponível após {attempts} tentativas",
            source=source,
            detail={"url": shown, "error": type(last_exc).__name__ if last_exc else None},
        )
