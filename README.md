# Amazônia Viva

Plataforma de inteligência ambiental para a Amazônia, construída para o desafio
**Harmonization of MODIS and VIIRS Hot Spots** do NASA Space Apps Challenge 2026.

Une, com dados reais e rastreáveis:

- **últimas observações por satélite** (NASA FIRMS, VIIRS NOAA-20/NOAA-21 e MODIS);
- **histórico** do arquivo FIRMS, com séries separadas por sensor, linha de base e percentis;
- **comparação MODIS × VIIRS** e calendário de conversão experimental, com origem e incerteza explícitas;
- **contexto meteorológico** (NASA POWER: reanálise recente e climatologia 2001–2025);
- **análise territorial** com resumo fundamentado e sinais de atenção experimentais;
- **evidências**: manifesto de proveniência e exportação CSV dos registros reais.

> Detecções são pixels com anomalia térmica no momento da passagem do satélite,
> não incêndios individuais. MODIS e VIIRS têm sensibilidades diferentes e nunca
> são somados. Nenhuma previsão de propagação é feita.

## Fluxo piloto: Portel (PA)

1. Em **Current activity**, clique em Portel no mapa (os 144 municípios do Pará são selecionáveis).
2. Veja as detecções VIIRS/MODIS reais com data, horário UTC e de Brasília, e sensor.
3. Em **Territory analysis**, compare o período atual com os anos anteriores **no mesmo instrumento**
   (MODIS × arquivo MODIS 2001–2025; NOAA-20 × arquivo NOAA-20 2021–2025).
4. Consulte temperatura, umidade, chuva e vento (NASA POWER, reanálise com latência de dias).
5. Veja áreas oficiais sobrepostas (FUNAI, ICMBio, MMA/CNUC, INCRA), população do Censo 2022,
   localidades (IBGE), unidades de saúde (CNES), brigadas e pistas de pouso, e eventos do Censipam
   (indicador externo). Proximidade e exposição potencial aparecem separadas de dano confirmado.
6. Gere a **Ficha de Atenção Territorial** (`/ficha/portel?regiao=portel`), organizada em sete perguntas
   (o que, quando, é incomum?, ambiente, quem está perto, o que verificar, fontes e limitações),
   com cada afirmação rotulada como observação, estimativa, previsão, indicador externo ou ausente.
   Exporta PDF (impressão), JSON, CSV das detecções e CSV de proximidade.

## Telas

| Rota | Conteúdo |
|---|---|
| `/` Current activity | mapa (pontos, agrupamentos, limite IBGE, imagem VIIRS do dia), filtros 24 h/48 h/7 dias, sensor, dia/noite; detalhe da detecção; horário da observação, da coleta e atraso declarado; faixa de passagens dos satélites |
| `/historico` Fire history | calendário experimental em primeiro plano, com legenda observado/convertido/indisponível, faixa empírica e validação; atividade mensal por sensor, sazonalidade × mediana e P10–P90, matriz ano × mês com anomalias, calendário diário por produto, comparação de períodos, MODIS × VIIRS (temporal e espacial), experimento de agregação comum com validação "deixa um ano de fora", cobertura e processamento, pipeline e arquivos de origem |
| `/ambiente` | temperatura, umidade, vento (rosa dos ventos), chuva × climatologia, para o território ou para uma coordenada |
| `/territorio` Territory analysis | cinco perguntas: observações → atividade incomum → ambiente → áreas para investigar → evidências e limitações |
| `/evidencias` | região, período, fontes, versões, SHA-256, limitações; CSV e manifesto JSON |
| `/ficha/:territorio` | Ficha de Atenção Territorial: detectado, comparação, ambiente, território, Censipam, critérios, avaliação humana, fontes |

## Rodar localmente

Requisitos: Python 3.11, Node 20+ (testado com 26), ~100 MB de disco (mais ~20 MB
para o histórico agregado).

```bash
make setup          # venv + dependências + npm install + limites do IBGE + setores censitários do Pará
make history-pilot  # opcional: histórico piloto (~1,1 GB lidos em fluxo; ficam agregados e o recorte do Pará em Parquet)
make api            # http://127.0.0.1:8710  (documentação: /docs)
make web            # http://127.0.0.1:5710
```

Sem `make`:

```bash
cd backend
python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env
.venv/bin/python -m scripts.fetch_boundaries
.venv/bin/uvicorn app.main:app --port 8710 --reload --reload-dir app

cd ../frontend
npm install
npx vite --port 5710
```

