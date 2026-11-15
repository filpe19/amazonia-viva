# Metodologia científica

Este documento descreve como a Amazônia Viva trata as detecções de calor MODIS e
VIIRS, o que já foi implementado no pipeline de harmonização e o que ainda falta
validar. A regra geral: **nenhuma série combinada é publicada antes de validação
estatística.**

## 1. O que é uma detecção

Uma detecção (FIRMS "active fire / hotspot") é um pixel cuja temperatura de
brilho indica uma anomalia térmica no momento da passagem do satélite. Ela
**não** equivale a um incêndio individual, nem a área queimada. Um único fogo
pode gerar vários pixels, e um pixel pode conter vários focos pequenos.

| | MODIS (Terra, Aqua) | VIIRS (S-NPP, NOAA-20, NOAA-21) |
|---|---|---|
| Resolução nominal | ~1 km | ~375 m |
| Confiança | percentual 0–100 | classes low / nominal / high |
| Temperaturas de brilho | canais 21/22 e 31 | bandas I4 e I5 |
| Situação em 11/2026 | Terra e Aqua ativos no NRT, com deriva orbital | S-NPP encerrado em 02/11/2026; NOAA-20 e NOAA-21 ativos |

Por isso a plataforma **nunca soma** contagens de produtos diferentes e mantém a
confiança na escala original de cada sensor.

## 2. Pipeline implementado

1. **Importação** (`scripts/import_history.py`): arquivo anual por país da
   NASA FIRMS, lido em blocos e descartado após a agregação. Registra URL,
   `Last-Modified`, tamanho, SHA-256, linhas lidas e inválidas, versões e
   satélites presentes.
2. **Recorte**: teste ponto-em-polígono com os limites oficiais do IBGE (malha
   v3, qualidade máxima) para Brasil, Pará e Santarém.
3. **Agregação temporal comum**: contagem por dia UTC × região × produto ×
   satélite × turno (D/N) × tipo (`type`) × faixa de confiança. Os meses são
   derivados dos dias.
4. **Agregação espacial comum**: grade regular de 0,5° (canto sudoeste) por mês,
   para Pará e Santarém.
5. **Auditoria de cobertura e versão** (parcial): meses presentes em cada
   produto e versões de processamento por arquivo.
6. **Comparação nos anos de sobreposição** (piloto): MODIS (Aqua, Terra ou
   ambos) × VIIRS S-NPP, mês a mês, com:
   - razão VIIRS/MODIS por mês, com mediana e intervalo interquartil nos meses
     com ≥ 30 detecções em ambos (razões de contagens pequenas são instáveis);
   - correlação de Spearman (ordem) e de Pearson em `log(1+n)`;
   - concordância espacial na grade de 0,5° (índice de Jaccard e Spearman por
     célula).

## 3. Resultados do piloto (Pará, 2023–2024)

Dados: arquivo anual MODIS C6.1 e VIIRS S-NPP C2 da NASA FIRMS, importados em
14/11/2026 (SHA-256 na tela de evidências).

- 24 meses pareados; razão mediana **VIIRS S-NPP / MODIS Aqua ≈ 5,4×**
  (intervalo interquartil ≈ 4,3–6,0).
- Spearman ≈ 0,99 e Pearson em log(1+n) ≈ 0,995: as duas séries sobem e descem
  juntas.
- A concordância espacial (Jaccard) chega a ~0,87 na estação seca e cai para
  ~0,2–0,3 na chuvosa.

**Leitura:** o forte acoplamento temporal não autoriza um fator de conversão
único. A razão varia ao longo do ano e a concordância espacial depende da
estação (com poucos focos, cada sensor vê células diferentes). Qualquer fusão
precisará de um modelo condicionado a estação, região e, provavelmente, ao
tamanho/FRP dos focos.

## 3b. Resultados com VIIRS NOAA-20 (Missão 02, 14/11/2026)

O arquivo anual do NOAA-20 (2021–2025), o mesmo satélite do quase tempo real,
ampliou a sobreposição para 60 meses:

