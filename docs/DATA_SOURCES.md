# Fontes de dados

Todas as fontes são públicas e verificáveis. Nenhum valor é inventado: quando um
dado não existe, a interface mostra o estado "indisponível" e o motivo.

## NASA FIRMS — detecções de calor

| Uso | Endpoint | Credencial |
|---|---|---|
| Quase tempo real (padrão sem chave) | `https://firms.modaps.eosdis.nasa.gov/data/active_fire/<produto>/csv/<prefixo>_South_America_7d.csv` | não |
| API por área (quando há chave) | `/api/area/csv/{MAP_KEY}/{SOURCE}/{oeste,sul,leste,norte}/{DAY_RANGE 1–5}/{DATA}` | `FIRMS_MAP_KEY` |
| Disponibilidade | `/api/data_availability/csv/{MAP_KEY}/{SENSOR}` | `FIRMS_MAP_KEY` |
| Histórico (arquivo anual por país) | `/data/country/<modis|viirs-snpp|viirs-jpss1>/<ano>/<dir>_<ano>_Brazil.csv` | não |

- Produtos NRT padrão: `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT`. Opcional:
  `MODIS_NRT`. `VIIRS_SNPP_NRT` está catalogado, mas a produção do S-NPP
  terminou em 02/11/2026 às 15:40 UTC (FIRMS FAQ).
- Preparados para o histórico: `MODIS_SP`, `VIIRS_SNPP_SP`, `VIIRS_NOAA20_SP`.
- Latência declarada: "<3 hours" para dados globais
  (https://www.earthdata.nasa.gov/data/tools/firms/faq).
- Limite da API: 5.000 transações a cada 10 minutos por MAP_KEY.
- Chave gratuita: https://firms.modaps.eosdis.nasa.gov/api/map_key/

### Histórico importado (14/11/2026, importador 2.0)

| Produto | Anos | Arquivos | Volume lido | Versões |
|---|---|---|---|---|
| MODIS (Terra + Aqua) | 2016–2025 | 10 | ~284 MB | 6.2 (2016–17), 6.03 (2018–22), 61.03 (2023–25) |
| VIIRS S-NPP | 2023–2024 | 2 | ~261 MB | 2 |
| VIIRS NOAA-20 | 2021–2025 | 5 | ~565 MB | 2 |

Ficam no disco: agregados em SQLite (~24 MB) e as detecções dentro do Pará em
Parquet (~2,7 milhões de registros, ~39 MB), usadas para recortar qualquer
município paraense sem novo download. A série MODIS completa
(2000–2025) tem ~750 MB e pode ser importada com
`python -m scripts.import_history --product MODIS_SP --years 2000-2025`.

## NASA POWER — contexto meteorológico

- Diário: `/api/temporal/daily/point` (T2M, T2M_MAX, RH2M, WS10M, WD10M, PRECTOTCORR)
- Horário: `/api/temporal/hourly/point` (UTC; rosa dos ventos de 7 dias)
- Climatologia: `/api/temporal/climatology/point` (média 2001–2025)
- Reanálise em grade (GEOS-IT/MERRA-2), sem chave, com latência de dias e sem
  previsão. Documentação: https://power.larc.nasa.gov/docs/services/api/

## IBGE — limites territoriais

- API de malhas v3, qualidade máxima:
  `https://servicodados.ibge.gov.br/api/v3/malhas/{paises/BR | estados/15 | municipios/1506807}`
- Arquivos versionados em `backend/data/boundaries/` com `*.meta.json`
  (URL, data da coleta, SHA-256).

## IBGE — população e municípios

- Censo 2022, tabela SIDRA 4714 (população residente; área territorial):
  `https://servicodados.ibge.gov.br/api/v3/agregados/4714/periodos/2022/variaveis/93|6318?localidades=N6[1505809]`
- Malha dos 144 municípios do Pará (qualidade máxima) + nomes oficiais (API de localidades),
  em `backend/data/boundaries/pa_municipios.geojson`.

## Censipam — Painel do Fogo e GeoServer Panorama

- API pública (OpenAPI): `https://panorama.sipam.gov.br/painel-do-fogo/api/openapi.json`.
  Usados: `/eventos?sigla_estado=PA` (o filtro `municipios` respondeu 502 em 14/11/2026)
  e `/eventos/prioridades?bbox=…`. Exibidos como **indicador externo**.
- GeoServer WFS (`/geoserver/painel_do_fogo/wfs`), camadas espelhadas:

  | Camada | Fonte primária | Observação |
  |---|---|---|
  | `funai_terra_indigena` | FUNAI | WFS da própria FUNAI respondeu 403 a acesso automatizado |
  | `icmbio_unidade_conservacao_federal` | ICMBio | 340 UCs federais |
  | `mma_cnuc_unidade_conservacao` | MMA/CNUC | **contém só UCs estaduais (1.238)**; ex.: FLONA de Caxiuanã só aparece na camada do ICMBio |
  | `area_quilombola` | INCRA | |
  | `assentamento_federal` | INCRA | |

  UCs municipais não estão disponíveis nessas camadas. Coordenadas em SIRGAS 2000
  (diferença para WGS84 < 1 m).

## Pessoas e infraestrutura (Missão 03)

| Dado | Fonte | Acesso | Observação |
|---|---|---|---|
| Localidades (cidades, vilas, aglomerados rurais) | IBGE — BC250 2025 `CCAR:BC250_2025_lml_posic_geo_localidade_p` | WFS `geoservicos.ibge.gov.br/geoserver/wfs` | escala 1:250.000; comunidades pequenas podem faltar |
| Pistas e pontos de pouso | IBGE — BC250 2025 `CCAR:BC250_2025_aer_pista_ponto_pouso_p` | WFS IBGE | |
| Unidades de saúde | CNES — `apidadosabertos.saude.gov.br/cnes/estabelecimentos` | API pública; 20 registros por página | coordenadas declaradas; algumas ausentes |
| Setores censitários com população | IBGE — Censo 2022, malha com atributos (`PA_setores_CD2022.gpkg`, 46 MB) | `make reference` (SHA-256 registrado) | V0001 = total de pessoas; setores multipartes unidos por `CD_SETOR` |
| Brigadas | Censipam — `painel_do_fogo:tb_brigada_pto` | WFS Panorama | distância em linha reta, não tempo de deslocamento |

## Mapas de fundo

- OpenFreeMap Positron (vetorial, sem chave; © OpenMapTiles, © OpenStreetMap).
- NASA GIBS: `VIIRS_NOAA20_CorrectedReflectance_TrueColor` (mosaico diário).

## Camadas planejadas (não integradas)

| Camada | Fonte oficial candidata |
|---|---|
| Escolas | INEP — Catálogo de Escolas |
| Rodovias e linhas de energia (cruzamento com detecções) | IBGE BC250 2025 / DNIT / ONS (camadas existem; cruzamento não implementado) |
| UCs municipais | MMA/CNUC (arquivo completo) |
| Comunidades e localidades | IBGE, com validação local |
| Áreas de interesse | GeoJSON enviado pelo usuário, validado |
