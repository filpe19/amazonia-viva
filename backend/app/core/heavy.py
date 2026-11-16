"""Fila para cálculos geométricos pesados (Amazônia, Pará): um por vez, em thread.

Vários cálculos simultâneos disputam o GIL do Python e deixam a API lenta para todos. Serializando-os, as rotas leves
(detecções, limites, saúde) continuam respondendo enquanto um único cálculo pesado avança em segundo plano.
"""

from __future__ import annotations

import asyncio

_heavy: asyncio.Semaphore | None = None


async def run_heavy(fn, *args):
    global _heavy
    if _heavy is None:
        _heavy = asyncio.Semaphore(1)
    async with _heavy:
        return await asyncio.to_thread(fn, *args)
