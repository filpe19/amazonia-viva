"""Cache em disco para respostas de fontes externas, com metadados de proveniência.

Cada entrada guarda os bytes originais (como recebidos da fonte) e um JSON com
URL (sem credenciais), horário da coleta, cabeçalhos relevantes e SHA-256.
Entradas expiradas continuam disponíveis como *stale* para uso em caso de falha
da fonte, sempre sinalizadas como tal.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CacheEntry:
    content: bytes
    meta: dict
    age_seconds: float

    def is_fresh(self, ttl_seconds: int) -> bool:
        return self.age_seconds <= ttl_seconds


class FileCache:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _paths(self, key: str) -> tuple[Path, Path]:
        h = hashlib.sha256(key.encode()).hexdigest()[:32]
        return self.root / f"{h}.bin", self.root / f"{h}.json"

    def get(self, key: str) -> CacheEntry | None:
        data_p, meta_p = self._paths(key)
        if not (data_p.exists() and meta_p.exists()):
            return None
        try:
            meta = json.loads(meta_p.read_text("utf-8"))
            content = data_p.read_bytes()
        except (OSError, ValueError):
            return None
        stored_at = float(meta.get("stored_at_epoch", 0))
        return CacheEntry(content=content, meta=meta, age_seconds=max(0.0, time.time() - stored_at))

    def put(self, key: str, content: bytes, meta: dict) -> dict:
        data_p, meta_p = self._paths(key)
        full_meta = {
            **meta,
            "cache_key": key,
            "stored_at_epoch": time.time(),
            "sha256": hashlib.sha256(content).hexdigest(),
            "bytes": len(content),
        }
        self._atomic_write(data_p, content)
        self._atomic_write(meta_p, json.dumps(full_meta, ensure_ascii=False, indent=2).encode())
        return full_meta

    @staticmethod
    def _atomic_write(path: Path, data: bytes) -> None:
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
