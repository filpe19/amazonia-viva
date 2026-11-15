# Próximas etapas: viabilidade, dependências e prioridades

Análise feita em 14/11/2026, antes de qualquer novo módulo. Nada da
implementação existente foi alterado. Cada fonte abaixo foi **testada hoje**;
o resultado do teste está indicado.

## 1. Contexto verificado

| Fato | Situação da verificação |
|---|---|
| Decreto estadual nº 5.767 (11/11/2026): emergência ambiental e climática em todo o Pará por 120 dias; suspende autorizações de uso do fogo (com exceções para povos e comunidades tradicionais e agricultura familiar) | Várias reportagens concordam. **Texto oficial no Diário Oficial ainda não lido** |
| Decreto estadual nº 5.782 (13/11/2026): emergência de Nível II por 180 dias nas áreas atingidas por incêndios identificadas pela Cedec | Reportagens. **Lista das áreas atingidas não localizada**; sem registro no S2iD encontrado |
| Reforço de brigadistas em Santarém e no Baixo Amazonas | Reportagens |

Consequência para o produto: a plataforma pode citar os decretos com link para o
texto oficial, mas **não pode desenhar "áreas em emergência Nível II"** até ter a
lista oficial da Cedec (ou o reconhecimento federal no S2iD).

## 2. Ponto de partida (já implementado)

- NRT FIRMS (NOAA-20, NOAA-21, MODIS) por região, com proveniência.
- Histórico MODIS 2016–2025 e VIIRS S-NPP 2023–2024 (agregados).
- Comparação MODIS × VIIRS exploratória, documentada em `METHODOLOGY.md`.
- Clima NASA POWER, análise territorial com sinais experimentais, evidências e CSV.

Limites da arquitetura atual que afetam os novos pedidos:

1. **Regiões fixas no código** (Brasil, Pará, Santarém).
2. **O histórico guarda só agregados por essas regiões.** Para incluir Portel ou
   Almeirim no histórico, hoje seria preciso baixar de novo ~520 MB.
3. **O sinal de persistência usa o nível administrativo** ("só municípios"). Almeirim
   tem 72.955 km², mais que muitos estados; o critério precisa ser espacial.

## 3. Avaliação por direcionamento

Esforço: P (até 1 dia), M (2–3 dias), G (4+ dias), para uma pessoa com o
código atual.

### 3.1 Monitoramento quase em tempo real — manter
- **Viabilidade: alta (já existe).**
- Complemento opcional: focos de baixa latência do Censipam (estações terrenas
  próprias, VIIRS) e GOES, ambos na API do Painel do Fogo. O próprio Censipam
  descreve a camada de baixa latência como beta, em validação, e sem série
  histórica completa. Se entrar, deve entrar como produto separado, com esse
  aviso. Esforço: M.

### 3.2 Comparação histórica MODIS/VIIRS — continuar
- **Viabilidade: alta**, com dependência de tempo de processamento.
- Próximos passos (já listados em `METHODOLOGY.md` §8): S-NPP 2012–2025,
  NOAA-20 2018–2025, auditoria de cobertura, testes de sensibilidade.
- **Dependência D2** (persistir detecções recortadas) evita novos downloads a
  cada território. Esforço: M (D2) + M (ampliar anos e testes).

### 3.3 Fichas territoriais (fogo × ambiente × população)
- **Viabilidade: alta no nível municipal; média para exposição fina.**
- População municipal: **IBGE SIDRA, tabela 4714, testada**:

  | Município | Código IBGE | População (Censo 2022) | Área (km²) |
  |---|---|---|---|
  | Santarém | 1506807 | 331.942 | 17.898,4 |
  | Portel | 1505809 | 62.503 | 25.385,0 |
  | Almeirim | 1500503 | 34.280 | 72.954,8 |

- Exposição abaixo do município: **Grade Estatística do Censo 2022** (IBGE;
  células de 1 km; arquivo nacional `BR1KM_20251002.zip`, 416 MB, testado) ou
  agregados por setor censitário (malha com atributos disponível no FTP do IBGE).
  Processamento único para extrair o Pará.
- Regra de transparência: "população residente no Censo 2022 nas células a até
  X km das detecções" é uma **estimativa de proximidade**, não "pessoas em risco".
- Esforço: P (municipal) + M (grade 1 km).

### 3.4 Integração com o Censipam (Painel do Fogo)
- **Viabilidade: alta para leitura e exibição; baixa para incorporar o índice ao nosso método.**
- API pública testada (`/painel-do-fogo/api/v1`, OpenAPI sem autenticação,
  SIRGAS 2000). Hoje há **876 eventos no Pará** (435 ativos, 441 em observação).
  Por município: Portel 99, Almeirim 78 (4 tocam terra indígena), Santarém 27.
