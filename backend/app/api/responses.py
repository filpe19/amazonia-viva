"""Resposta JSON para cargas grandes: serializa fora do laço de eventos e sem o jsonable_encoder do FastAPI.

O jsonable_encoder percorre recursivamente cada objeto; com dezenas de milhares de feições (escala amazônica) isso
levava dezenas de segundos dentro do laço de eventos e congelava todas as rotas, inclusive /health.
"""

from __future__ import annotations

import asyncio
import json

from fastapi.responses import Response


def _dumps(data) -> bytes:
    return json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


async def big_json(data) -> Response:
    return Response(content=await asyncio.to_thread(_dumps, data), media_type="application/json")
