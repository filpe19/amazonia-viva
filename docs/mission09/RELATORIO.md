# Missão 09 — Focos com impacto: grau de alerta, confiabilidade, vento, cidades e estradas no caminho, modo histórico (15/11/2026)

Pedido:
- demarcar nos alertas as estradas e cidades que podem ser afetadas;
- grau de alerta;
- veracidade com base no histórico;
- proporção do foco e direção do vento;
- "probabilidade de chegar em tal área";
- filtro de estudo de 1, 2 e 10 anos atrás;
- Amazônia como um todo.

Nada foi commitado, enviado nem publicado.

## O que foi feito

**"Focos e impacto"** (nova visão padrão da aba Alertas; endpoint `GET /api/v1/territory/{id}/hotspots`)
- **Foco** = agrupamento das detecções dos 4 satélites com centros de pixel a ≤ 1,5 km.
- **Proporção**:
  - pixels por satélite e número de passagens;
  - área coberta pelos pixels (scan × track; não é área queimada);
  - FRP da última passagem e duração;
  - **deslocamento observado** entre a primeira e a última passagem (não é previsão).
- **Vento**: modelo numérico Open-Meteo (ECMWF/GFS/ICON), atual e próximas 6 h. No mapa aparecem o **setor a favor do vento** (20 km, ± 30°) e linhas até cada alvo.
- **O que está no caminho**:
  - cidades (sedes do IBGE, até 30 km);
  - localidades (IBGE BC250);
  - rodovias federais (DNIT);
  - terras indígenas (FUNAI; OTCA fora do Brasil);
  - UCs (ICMBio/CNUC) e quilombolas (INCRA).
  - Cada alvo traz distância, direção e se está a favor do vento.
- **Grau de alerta** (escada de regras públicas, sem pontuação):
  - **alto**: confirmado, recente e (dentro de área oficial, pessoas a ≤ 5 km ou alvo a favor do vento a ≤ 10 km);
  - **moderado**;
  - **baixo**.
  - Cada foco mostra **por que** recebeu aquele grau.
- **Confiabilidade da detecção ("veracidade")**:
  - **alta**: ≥ 2 satélites em ≥ 3 passagens, ou coincidente com **evento ativo do Censipam**;
  - **média**: ≥ 2 passagens;
  - **baixa**: uma passagem.
  - Mais o **histórico no local**: em quantos dos 25 anos do arquivo MODIS houve fogo a ≤ 1 km no mesmo mês.
- **Como chegar**: rodovia federal e brigada mais próximas, botão "Rota (Google Maps)" e boletim por WhatsApp.
- **Números reais**:
  - Santarém, 7 dias: 105 focos, 10 altos, 32 moderados. O primeiro tem 8 pixels, 6 passagens e 4 satélites, coincide com evento Censipam ativo, tem a localidade Boa Fé a 5,2 km a favor do vento e o vento está a 2,7 m/s para SO.
  - Pará, 24 h: 963 focos, 90 altos; cidades e rodovias (BR-010, 153, 155, 163…) no caminho.
  - Amazônia, 24 h: 2.628 focos, 175 altos.

**Modo histórico para estudo** (seletor "Período" no mapa: Atual, 1, 2, 5 ou 10 anos atrás)
- Mostra no mapa o mesmo período de anos anteriores, a partir do arquivo FIRMS do Pará (MODIS 2001–2025; VIIRS NOAA-20 2021–2025), e recalcula focos, alvos e graus para aquele período.
- Avisa que só se compara com hoje dentro do mesmo instrumento.
- Endpoints: `GET /api/v1/history/detections` e `/territory/{id}/hotspots?start=&end=`.
- Exemplo: Santarém, 8–14 nov 2016, com 68 detecções e 43 focos.

**Amazônia como um todo**: a região "Amazônia (9 países)" está na busca e no topo do mapa (Amazônia › Pará › município). A visão de focos funciona nessa escala.

## Probabilidade de o fogo chegar a uma área

Não foi calculada, de propósito. Uma probabilidade de chegada exige um **modelo de propagação calibrado**: combustível, umidade, relevo e vento local, validado com perímetros reais. Um número sem isso enganaria quem decide.

Em vez disso, a plataforma mostra os ingredientes verificáveis:
- distância e direção de cada alvo;
- vento de modelo e setor a favor do vento;
- deslocamento observado entre passagens;
- perigo meteorológico (FWI);
- histórico do local.

Isso está declarado na tela, em "Não modelado".

## Testes
- **Backend**: 92 passaram (89 + 3 novos em `tests/test_mission09.py`):
  - grau, vento, alvos com coordenadas, ausência de "probability";
  - modo histórico e validações;
  - agrupamento.
- **Frontend**: tsc ok, vitest 26/26.
- **E2E**: `npm run e2e:map` **53/53** e `npm run e2e` (Portel) **20/20**. Passos novos:
  - focos com grau e regras;
  - probabilidade declarada como não modelada;
  - alvos e setor do vento no mapa;
  - boletim e rota;
  - modo histórico com mapa e focos de 10 anos atrás.
- **Build**: ok.

## Estabilidade

- **Problema**: vários cálculos pesados ao mesmo tempo (Amazônia: TIs, focos, cruzamentos) disputavam o processo Python e deixavam a API lenta, a ponto de o `/health` passar de 20 s.
- **Correção**:
  - fila única para cálculos pesados (`app/core/heavy.py`), um por vez, em thread;
  - cache de 30 min;
  - serialização das detecções fora do laço de eventos;
  - pré-aquecimento em segundo plano.
- **Resultado**: durante os cálculos, a API responde em menos de 1 s na maior parte do tempo, com picos ocasionais de até ~12 s quando chegam respostas muito grandes de fontes externas.

## Limitações
- O vento é de modelo (célula de ~25 km), não medição local. O "a favor do vento" é geométrico.
- Grau e confiabilidade não são calibrados em campo.
- A primeira consulta pesada (Amazônia em 7 dias, focos de um município em 7 dias) pode levar 1–3 min em fila; depois fica em cache por 30 min. Pará e Amazônia (24 h) ficam pré-calculados em segundo plano.
- O modo histórico existe só no Pará (arquivo importado) e não inclui vento nem eventos Censipam do passado.
