# Missão 08 — Alertas para terras indígenas, origem do calor e Amazônia inteira (15/11/2026)

Pedido após a reunião com os mentores:
- auditoria crítica;
- alertas com **impacto social** para terras indígenas;
- "esse foco é incêndio mesmo ou é garimpo?";
- vias e áreas demarcadas;
- **a Amazônia como um todo**.

Auditoria: [AUDITORIA.md](AUDITORIA.md). Nada foi commitado, enviado nem publicado.

## Entregas

**Amazônia (9 países)**
- Nova região selecionável na busca e na trilha (Amazônia › Pará › município), com limite tracejado em todas as escalas.
- Brasil: Amazônia Legal pela Lei Complementar 124/2007 (8 UFs mais o Maranhão a oeste de 44° W), a partir das malhas do IBGE.
- Demais países: capa combinada da OTCA, via Censipam.
- 7,83 milhões de km², sendo 5,02 milhões no Brasil, o que bate com a área oficial.
- Script reproduzível: `python -m scripts.fetch_amazonia`.

**Alertas para terras indígenas**
- Endpoint `GET /api/v1/territory/{id}/indigenous`; é a visão padrão da aba Alertas.
- Regras públicas:
  - fogo dentro, confirmado por ≥ 2 passagens;
  - fogo dentro, uma passagem;
  - fogo só no entorno (≤ 10 km);
  - selo "≤ 24 h".
- Cada terra traz:
  - povos, fase e unidade regional da FUNAI;
  - pessoas indígenas residentes (Censo 2022, IBGE tabela 9719);
  - detecções por satélite, dentro e no entorno;
  - rodovia federal mais próxima (DNIT) e brigada cadastrada mais próxima (Censipam);
  - indícios de garimpo e mineração (ANM) e de desmatamento ou cicatriz (DETER).
- **Boletim** pronto para copiar ou enviar por WhatsApp, com fontes e a ressalva de que não é alerta oficial.
- Canais públicos: Bombeiros 193, Defesa Civil 199, Ibama Linha Verde 0800 061 8080.
- No mapa, as terras com alerta aparecem destacadas e nomeadas; clicar enquadra a terra e destaca as detecções.
- Resultados reais (7 dias):
  - **Pará**: 26 TIs com fogo dentro (19 confirmadas), 41.771 pessoas indígenas residentes e 27 povos.
  - **Amazônia**: 465 TIs com fogo dentro (246 confirmadas), 260.639 pessoas indígenas e 94 povos.
  - **Santarém**: nenhuma TI com fogo dentro; Cobra Grande e Maró têm fogo no entorno, a 0,2 e 0,7 km do limite.

**"É incêndio mesmo?"** (bloco novo na aba Observação; endpoint `/detections/{produto}/{id}/evidence`)
- Confirmação por outras passagens a ≤ 1 km em ± 24 h.
- Baixa confiança.
- Fonte estática (FIRMS type 2 no arquivo) e histórico do local (anos com detecção a ≤ 500 m).
- Garimpo e mineração (ANM): dentro de título ou reserva garimpeira.
- DETER: desmatamento, cicatriz, mineração, degradação, corte seletivo.
- Uma leitura por regra explícita, com 5 desfechos possíveis e sem diagnóstico.

**Ficha**: a seção 6 abre com a tabela "Terras indígenas com fogo dentro ou a até 10 km" (população, alerta, detecções, indícios, unidade da FUNAI). O JSON exportado inclui `indigenous_alerts`.

**Correções encontradas na auditoria e nos testes**
- **API travava durante o cálculo pesado**: na escala da Amazônia, o cálculo geométrico (~60 s) rodava no laço de eventos e bloqueava todas as rotas. Agora roda em thread, pedidos iguais simultâneos compartilham um cálculo, e Pará e Amazônia (24 h) ficam pré-aquecidos em segundo plano. O `/health` responde em ~0,01 s durante o cálculo.
- **Painel vazio na Amazônia**: se o usuário tinha escolhido "Todos os cruzamentos" no Pará, ao abrir a Amazônia o painel ficava vazio. Agora volta para "Terras indígenas" quando a outra visão não existe.
- **ANM**: o servidor não envia o certificado intermediário. A cadeia foi completada com o intermediário oficial da Sectigo (`app/core/certs`), e a verificação TLS continua ativa.
- **ANM, formato**: a saída `geojson` do servidor volta vazia; passou-se a usar Esri JSON.
- **DETER**: já corrigido na Missão 07, com recorte pelo limite IBGE.

## Fontes novas
- **IBGE SIDRA 9719**: população residente em terras indígenas, Censo 2022, nível N125 (TI por UF).
- **Censipam GeoServer**:
  - `funai_terra_indigena` (com `cr`/`undadm` = unidade regional da FUNAI);
  - `dnit_rodovias_federais`, `tb_brigada_pto`;
  - `otca_capacombinada_cuencaamazo_act2`, `otca_amazonia_indigenous_land`.
- **ANM SIGMINE**: `MapServer/0` (processos ativos) e `/4` (reservas garimpeiras).
- **IBGE malhas v3**: estados da Amazônia Legal.

## Testes
- **Backend: 89 passed** (85 + 4 novos em `tests/test_mission08.py`):
  - alerta de TI com população, povos, unidade da FUNAI, rodovia, brigada e garimpo;
  - leitura "contexto de mineração" e confirmação por outro satélite;
  - região Amazônia;
  - utilitários.
- `ruff` limpo.
- **Frontend**: `tsc` ok, **vitest 26/26** (novo: boletim) e build ok.
- **E2E**: `npm run e2e:map` **47/47** e `npm run e2e` (Portel) **20/20**. Passos novos:
  - visão de TI e boletim com ressalva;
  - TI destacada no mapa;
  - leitura "É incêndio mesmo?";
  - tabela de TI na ficha;
  - região Amazônia.

## Prints (`docs/mission08/`)
- **Pará**: `en-para-indigenous`, `en-para-ti-focus`.
- **Detecção**: `en-heat-source`.
- **Amazônia**: `en-amazonia-indigenous`.
- **Português**: `pt-para-indigenous`, `pt-para-ti-focus`, `pt-heat-source`, `pt-amazonia-indigenous`.

## Limitações
- População = residentes na TI (Censo 2022), não pessoas afetadas. O casamento com o IBGE é por nome e UF; TIs sem par aparecem como "não publicada".
- Os indícios de origem (ANM, DETER) só são avaliados para as 20 TIs com mais detecções dentro e só no Brasil. O resultado da ANM pode ser parcial.
- Fonte estática e histórico local só existem no Pará (arquivo importado).
- Distâncias em linha reta. Brigada = registro do Censipam, sem disponibilidade ou tempo de deslocamento.
- Escala amazônica: cerca de 45 s na primeira consulta (cache de 10 min). São listadas todas as TIs com fogo dentro e as 150 de entorno mais recentes.
- Não há histórico nem notificação ativa de alertas.

## Pendências (decisão do usuário)
1. Commit e push (link público obrigatório).
2. Licença Esri para publicar a imagem de alta resolução.
3. Aviso de uso de IA.
4. README em inglês, vídeo ou slides e resumo PT/EN, antes das 23h59 de hoje.
