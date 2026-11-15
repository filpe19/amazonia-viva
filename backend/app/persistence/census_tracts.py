"""Setores censitários do Censo 2022 (IBGE, malha com atributos) lidos do GeoPackage local.

Atenção (verificado em 15/11/2026): o arquivo traz setores multipartes em várias linhas,
repetindo os atributos em cada parte (Portel: 142 linhas, 91 setores). Aqui as partes são
unidas por CD_SETOR e os atributos contados uma única vez — a soma de V0001 (Total de
pessoas) por município passa a coincidir com a população do Censo (Portel: 62.503).
"""

from __future__ import annotations

import json
import sqlite3
from functools import lru_cache
from pathlib import Path

import shapely

TABLE = "PA_setores_CD2022"
_ENVELOPE_BYTES = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}


def gpkg_geometry(blob: bytes):
    """Converte o binário de geometria GeoPackage (cabeçalho GP + envelope) em geometria shapely."""
    if blob[:2] != b"GP":
        raise ValueError("geometria GeoPackage inválida")
    flags = blob[3]
    env = (flags >> 1) & 0b111
    return shapely.from_wkb(blob[8 + _ENVELOPE_BYTES[env]:])


@lru_cache(maxsize=16)
def tracts_for_municipality(gpkg_path: str, cd_mun: str) -> tuple[dict, ...]:
    path = Path(gpkg_path)
    if not path.exists():
        return ()
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        rows = con.execute(
            f"SELECT CD_SETOR, SITUACAO, AREA_KM2, v0001, v0007, geom FROM '{TABLE}' WHERE CD_MUN = ?", (cd_mun,)
        ).fetchall()
    finally:
        con.close()
    by_setor: dict[str, dict] = {}
    for cd, sit, area, pop, dom, blob in rows:
        geom = gpkg_geometry(blob)
        if cd in by_setor:
            by_setor[cd]["parts"].append(geom)
        else:
            by_setor[cd] = {"cd_setor": cd, "situacao": sit, "area_km2": area, "population": int(pop or 0),
                            "occupied_households": int(dom or 0), "parts": [geom]}
    out = []
    for s in by_setor.values():
        geom = shapely.union_all(s.pop("parts"))
        out.append({**s, "geometry": shapely.make_valid(geom)})
    return tuple(out)


def reference_meta(gpkg_path: str) -> dict:
    meta = Path(f"{gpkg_path}.meta.json")
    return json.loads(meta.read_text("utf-8")) if meta.exists() else {}
