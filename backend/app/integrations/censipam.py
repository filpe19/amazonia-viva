"""Integração com o Censipam: API do Painel do Fogo e GeoServer Panorama (WFS).

* API: https://panorama.sipam.gov.br/painel-do-fogo/api/openapi.json (pública, sem
  autenticação documentada; SRC SIRGAS 2000 / EPSG:4674).
* WFS: https://panorama.sipam.gov.br/geoserver/painel_do_fogo/wfs — espelha bases
  oficiais (FUNAI, MMA/CNUC, INCRA). A fonte primária de cada camada é declarada.

Tudo o que vem daqui é **informação externa**: eventos e índice de prioridade são
produtos operacionais do Censipam, exibidos como tal e nunca combinados com os
critérios da plataforma. A diferença SIRGAS 2000 × WGS84 é inferior a 1 m.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from urllib.parse import urlencode

from app.core.errors import UpstreamError
from app.core.http import HttpClient
from app.persistence.cache import FileCache

API_BASE = "https://panorama.sipam.gov.br/painel-do-fogo/api/v1"
WFS_BASE = "https://panorama.sipam.gov.br/geoserver/painel_do_fogo/wfs"
API_DOCS = "https://panorama.sipam.gov.br/painel-do-fogo/api/redoc"
SOURCE = "Censipam"


@dataclass(frozen=True)
class LayerDef:
    id: str
    layer: str
    label: str
    primary_source: str
    name_field: str
    attrs: tuple[str, ...]
    attr_labels: dict = field(default_factory=dict)


LAYERS: dict[str, LayerDef] = {
    d.id: d
    for d in [
        LayerDef("terras_indigenas", "painel_do_fogo:funai_terra_indigena", "Terras indígenas", "FUNAI",
                 "terrai_nom", ("etnia_nome", "fase_ti", "modalidade"),
                 {"etnia_nome": "Povo(s)", "fase_ti": "Fase", "modalidade": "Modalidade"}),
        LayerDef("ucs_federais", "painel_do_fogo:icmbio_unidade_conservacao_federal", "Unidades de conservação federais",
                 "ICMBio", "nome", ("sigla", "siglagrupo", "anocriacao", "atolegal"),
                 {"sigla": "Categoria", "siglagrupo": "Grupo (PI/US)", "anocriacao": "Criação", "atolegal": "Ato legal"}),
        # O espelho do CNUC no GeoServer do Censipam contém só UCs estaduais (verificado em 14/11/2026: 1.238, todas
        # "Estadual"); as federais vêm da camada do ICMBio. UCs municipais não estão em nenhuma das duas.
        LayerDef("ucs_estaduais", "painel_do_fogo:mma_cnuc_unidade_conservacao", "Unidades de conservação estaduais",
                 "MMA — Cadastro Nacional de Unidades de Conservação (CNUC)", "nome_uc",
                 ("categoria", "grupo", "ano_cria"),
                 {"categoria": "Categoria", "grupo": "Grupo", "ano_cria": "Criação"}),
        LayerDef("quilombolas", "painel_do_fogo:area_quilombola", "Territórios quilombolas", "INCRA",
                 "nm_comunid", ("nm_municip", "nr_familia", "dt_titulac"),
                 {"nm_municip": "Município (INCRA)", "nr_familia": "Famílias no processo INCRA", "dt_titulac": "Titulação"}),
        LayerDef("assentamentos", "painel_do_fogo:assentamento_federal", "Assentamentos federais", "INCRA",
                 "nome_proje", ("tipo", "capacidade", "num_famili", "data_de_cr"),
                 {"tipo": "Tipo", "capacidade": "Capacidade (famílias)", "num_famili": "Famílias assentadas", "data_de_cr": "Criação"}),
    ]
}


@dataclass
class ExternalFetch:
    data: object
    url: str
    fetched_at: datetime
    cache_hit: bool
    stale: bool = False
    warnings: list[str] = field(default_factory=list)


class CensipamClient:
    def __init__(self, http: HttpClient, cache: FileCache, *, events_ttl: int = 900, layers_ttl: int = 86_400) -> None:
        self._http = http
        self._cache = cache
        self._events_ttl = events_ttl
        self._layers_ttl = layers_ttl
        self._parsed: dict[str, object] = {}

    async def _get_json(self, url: str, ttl: int) -> ExternalFetch:
        key = f"censipam:{url}"
        entry = self._cache.get(key)
        if entry and entry.is_fresh(ttl):
            return ExternalFetch(self._parse(entry.meta.get("sha256", ""), entry.content), url,
                                 datetime.fromisoformat(entry.meta["fetched_at"]), True)
        try:
            res = await self._http.get(url, source=SOURCE)
            data = self._parse(None, res.content)
        except (UpstreamError, ValueError) as exc:
            if entry:
                msg = exc.message if isinstance(exc, UpstreamError) else "resposta inválida"
                return ExternalFetch(self._parse(entry.meta.get("sha256", ""), entry.content), url,
                                     datetime.fromisoformat(entry.meta["fetched_at"]), True, True,
                                     [f"Censipam indisponível agora ({msg}); exibindo cópia anterior."])
            if isinstance(exc, ValueError):
                raise UpstreamError("Censipam devolveu conteúdo não-JSON", source=SOURCE, detail={"url": url}) from exc
            raise
        meta = self._cache.put(key, res.content, {"url": url, "fetched_at": datetime.now(UTC).isoformat()})
        self._parsed[meta["sha256"]] = data
        return ExternalFetch(data, url, datetime.fromisoformat(meta["fetched_at"]), False)

    def _parse(self, sha: str | None, content: bytes):
        if sha and sha in self._parsed:
            return self._parsed[sha]
        data = json.loads(content)
        if sha:
            self._parsed[sha] = data
        return data

    # ----------------------------------------------------------------- API
    async def events_by_state(self, uf: str) -> ExternalFetch:
        """Eventos de fogo ativos ou em observação da UF (o filtro por município da API respondeu 502 em 14/11/2026)."""
        return await self._get_json(f"{API_BASE}/eventos?{urlencode({'sigla_estado': uf})}", self._events_ttl)

    async def priorities_bbox(self, bbox: tuple[float, float, float, float]) -> ExternalFetch:
        w, s, e, n = bbox
        return await self._get_json(f"{API_BASE}/eventos/prioridades?bbox={w:.4f},{s:.4f},{e:.4f},{n:.4f}", self._events_ttl)

    # ----------------------------------------------------------------- WFS
    async def layer_bbox(self, layer: LayerDef, bbox: tuple[float, float, float, float]) -> ExternalFetch:
        w, s, e, n = bbox
        # EPSG:4674 em URN: eixos latitude, longitude no parâmetro bbox; a saída GeoJSON vem em lon/lat.
        params = {
            "service": "WFS", "version": "2.0.0", "request": "GetFeature", "outputFormat": "application/json",
            "typeNames": layer.layer, "bbox": f"{s:.4f},{w:.4f},{n:.4f},{e:.4f},urn:ogc:def:crs:EPSG::4674",
        }
        return await self._get_json(f"{WFS_BASE}?{urlencode(params)}", self._layers_ttl)
