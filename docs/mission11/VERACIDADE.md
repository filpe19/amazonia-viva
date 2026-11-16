# Relatório de veracidade — consistência dos números (15/11/2026)

Gerado por `python -m scripts.verify_consistency santarem portel para`, contra a API em execução e o IBGE.

Cada linha compara duas rotas independentes da plataforma ou uma rota com a fonte oficial. Objetivo: garantir que o que aparece na tela bate entre módulos e respeita as regras públicas, por exemplo:
- os focos não perdem nem duplicam detecções;
- o grau "alto" só aparece com a regra atendida;
- "a favor do vento" só aparece com vento de modelo;
- nenhuma probabilidade é inventada;
- os totais do Censo ficam abaixo do total oficial.

| Região | Verificação | Resultado | Detalhe |
|---|---|---|---|
| santarem | Detecções: GeoJSON = soma dos metadados por produto | ✅ ok | 701 feições; metadados {'VIIRS_NOAA20_NRT': 269, 'VIIRS_NOAA21_NRT': 321, 'MODIS_NRT': 111} |
| santarem | Detecções por satélite: mapa = metadados | ✅ ok | {'NOAA-20': 269, 'NOAA-21': 321, 'Aqua': 58, 'Terra': 53} |
| santarem | Focos: detecções agrupadas = detecções do mapa | ✅ ok | 701 agrupadas (2026-11-15T18:32:36Z) × 701 no mapa (2026-11-15T18:33:42Z) |
| santarem | Focos: pixels = soma por satélite (sem dupla contagem) | ✅ ok | 63 focos listados; divergentes: [] |
| santarem | Grau 'alto' só com regra atendida (≥ 2 passagens + alvo) | ✅ ok | {'alto': 3, 'moderado': 38, 'baixo': 22, 'sem_alvo': 35}; fora da regra: [] |
| santarem | 'A favor do vento' só com vento de modelo disponível e ≤ 20 km | ✅ ok | 83 alvos a favor do vento |
| santarem | Probabilidade de chegada não é calculada (declarada como não modelada) | ✅ ok | ok |
| santarem | TI 'fogo dentro confirmado' só com ≥ 2 passagens | ✅ ok | 0 TIs com fogo dentro |
| santarem | Residentes indígenas (soma) = soma das TIs listadas | ✅ ok | — |
| santarem | DETER: polígonos cruzados = polígonos da camada do mapa | ✅ ok | 457 × 457 |
| portel | Detecções: GeoJSON = soma dos metadados por produto | ✅ ok | 2093 feições; metadados {'VIIRS_NOAA20_NRT': 766, 'VIIRS_NOAA21_NRT': 858, 'MODIS_NRT': 469} |
| portel | Detecções por satélite: mapa = metadados | ✅ ok | {'NOAA-20': 766, 'NOAA-21': 858, 'Aqua': 273, 'Terra': 196} |
| portel | Focos: detecções agrupadas = detecções do mapa | ✅ ok | 2093 agrupadas (2026-11-15T18:32:38Z) × 2093 no mapa (2026-11-15T18:33:42Z) |
| portel | Focos: pixels = soma por satélite (sem dupla contagem) | ✅ ok | 97 focos listados; divergentes: [] |
| portel | Grau 'alto' só com regra atendida (≥ 2 passagens + alvo) | ✅ ok | {'alto': 6, 'moderado': 51, 'baixo': 40, 'sem_alvo': 159}; fora da regra: [] |
| portel | 'A favor do vento' só com vento de modelo disponível e ≤ 20 km | ✅ ok | 59 alvos a favor do vento |
| portel | Probabilidade de chegada não é calculada (declarada como não modelada) | ✅ ok | ok |
| portel | TI 'fogo dentro confirmado' só com ≥ 2 passagens | ✅ ok | 0 TIs com fogo dentro |
| portel | Residentes indígenas (soma) = soma das TIs listadas | ✅ ok | — |
| portel | DETER: polígonos cruzados = polígonos da camada do mapa | ✅ ok | 536 × 536 |
| para | Detecções: GeoJSON = soma dos metadados por produto | ✅ ok | 28351 feições; metadados {'VIIRS_NOAA20_NRT': 11408, 'VIIRS_NOAA21_NRT': 12028, 'MODIS_NRT': 4915} |
| para | Detecções por satélite: mapa = metadados | ✅ ok | {'NOAA-20': 11408, 'NOAA-21': 12028, 'Aqua': 2804, 'Terra': 2111} |
| para | Focos: detecções agrupadas = detecções do mapa | ✅ ok | 28355 agrupadas (2026-11-15T18:30:11Z) × 28351 no mapa (2026-11-15T18:33:42Z); diferença explicada pela janela móvel de 7 dias entre os dois horários (cache de até 30 min) |
| para | Focos: pixels = soma por satélite (sem dupla contagem) | ✅ ok | 400 focos listados; divergentes: [] |
| para | Grau 'alto' só com regra atendida (≥ 2 passagens + alvo) | ✅ ok | {'alto': 158, 'moderado': 1318, 'baixo': 1137, 'sem_alvo': 1078}; fora da regra: [] |
| para | 'A favor do vento' só com vento de modelo disponível e ≤ 20 km | ✅ ok | 143 alvos a favor do vento |
| para | Probabilidade de chegada não é calculada (declarada como não modelada) | ✅ ok | ok |
| para | TI 'fogo dentro confirmado' só com ≥ 2 passagens | ✅ ok | 22 TIs com fogo dentro |
| para | Residentes indígenas (soma) = soma das TIs listadas | ✅ ok | 39850 |
| amazonia | Residentes em TIs com fogo ≤ total oficial da Amazônia Legal (IBGE 9719) | ✅ ok | 254.201 de 403.679 (63%) |

30 de 30 verificações consistentes.

## Como ler

- A comparação "focos × mapa" pode diferir em poucas detecções quando os dois números são calculados em horários diferentes: a janela de 7 dias é móvel e os focos ficam em cache por até 30 min. O script mostra os dois horários e só aceita diferença ≤ 0,1%.
- A verificação com o IBGE usa a tabela 9719 do Censo 2022 (nível Amazônia Legal) como teto para a soma dos residentes das TIs com fogo dentro.

## O que esta verificação não cobre

- Se cada detecção é de fato fogo: depende de verificação em campo. A plataforma mostra indícios ("É incêndio mesmo?") e confiabilidade por regra.
- A acurácia posicional das bases oficiais (FUNAI, IBGE, CNES, DNIT): usadas como publicadas.