| Território | Par | Meses | Razão VIIRS/MODIS (mediana; IQR) | Spearman | Jaccard espacial (mediana) |
|---|---|---|---|---|---|
| Pará | NOAA-20 × MODIS Aqua | 60 | 5,45 (4,57–6,06) | 0,99 | — (grade 0,5°) |
| Portel | NOAA-20 × MODIS Aqua | 60 | 5,98 (5,62–6,89) | 0,94 | 0,38 (grade 0,1°, 36 meses confiáveis) |
| Portel | S-NPP × MODIS Aqua | 24 | 6,03 (4,85–6,98) | 0,99 | — |

Em Portel, na escala de ~11 km, o VIIRS registra atividade em muito mais células
que o MODIS (ex.: out/2021, 134 × 87 células). A diferença de sensibilidade tem,
portanto, componente espacial, e não só de contagem.

**Grade local.** Para territórios recortados sob demanda (municípios), a grade
comum é de 0,1°; meses com menos de 8 células ativas são marcados como pouco
confiáveis e excluídos da mediana do Jaccard.

## 3c. Missão 03 — anomalias, agregação comum e validação fora da amostra

**Anomalias.** Um mês é marcado como incomum quando, frente aos mesmos meses dos
demais anos do mesmo produto (≥ 5 anos), está acima do P90 (ou abaixo do P10) **e**
tem |z robusto| ≥ 1,5, em que z = (n − mediana) / (1,4826 × MAD), **e** difere da
mediana em ao menos 10 detecções. Exigir as três condições evita marcar, em todo mês,
o ano máximo e o mínimo apenas por serem extremos de uma amostra pequena (defeito
encontrado nos testes da regra só com percentil). Exemplos reais (MODIS, Pará):
ago/set/nov 2024 e out 2023 acima; ago/out 2025 abaixo.

**Agregação comum (experimental).** Mesmo território e mês civil; cada sensor é
dividido pela própria média no período comum (índice sem unidade). Mostra a forma
das séries lado a lado sem somar nem converter contagens.

**Validação "deixa um ano de fora".** Para cada ano de sobreposição, a razão
VIIRS/MODIS é estimada só com os demais anos e usada para prever o VIIRS daquele
ano (modelos: razão única e razão por mês do ano). Resultados reais (MODIS Aqua ×
NOAA-20, 2021–2025, meses com ≥ 30 detecções nos dois):

| Território | Modelo | EPA mediano | EPA P90 | Meses |
|---|---|---|---|---|
| Portel | razão única | 15% | 62% | 25 |
| Portel | razão por mês | 16% | 32% | 25 |
| Pará | razão única | 18% | 79% | 60 |
| Pará | razão por mês | 14% | 54% | 60 |

Leitura: o erro típico é moderado, mas a cauda é grande; meses individuais
convertidos podem errar 30–80%. Não há base para publicar uma série harmonizada.

**Conferência independente.** `scripts/validate_history.py` recalcula as contagens
de Portel direto do Parquet (sem SQLite) e compara com a API: MODIS 26.416,
NOAA-20 58.758 e S-NPP 32.767 detecções, zero divergências; calendários = soma
mensal; medianas idênticas; agregados do Pará = linhas do importador.

## 4. Achados da auditoria de versão

O arquivo anual MODIS por país, como publicado em 11/2026, mistura versões entre
anos: 2016–2017 aparecem como `6.2`, 2018–2022 como `6.03` (Coleção 6) e
2023–2025 como `61.03` (Coleção 6.1). Mudanças de coleção alteram algoritmos e
podem introduzir descontinuidades. A interface sinaliza isso e a linha de base
ainda não corrige.

## 5. "Esta atividade é incomum para a época?"

Na análise territorial há duas comparações, cada uma **no mesmo instrumento**:
MODIS NRT × arquivo MODIS (10 anos) e VIIRS NOAA-20 NRT × arquivo NOAA-20 (5 anos).
NOAA-21 não tem série histórica importada. Para cada uma:

- valor atual: MODIS NRT (Terra + Aqua) nos *n* dias UTC completos mais recentes
  cobertos pelo arquivo de 7 dias (*n* ≤ 7, calculado a partir da primeira
  observação disponível);
- linha de base: mesmo intervalo do calendário em cada ano do arquivo MODIS,
  restrito aos satélites presentes no dado atual;
- estatísticas: mediana, P10–P90 e percentil empírico (meio peso para empates),
  calculados só com ≥ 5 anos.

Limitações conhecidas: diferenças NRT × processamento padrão; deriva orbital de
Terra e Aqua (horário de passagem mais cedo em anos recentes); mistura de
coleções na linha de base.

