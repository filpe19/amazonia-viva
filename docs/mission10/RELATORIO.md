# Missão 10 — Pop-ups no mapa, filtros no próprio mapa e visualização do impacto (15/11/2026)

Pedido:
- ao navegar com o mouse, o mapa não dizia o que é cada área;
- faltavam filtros no próprio mapa;
- o impacto precisava ser mais visual e analítico: terra indígena, cidades e estradas no caminho do fogo e do vento.

Nada foi commitado, enviado nem publicado.

## O que foi feito

**Pop-up ao passar o mouse** (um pop-up único que mostra até 3 feições sob o cursor; pontos têm prioridade):
- **Terra indígena**: nome, povos, fase, unidade da FUNAI.
- **Unidade de conservação**: nome, categoria, grupo (PI/US), criação.
- **Quilombola**: nome, famílias (INCRA).
- **Assentamento**: nome, famílias (INCRA).
- **Rodovia federal**: BR, pavimento, trecho de/até (DNIT).
- **Aviso DETER**: classe, data da imagem, área.
- **Célula de recorrência**: detecções no arquivo.
- **Foco**: grau, pixels, passagens, área, vento, principal alvo e "clique para ver o impacto".
- **Setor a favor do vento**: o que é e o aviso de que não é previsão.
- **Áreas e rodovias no caminho do foco selecionado.**
- Detecções, sedes, localidades e unidades de saúde já tinham pop-up.

**Filtros rápidos no próprio mapa** (botões sobre o mapa): Focos, Terras indígenas e áreas protegidas, Assentamentos, Rodovias federais, Cidades, Localidades, DETER, Perigo de fogo (FWI). Os que só existem por município ficam desativados, com explicação.

**Camadas novas, em todas as escalas** (endpoint `GET /api/v1/territory/{id}/map-layers`):
- terras indígenas, UCs federais e estaduais, quilombolas, assentamentos (por município) e rodovias federais do DNIT;
- com atributos e simplificação por escala;
- antes, as áreas protegidas só apareciam com um município selecionado.

**Focos sempre visíveis no mapa** (marcadores por grau). Clicar num foco abre o card na aba Alertas.

**Impacto do foco selecionado, no mapa**:
- anéis de 5, 10 e 20 km;
- seta do vento (modelo) e setor a favor do vento;
- linhas até cada alvo, com marcadores por tipo (cidade, localidade, TI, UC, quilombola, rodovia);
- **terras indígenas, UCs e quilombolas no caminho realçadas em vermelho**;
- **trecho da rodovia federal próxima realçado**.

**Radar de impacto** (no card do foco):
- diagrama com o foco no centro e o norte para cima;
- anéis de 5, 10 e 20 km;
- setor a favor do vento;
- cada alvo na direção e distância reais;
- alvos a favor do vento com anel;
- cidades além de 20 km na borda.

Exemplo real: **Portel, 7 dias**.
- 6 focos em alerta alto.
- O primeiro fica 6,7 km a NE de Amparo. A localidade Amparo está a favor do vento (2,6 m/s para SO).
- Meritituba está a 7,7 km, fora do setor do vento. A cidade de Portel está a 29,9 km NO, também fora.
- O foco coincide com evento ativo do Censipam. Houve fogo a ≤ 1 km em 2 dos novembros do arquivo MODIS.

## Testes
- **Backend**: 93 passed (+1: camadas de referência com atributos).
- **Frontend**: tsc ok, vitest 26/26.
- **E2E** (`npm run e2e:map`). Passos novos:
  - radar no card;
  - anéis e seta do vento no mapa;
  - filtro rápido liga e desliga rodovias;
  - pop-up sobre terra indígena, UC ou quilombola com a fonte.
- **Resultado**: `npm run e2e:map` **57/57** e `npm run e2e` (Portel) **20/20**; build ok.
- **Correção vinda do teste**: o marcador do foco cobria a detecção quando o foco tinha um pixel só, e o clique abria o foco em vez da investigação da detecção. Agora o marcador é um anel (o símbolo do satélite continua visível) e o clique na detecção tem prioridade.

## Limitações
- Rodovias: só as federais (DNIT). Estaduais e vicinais aparecem no mapa-base cartográfico, mas não nos cálculos.
- O realce da rodovia mostra os trechos da BR num raio de ~30 km do foco, não só o ponto mais próximo (este aparece como marcador com a distância).
- Na escala amazônica, as camadas de referência trazem só terras indígenas da FUNAI e rodovias (UCs dos 9 países não incluídas).
