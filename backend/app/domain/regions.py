"""Registro de territórios com limites oficiais do IBGE.

Somente geometrias verificadas entram aqui. Cada limite tem um arquivo de
proveniência (`*.meta.json`) gerado por `scripts/fetch_boundaries.py`.

* REGION_DEFS: territórios com arquivo próprio (Brasil, Pará, Santarém).
* Municípios do Pará: carregados de `pa_municipios.geojson` (malha estadual,
  qualidade máxima), com identificador derivado do nome (ex.: "portel").
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path

import numpy as np
import shapely
from pyproj import Geod
from shapely.geometry import shape

from app.core.errors import NotFoundError


@dataclass(frozen=True)
class RegionDef:
    id: str
    name: str
    level: str  # pais | estado | municipio
    ibge_code: str
    ibge_path: str  # caminho na API de malhas v3 do IBGE
    parent: str | None = None
    pilot: bool = False
    featured: bool = False


REGION_DEFS: list[RegionDef] = [
    RegionDef("brasil", "Brasil", "pais", "BR", "paises/BR"),
    RegionDef("para", "Pará", "estado", "15", "estados/15", parent="brasil"),
    RegionDef("santarem", "Santarém (PA)", "municipio", "1506807", "municipios/1506807", parent="para", featured=True),
]

STATE_MUNICIPALITY_FILES = {"para": ("pa_municipios", "PA")}
PILOT_MUNICIPALITIES = {"1505809"}  # Portel (PA): piloto da Missão 02
FEATURED_MUNICIPALITIES = {"1505809", "1500503", "1506807"}  # Portel, Almeirim, Santarém

_GEOD = Geod(ellps="WGS84")


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def geodesic_area_km2(geom) -> float:
    area, _ = _GEOD.geometry_area_perimeter(geom)
    return abs(area) / 1e6


@dataclass
class Region:
    definition: RegionDef
    geojson: dict
    meta: dict = field(default_factory=dict)

    @property
    def id(self) -> str:
        return self.definition.id

    @cached_property
    def geometry(self):
        geoms = [shape(f["geometry"]) for f in self.geojson.get("features", [])]
        geom = shapely.union_all(geoms) if len(geoms) > 1 else geoms[0]
        geom = shapely.make_valid(geom)
        shapely.prepare(geom)
        return geom

    @cached_property
    def bbox(self) -> tuple[float, float, float, float]:
        minx, miny, maxx, maxy = self.geometry.bounds
        return (round(minx, 4), round(miny, 4), round(maxx, 4), round(maxy, 4))

    @cached_property
    def area_km2(self) -> float:
        """Área geodésica (WGS84) calculada a partir do limite IBGE."""
        return round(geodesic_area_km2(self.geometry), 1)

    @cached_property
    def centroid(self) -> tuple[float, float]:
        """(lon, lat) do ponto representativo (garantidamente dentro do polígono)."""
        p = self.geometry.representative_point() if not self.geometry.centroid.within(self.geometry) else self.geometry.centroid
        return (round(p.x, 4), round(p.y, 4))

    def contains(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        """Máscara booleana: pontos dentro do limite (pré-filtro por bbox + teste exato)."""
        lon = np.asarray(lon, dtype=float)
        lat = np.asarray(lat, dtype=float)
        w, s, e, n = self.bbox
        mask = (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)
        if mask.any():
            idx = np.flatnonzero(mask)
            inside = shapely.contains_xy(self.geometry, lon[idx], lat[idx])
            mask[idx] = inside
        return mask

    def summary(self) -> dict:
        d = self.definition
        return {
            "id": d.id,
            "name": d.name,
            "level": d.level,
            "ibge_code": d.ibge_code,
            "parent": d.parent,
            "pilot": d.pilot,
            "featured": d.featured,
            "area_km2": self.area_km2,
            "area_note": "Área geodésica calculada do limite IBGE (pode diferir da área oficial publicada).",
            "bbox": list(self.bbox),
            "centroid": list(self.centroid),
            "boundary_source": self.meta.get("source_url"),
            "boundary_fetched_at": self.meta.get("fetched_at"),
            "boundary_publisher": self.meta.get("publisher", "IBGE"),
        }


class RegionRegistry:
    def __init__(self, boundaries_dir: Path) -> None:
        self._dir = boundaries_dir
        self._regions: dict[str, Region] = {}
        self.missing: list[str] = []
        self._load()

    def _load(self) -> None:
        for d in REGION_DEFS:
            gj = self._dir / f"{d.id}.geojson"
            meta = self._dir / f"{d.id}.meta.json"
            if not gj.exists():
                self.missing.append(d.id)
                continue
            self._regions[d.id] = Region(
                definition=d,
                geojson=json.loads(gj.read_text("utf-8")),
                meta=json.loads(meta.read_text("utf-8")) if meta.exists() else {},
            )

        for parent_id, (fname, uf) in STATE_MUNICIPALITY_FILES.items():
            gj_path = self._dir / f"{fname}.geojson"
            if not gj_path.exists():
                self.missing.append(fname)
                continue
            meta_path = self._dir / f"{fname}.meta.json"
            meta = json.loads(meta_path.read_text("utf-8")) if meta_path.exists() else {}
            existing_codes = {r.definition.ibge_code for r in self._regions.values()}
            for f in json.loads(gj_path.read_text("utf-8"))["features"]:
                code = str(f["properties"]["codarea"])
                name = f["properties"]["nome"]
                if code in existing_codes:
                    # Território com arquivo próprio (ex.: Santarém): mantém, só atualiza destaque/piloto.
                    rid = next(r.id for r in self._regions.values() if r.definition.ibge_code == code)
                    old = self._regions[rid].definition
                    self._regions[rid].definition = RegionDef(
                        old.id, old.name, old.level, old.ibge_code, old.ibge_path, old.parent,
                        pilot=code in PILOT_MUNICIPALITIES, featured=code in FEATURED_MUNICIPALITIES,
                    )
                    continue
                rid = slugify(name)
                if rid in self._regions:
                    rid = f"{rid}-{code}"
                d = RegionDef(rid, f"{name} ({uf})", "municipio", code, f"municipios/{code}", parent=parent_id,
                              pilot=code in PILOT_MUNICIPALITIES, featured=code in FEATURED_MUNICIPALITIES)
                self._regions[rid] = Region(d, {"type": "FeatureCollection", "features": [f]},
                                            {**meta, "source_url": meta.get("source_url"), "publisher": meta.get("publisher", "IBGE")})

    def municipalities(self, parent_id: str) -> list[Region]:
        return [r for r in self._regions.values() if r.definition.level == "municipio" and r.definition.parent == parent_id]

    def all(self) -> list[Region]:
        return list(self._regions.values())

    def get(self, region_id: str) -> Region:
        try:
            return self._regions[region_id]
        except KeyError as exc:
            raise NotFoundError(
                f"Região '{region_id}' não disponível",
                detail={"disponiveis": sorted(self._regions), "sem_limite_baixado": self.missing},
            ) from exc