## 6. Sinais de atenção (experimental)

Critérios explícitos, sem índice de risco:

| Sinal | Regra | Aplica-se a |
|---|---|---|
| Atividade persistente | ao menos uma célula de 0,1° (~11 km) com detecção VIIRS (NOAA-20 ou NOAA-21) em ≥ 5 dos últimos *n* dias UTC completos (presença diária, sem soma de contagens) | todos os territórios |
| Acima do usual (MODIS) | contagem MODIS da janela ≥ P90 do mesmo período nos anos anteriores | todos (≥ 5 anos) |
| Acima do usual (NOAA-20) | contagem NOAA-20 da janela ≥ P90 do mesmo período nos anos anteriores | todos (≥ 5 anos) |
| Chuva abaixo da climatologia | precipitação de 14 dias < 50% do esperado pela climatologia NASA POWER 2001–2025 | todos |

Nível: nenhum sinal atendido → "sem sinais"; 1 → "observar"; 2 ou mais →
"examinar com prioridade". **Os limiares são escolhas declaradas para discussão,
sem calibração nem validação operacional.** O nível não indica risco, causa ou
propagação.

## 7. Meteorologia (NASA POWER)

- Valores de reanálise em grade (~0,5° × 0,625°, GEOS-IT/MERRA-2), não
  medições de estação.
- Latência observada: ~2–3 dias (diário) e ~2 dias (horário).
- Comparações com a climatologia usam a **mesma variável**: `T2M` com `T2M`,
  `RH2M` com `RH2M`, `PRECTOTCORR` com `PRECTOTCORR`. O `T2M_MAX` da climatologia
  é a máxima horária do mês e não é comparável com a máxima diária; por isso
  não é usado.
- Previsão: não integrada (o POWER não fornece).

## 7b. Contexto territorial e população

- Áreas oficiais: interseção com o limite IBGE e área geodésica (WGS84, pyproj);
  detecções VIIRS de 7 dias contadas dentro de cada interseção.
- População: total do Censo 2022 (IBGE, tabela 4714) do território inteiro. **Não**
  se estima população afetada a partir da proximidade de detecções.
- Censipam: eventos e índice de prioridade exibidos como indicador externo, sem
  entrar nos critérios; área dos eventos omitida (unidade não documentada).

## 7c. Proximidade e exposição potencial (Missão 03)

- **Proximidade** (estimativa): distância de cada localidade (IBGE BC250 2025) e
  unidade de saúde (CNES) à detecção VIIRS mais próxima dos últimos 7 dias, e
  contagem de detecções a até 1, 5 e 10 km. Projeção azimutal equidistante centrada
  no município. Detecções do retângulo do município ampliado em ~13 km (inclui focos
  logo além da divisa).
- **Exposição potencial** (estimativa, limite superior): população (V0001, Censo
  2022) dos setores censitários com qualquer parte a até 5 km de uma detecção. Como
  soma a população inteira do setor, é ≥ ao número real de residentes no raio.
  Também se informa a medida mais restrita: setores que contêm detecção.
- **Achado de dados:** o GeoPackage de setores do IBGE traz setores multipartes em
  várias linhas com atributos repetidos (Portel: 142 linhas, 91 setores). Sem unir
  por `CD_SETOR`, a população somaria 100.860 em vez de 62.503.
- **Limitação real:** em Portel, a sede e quase todos os setores ficam a até 5 km de
  alguma detecção; o limite superior chega a 99% da população. Por isso ele nunca é
  apresentado como pessoas afetadas, e sim com a ressalva e a medida restrita ao lado.

## 8. Próximos passos para a harmonização

1. Ampliar a sobreposição: S-NPP 2012–2025 e NOAA-20 2018–2020 (2021–2025 já importados).
2. Auditar a cobertura real de observação (grânulos disponíveis, ângulo de
   visada, nebulosidade) e não só os meses presentes.
3. Testes de sensibilidade: confiança, `type = 0`, turno, horário de passagem,
   deriva orbital, coleções MODIS.
4. Modelar a relação MODIS↔VIIRS por estação/região/FRP, com validação cruzada
   temporal (deixar anos de fora).
5. Publicar uma série harmonizada somente com incerteza quantificada.
