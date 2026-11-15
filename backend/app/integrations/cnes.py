"""CNES — estabelecimentos de saúde (API de dados abertos do Ministério da Saúde).

https://apidadosabertos.saude.gov.br/cnes/estabelecimentos?codigo_municipio=<6 dígitos>
A API devolve no máximo 20 registros por página (verificado em 15/11/2026): é preciso paginar.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from app.core.errors import UpstreamError
from app.core.http import HttpClient
from app.persistence.cache import FileCache

BASE = "https://apidadosabertos.saude.gov.br/cnes"
PAGE = 20
MAX_PAGES = 60


class CnesClient:
    def __init__(self, http: HttpClient, cache: FileCache, ttl: int = 86_400) -> None:
        self._http = http
        self._cache = cache
        self._ttl = ttl

    async def _get(self, url: str, ttl: int) -> tuple[dict, str, bool]:
        key = f"cnes:{url}"
        entry = self._cache.get(key)
        if entry and entry.is_fresh(ttl):
            return json.loads(entry.content), entry.meta["fetched_at"], True
        res = await self._http.get(url, source="CNES (Ministério da Saúde)")
        try:
            data = json.loads(res.content)
        except ValueError as exc:
            raise UpstreamError("CNES devolveu conteúdo não-JSON", source="CNES") from exc
        meta = self._cache.put(key, res.content, {"url": url, "fetched_at": datetime.now(UTC).isoformat()})
        return data, meta["fetched_at"], False

    async def unit_types(self) -> dict[int, str]:
        data, _, _ = await self._get(f"{BASE}/tipounidades", 30 * 86_400)
        return {int(t["codigo_tipo_unidade"]): t["descricao_tipo_unidade"] for t in data.get("tipos_unidade", [])}

    async def establishments(self, ibge_code_7: str) -> dict:
        mun6 = str(ibge_code_7)[:6]
        items: list[dict] = []
        fetched = None
        for page in range(MAX_PAGES):
            url = f"{BASE}/estabelecimentos?codigo_municipio={mun6}&limit={PAGE}&offset={page * PAGE}"
            data, fetched_at, _ = await self._get(url, self._ttl)
            fetched = fetched or fetched_at
            batch = data.get("estabelecimentos", [])
            items.extend(batch)
            if len(batch) < PAGE:
                break
        return {"items": items, "url": f"{BASE}/estabelecimentos?codigo_municipio={mun6}", "fetched_at": fetched,
                "pages": page + 1}