- Endpoints úteis: `eventos?sigla_estado=PA`, `eventos/prioridades?bbox=…`,
  `eventos/{id}/prioridades` (histórico do índice), `eventos/{id}/evolucoes/{data}`
  (geometria acumulada), `eventos/{id}/deteccoes`, `meteorologia/wrf/vento`
  (previsão de vento CPTEC/INPE, ~25 MB).
- O que **não está documentado de forma verificável**: a fórmula e os pesos do
  "índice de prioridade para acionamento" (o FAQ lista componentes como área,
  FRP, tempo, velocidade, variação de área e número de focos, sem pesos); a
  unidade de `area_total_evento`; termos de uso e limites de requisição.
- Recomendação:
  - exibir eventos e índice **como informação externa e oficial do Censipam**,
    com data e link, sem misturar com os sinais da plataforma;
  - **não** usar o índice para ordenar ou classificar territórios por conta própria;
  - não exibir área com unidade até o Censipam confirmar;
  - cache de 15–30 min e consultas por bbox, para não sobrecarregar a API;
  - pedir esclarecimentos à equipe do Painel do Fogo (contato público na
    documentação da API).
- Esforço: M.

### 3.5 Municípios Portel, Almeirim e Santarém
- **Viabilidade: alta.** Limites IBGE testados; atividade atual abundante
  (últimos 7 dias, testado):

  | Município | NOAA-20 | NOAA-21 | MODIS | Dias com detecção |
  |---|---|---|---|---|
  | Portel | 1.521 | 1.409 | 526 | 8 de 8 |
  | Almeirim | 2.020 | 2.300 | 621 | 8 de 8 |
  | Santarém | 248 | 447 | 93 | 6 de 6 completos |

- Dependências: **D1** (catálogo de territórios) e **D2** (histórico recortável).
- Atenção metodológica: com contagens municipais, percentis de 10 anos são
  instáveis em meses de pouca atividade; mostrar *n* e intervalos.
- Esforço: P (NRT, clima, Censipam) + M (histórico, após D2).

### 3.6 Camadas: UCs, comunidades, infraestrutura essencial
| Camada | Fonte testada hoje | Situação |
|---|---|---|
| Unidades de conservação | MMA/CNUC, shapefile de 08/2025 (dados.mma.gov.br, HTTP 200) e espelho no GeoServer do Censipam (1.238) | Viável: usar o arquivo do MMA como fonte primária |
| Terras indígenas | WFS da FUNAI respondeu **403** para acesso automatizado; espelho no GeoServer do Censipam (637) | Viável via Censipam, citando a cadeia (FUNAI → Censipam) e a data |
| Territórios quilombolas | INCRA, espelho no GeoServer do Censipam (439) | Viável, mesma ressalva |
| Assentamentos | INCRA, espelho no Censipam | Viável |
| Unidades de saúde | CNES (API de dados abertos do Ministério da Saúde) com latitude/longitude, testada | Viável; a camada EDGV do Censipam tem só 88 registros (incompleta) |
| Escolas | INEP (Catálogo de Escolas); camada EDGV do Censipam incompleta (1.056 no país) | A verificar |
| Brigadas | GeoServer do Censipam (715 pontos) | Viável |
| Rodovias, linhas de transmissão | DNIT e ONS espelhados no Censipam | Viável |
| Comunidades/localidades | IBGE (localidades do Censo 2022) | A verificar; exige validação local |

- Dependência **D3**: registro de proveniência por camada (fonte primária,
  espelho, data de atualização, licença).
- Esforço: M (UC/TI/quilombo/assentamento) + M (saúde, escolas, brigadas).

### 3.7 Fluxo de relatório
- **Viabilidade: alta.** Os dados e o manifesto de evidências já existem.
- Estrutura proposta, em três blocos:
  1. **O que foi detectado** (observações, com horário e fonte);
  2. **Por que merece atenção** (só critérios explícitos e comparações do
     mesmo produto; evento Censipam citado como informação externa);
  3. **O que precisa de avaliação humana**: lista de verificação, por exemplo
     confirmação em campo, se é queima agrícola ou incêndio, nebulosidade na
     passagem, presença de comunidades não mapeadas, status do evento no Censipam,
     área do decreto Nível II.
- Cada afirmação recebe um rótulo: **observação**, **estimativa**, **previsão**
  ou **ausente**. Esse rótulo depende da D4.
- Saída: página imprimível e PDF gerado no servidor. Esforço: M.

### 3.8 Painel técnico × experiência pública
- **Viabilidade: alta**, se separada desde já na arquitetura.
- Painel técnico (atual): gestores, com dados completos, sinais experimentais,
  índice Censipam e eventos.