### NASA FIRMS MAP_KEY (opcional)

Sem chave, a plataforma usa os **arquivos públicos NRT** da NASA FIRMS, sem
nenhuma credencial. Com chave (gratuita em
https://firms.modaps.eosdis.nasa.gov/api/map_key/), defina `FIRMS_MAP_KEY` em
`backend/.env`: a API por área passa a ser usada. A chave fica só no back-end e
é redigida em logs, URLs de proveniência e respostas.

## Testes

```bash
make test      # back-end (pytest, 77 testes, sem rede) + front-end (tsc + vitest)
make lint      # ruff
make smoke     # integrações REAIS: 13 fontes (FIRMS, POWER, GIBS, IBGE, Censipam, CNES, OpenFreeMap)
make validate  # recalcula o histórico de Portel direto do Parquet e compara com a API
make e2e       # fluxo completo no navegador com dados reais (Chrome local)
```

Os testes usam **fixtures sintéticas identificadas** (`backend/tests/fixtures`) e
fontes simuladas com `httpx.MockTransport`; nenhum valor sintético é usado fora
dos testes.

## Estrutura

```
amazonia-viva/
├── backend/
│   ├── app/{core,domain,integrations,science,services,persistence,api}
│   ├── scripts/{fetch_boundaries.py,import_history.py}
│   ├── data/boundaries/        limites IBGE + proveniência (versionados)
│   ├── data/runtime/           cache, SQLite e logs (gerados, ignorados pelo git)
│   └── tests/
├── frontend/src/{pages,features/map,components,lib}
└── docs/{ARCHITECTURE,METHODOLOGY,DATA_SOURCES}.md
```

## Documentação

- [Arquitetura e endpoints](docs/ARCHITECTURE.md)
- [Metodologia científica e resultados do piloto](docs/METHODOLOGY.md)
- [Fontes de dados](docs/DATA_SOURCES.md)
- [Plano das próximas etapas](docs/PLANO_PROXIMAS_ETAPAS.md)

## Limitações conhecidas

- Histórico importado é um piloto: MODIS 2001–2025, VIIRS NOAA-20 2021–2025 e VIIRS S-NPP 2023–2024.
- O índice de prioridade do Censipam é exibido sem alteração; sua fórmula não está publicada em formato verificável.
- O espelho do CNUC consultado contém só UCs estaduais; federais vêm do ICMBio; municipais não estão disponíveis.
- O arquivo anual MODIS mistura coleções (6.2, 6.03, 61.03) entre anos; a linha de base não corrige.
- Deriva orbital de Terra e Aqua não corrigida na comparação "incomum para a época".
- Cobertura real de observação (nuvens, grânulos) ainda não auditada.
- NASA POWER: reanálise em grade de ~50 km com ~3 dias de atraso; sem previsão.
- Localidades IBGE, unidades de saúde CNES e setores censitários foram integrados; escolas e comunidades ausentes dos cadastros continuam sendo lacunas.
- PDF usa a impressão do navegador no relatório territorial; não há serviço independente de geração de PDF.

## Missão 05 — interface científica

Interface de demonstração em inglês, com três experiências conectadas e seleção territorial compartilhada. O mapa usa limites IBGE e detecções reais; a hora da observação e a sincronização da plataforma são distintas. O calendário separa observações VIIRS e valores convertidos de MODIS Aqua, preservando a incerteza.

- [Entrega, diagnóstico visual, testes e limitações](docs/mission05/DELIVERY.md)
- [Direção de design](docs/mission05/DESIGN.md)
- [Verificações Playwright](docs/mission05/test-results.json)
- [Capturas antes](docs/mission05/before/) e [depois](docs/mission05/after/)

Os servidores locais existentes são `http://127.0.0.1:5710` (web) e `http://127.0.0.1:8710` (API). Evite iniciar outra instância nas mesmas portas. Para executar a auditoria visual, use Python 3.11 com `playwright` instalado e Chrome local:

```bash
python frontend/e2e/visual_audit.py --help
python frontend/e2e/visual_audit.py after
python frontend/e2e/mission05_flow.py --help
python frontend/e2e/mission05_flow.py
```

Nenhum download histórico nem nova integração é feito pela auditoria. A simulação de indisponibilidade intercepta uma resposta apenas em um contexto isolado do navegador. Os dados históricos, o backend e os cálculos científicos foram preservados.
