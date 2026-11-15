# Arquitetura

```
┌──────────────────────── frontend/ (React + TS + Vite) ────────────────────────┐
│ pages/            Situação atual · Histórico · Ambiente · Território · Evidências │
│ features/map/     MapLibre (OpenFreeMap + NASA GIBS), detalhe da detecção      │
│ components/       Indicator, OverpassRibbon, WindRose, CalendarHeatmap, estados│
│ lib/              api (fetch tipado), hooks (TanStack Query), formatação, tipos│
└───────────────────────────────┬────────────────────────────────────────────────┘
                                │ /api/v1 (proxy do Vite em desenvolvimento)
┌───────────────────────────────▼──────── backend/ (FastAPI) ────────────────────┐
│ api/routes/       HTTP: validação (Pydantic/Query), serialização, erros        │
│ services/         casos de uso: detections, weather, history, territory        │
│ science/          agregação, linha de base, percentis, comparação MODIS×VIIRS  │
│ integrations/     clientes FIRMS e POWER (parsing, cache, proveniência)        │
│ domain/           catálogo de produtos FIRMS, regiões com limites IBGE         │
│ persistence/      FileCache (respostas brutas), HistoryStore (SQLite),         │
│                   postgis_schema.sql (alvo)                                    │
│ core/             config por ambiente, logging JSON, HTTP com retry, erros     │
└────────────────────────────────────────────────────────────────────────────────┘
        │                      │                         │
   NASA FIRMS             NASA POWER                IBGE malhas v3
 (NRT públicos / API)   (diário, horário,          (limites oficiais,
 (arquivo anual país)     climatologia)             versionados no repo)
```

## Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Fonte NRT sem chave | Arquivos públicos FIRMS (América do Sul, 7 dias) com filtro exato de janela e recorte poligonal | Dados oficiais e demonstráveis sem credencial; a API por área entra automaticamente quando `FIRMS_MAP_KEY` existe |
| Janela 24h/48h/7d | Sempre a partir do arquivo de 7 dias, filtrado por `acq_datetime_utc ≥ agora − janela` | Janelas exatas e um único cache por satélite |
| Cache | Disco, com bytes originais + metadados (URL sem chave, horário, SHA-256); cópia anterior servida e sinalizada se a fonte cair | Rastreabilidade e resiliência em demonstrações |
| Persistência histórica | SQLite com agregados; esquema PostGIS preparado | Nenhuma infraestrutura pesada para começar |
| Histórico bruto | CSV anual processado em blocos e descartado; detecções dentro do Pará guardadas em Parquet (~39 MB) | Recortar qualquer município sem novo download |
| Territórios | Catálogo com Brasil, Pará e 144 municípios (IBGE); agregados municipais calculados sob demanda e registrados em `region_builds` | Portel e qualquer outro município paraense |
| Cache NRT aquecido | Tarefa em segundo plano renova os arquivos FIRMS antes de expirarem | O FIRMS chegou a levar 16–40 s por arquivo; o usuário não espera |
| Validação | `scripts/smoke_live.py` (13 integrações reais), `scripts/validate_history.py` (recalcula do Parquet), `frontend/e2e/portel-flow.mjs` (fluxo no navegador) | Verificação com dados reais, além dos testes offline |
| Tipo de informação | Campo `kind` (observacao, estimativa, previsao, indicador_externo, ausente) em fatos e seções | Transparência exigida pela missão |
| Limites | IBGE qualidade máxima (até ~3,6 mil vértices) | A generalização "intermediária" atribuía à região errada as detecções perto das divisas |
| Basemap | OpenFreeMap Positron (vetorial, sem chave) + mosaico VIIRS NOAA-20 do NASA GIBS | CARTO passou a exigir chave |
| Gráficos | Recharts + SVG próprio (faixa de passagens, rosa dos ventos, calendário) | Paleta por produto validada para daltonismo e contraste |
| Segredos | `FIRMS_MAP_KEY` só no back-end (`SecretStr`), redigida em URLs, logs e respostas | A chave nunca chega ao navegador |

## Endpoints (`/api/v1`)

| Método e rota | Função |
|---|---|
| `GET /health` | estado, regiões carregadas, chave configurada (booleano), histórico importado |
| `GET /regions`, `GET /regions/{id}/boundary` | regiões e limites IBGE (GeoJSON) |
| `GET /sources` | catálogo de produtos FIRMS, modo de obtenção, latência declarada |
| `GET /detections?region&window&products&daynight` | GeoJSON compacto + metadados e proveniência por produto |
| `GET /detections/summary` | só os metadados |
| `GET /detections/{produto}/{id}` | registro completo da detecção |
| `GET /detections/export.csv` | registros reais da consulta com colunas de proveniência |
| `GET /weather/context?region|lat&lon` | POWER: diário, horário (rosa dos ventos), climatologia, previsão = indisponível |
| `GET /history/status` | arquivos importados, versões, proveniência |
| `GET /history/monthly` | série mensal de um produto + linha de base por mês |
| `GET /history/calendar` | contagens diárias de um ano |
| `GET /history/compare` | dois períodos, mesmo produto |
| `GET /history/overlap?other=VIIRS_NOAA20_SP|VIIRS_SNPP_SP` | MODIS × VIIRS (temporal e espacial), por território |
| `GET /regions/{id}/municipalities` | limites municipais simplificados para seleção no mapa |
| `GET /territory/{id}/brief` | análise territorial composta + sinais experimentais (com `kind` por fato) |
| `GET /territory/{id}/context` | áreas oficiais sobrepostas, população Censo 2022, eventos Censipam |
| `GET /territory/{id}/impact` | localidades (IBGE), saúde (CNES), pistas, brigadas e exposição potencial por setores |
| `GET /territory/{id}/ficha` | Ficha de Atenção Territorial (JSON, com `questions` e `impact`) |
| `GET /history/coverage` | cobertura, versões, processamento e incertezas por produto no território |
| `GET /history/harmonization-experiment` | índice normalizado por sensor + validação deixa-um-ano-de-fora |
| `GET /reports/evidence` | manifesto de evidências (JSON) |

Documentação interativa: `http://127.0.0.1:8710/docs`.

## Migração para PostGIS

1. Criar o banco com `backend/app/persistence/postgis_schema.sql`.
2. Implementar `HistoryStore` com a mesma interface (`replace_source_file`,
   `daily`, `grid_monthly`, `source_files`, `years_available`).
3. Passar a gravar detecções individuais (tabela `detection`) para consultas
   espaciais arbitrárias (buffers ao redor de terras indígenas, UCs, comunidades).