- Experiência pública (futura): linguagem simples, resumo por município,
  decretos vigentes, orientações oficiais (Defesa Civil, 193), sem sinais
  experimentais, sem índice de prioridade e sem dados de imóveis rurais (CAR).
- Implementação: mesma API, rotas e componentes de apresentação separados,
  endpoints públicos com resposta já filtrada. Esforço: G (só depois das fichas).

## 4. Dependências técnicas transversais

| Id | Dependência | Por que vem antes |
|---|---|---|
| D1 | **Catálogo de territórios** (municípios do Pará via IBGE, depois TI/UC) no lugar das regiões fixas | Portel, Almeirim e fichas territoriais |
| D2 | **Persistir as detecções históricas recortadas no Pará** (Parquet, ~dezenas de MB) | Novos territórios e sobreposições sem novo download |
| D3 | **Proveniência por camada** (fonte primária, espelho, data, licença) | Camadas territoriais e relatório |
| D4 | **Tipo de informação em toda resposta** (`observacao`, `estimativa`, `previsao`, `ausente`) e selo visual único na interface | Relatório e experiência pública |
| D5 | **Persistência espacial** (por célula de grade, não por nível administrativo) | Sinais em municípios grandes como Almeirim |
| D6 | **Separação técnico × público** (rotas e serializadores) | Evita vazar dados experimentais para o público |

## 5. Prioridades recomendadas

Ordem pensada para entregar valor demonstrável cedo, sem quebrar o que existe.

**Fase 1: território e contexto (base para tudo)**
1. D1 + D4: catálogo de territórios e tipo de informação.
2. Portel e Almeirim no NRT, no clima e na análise territorial.
3. População municipal (SIDRA) nas fichas.
4. Eventos e índice do Censipam como camada externa, somente leitura.

**Fase 2: histórico e camadas**
5. D2 e histórico municipal (Portel, Almeirim, Santarém).
6. D3 e camadas de UC, TI, quilombos e assentamentos.
7. D5: persistência espacial.

**Fase 3: relatório**
8. Ficha territorial completa e relatório em três blocos (com PDF).
9. Saúde (CNES), brigadas e exposição populacional pela grade de 1 km.

**Fase 4: ampliação**
10. Harmonização: S-NPP 2012–2025, NOAA-20 e testes de sensibilidade.
11. Previsão de vento WRF (CPTEC/INPE, via Censipam), rotulada como previsão.
12. Experiência pública simplificada (D6).

## 6. O que não será feito

- Índice de risco próprio ou previsão de propagação.
- Combinação do índice do Censipam com critérios da plataforma.
- Soma de contagens MODIS e VIIRS ou série "harmonizada" sem validação.
- Afirmações como "pessoas em risco"; usar "população residente próxima (Censo 2022)".
- Mapa de "áreas em emergência Nível II" sem a lista oficial.

## 7. Decisões que dependem do time

1. Contatar a equipe do Painel do Fogo para confirmar a metodologia do índice,
   a unidade de área e os termos de uso da API.
2. Obter o texto oficial dos decretos 5.767 e 5.782 e a lista de áreas da Cedec.
3. Autorizar o download único da grade de 1 km (416 MB) para exposição populacional.
4. Cadastrar a FIRMS MAP_KEY (gratuita).
5. Definir se a experiência pública entra na entrega do hackathon ou fica para depois.

## Fontes consultadas

- Painel do Fogo (Censipam), OpenAPI: https://panorama.sipam.gov.br/painel-do-fogo/api/openapi.json
- Painel do Fogo, documentação: https://panorama.sipam.gov.br/painel-do-fogo/api/redoc e https://panorama.sipam.gov.br/painel-do-fogo/perguntas_frequentes.html
- GeoServer Panorama (WFS): https://panorama.sipam.gov.br/geoserver/painel_do_fogo/wfs
- IBGE SIDRA, tabela 4714: https://servicodados.ibge.gov.br/api/v3/agregados/4714
- IBGE Grade Estatística 2022: https://geoftp.ibge.gov.br/recortes_para_fins_estatisticos/grade_estatistica/censo_2022/
- MMA/CNUC: https://dados.mma.gov.br/dataset/unidadesdeconservacao
- CNES (Ministério da Saúde): https://apidadosabertos.saude.gov.br/cnes/estabelecimentos
- Decreto 5.767: https://www.otempo.com.br/brasil/2026/11/12/estiagem-e-incendios-levam-para-a-decretar-emergencia-ambiental-e-climatica
- Decreto 5.782: https://revistaamazonia.com.br/para-emergencia-nivel-ii-incendios-florestais-decreto-5782-fumaca e https://ncnews.com.br/2026/11/14/para-emergencia-nivel-2-incendios-florestais-180-dias/
