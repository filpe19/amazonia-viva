# Missão 07 — Alertas, imagem de alta resolução, camadas e ficha analítica (15/11/2026)

URL local: http://127.0.0.1:5710 (API http://127.0.0.1:8710). Nada foi commitado, enviado ao GitHub nem publicado.
Estado anterior preservado em `refs/checkpoints/pre-mission06` e no diff de trabalho (nenhum arquivo de outra sessão foi revertido).

## O que o usuário pediu e o que foi feito

| Pedido | Entrega |
|---|---|
| "Não sei onde ficam os alertas" | Aba **Alertas** (aberta por padrão, com contador) e botão "N sinais de alerta" no topo do mapa |
| Satélite "igual ao Google", vendo casas | Mapa-base **Imagem de alta resolução** (Esri World Imagery, Vantor/Maxar até 0,3 m) com data e resolução da cena; link "Abrir no Google Maps (satélite)" em cada detecção |
| Pontos/focos melhores | Halo vermelho nas detecções que atendem a um critério; **área real do pixel** (scan × track) desenhada a partir do zoom 10 |
| Ficha "a mais rica" | Nova seção 6 **"Onde as detecções tocam territórios, pessoas e floresta?"** e polígonos DETER no mapa de evidências |
| Camadas mais intuitivas | Aba Camadas reorganizada: visões prontas, mapa-base, grupos por pergunta, interruptores, detalhes recolhidos |
| Cruzar dados e harmonizar | Serviço de cruzamento espacial (shapely STRtree) com FUNAI, ICMBio, CNUC, INCRA, IBGE, CNES e **INPE DETER**; proporções por satélite e "vista por N de 4 satélites" |

## Sinais de atenção ("Alertas")

Endpoint `GET /api/v1/territory/{id}/attention?window=24h|48h|7d`. Cada sinal é um **fato verificável com critério fixo e público**:

- centro do pixel **dentro** de terra indígena, unidade de conservação, território quilombola ou assentamento (e "perto do limite", fora, a ≤ 2 km);
- **localidade** do IBGE a ≤ 1 km (≈ pixel VIIRS + erro de posição);
- **unidade de saúde** do CNES a ≤ 5 km (por município);
- centro do pixel dentro de **aviso DETER** dos últimos 12 meses (por município).

Regras: sem pontuação, peso ou índice de risco; contagens por satélite, nunca somadas; "Vista por N de 4 satélites" é concordância entre sensores, não número de incêndios; o texto diz que não são alertas oficiais e indica com quem confirmar. Fontes indisponíveis aparecem como indisponíveis, sem zerar os demais sinais.

Também na aba: sinais temporais do mesmo território (atividade acima do histórico no mesmo instrumento, persistência, chuva abaixo da climatologia). Na escala do Pará, a aba lista os "Municípios com mais sinais", clicáveis, com as categorias de cada um. Clicar num sinal enquadra o mapa, destaca o território e os halos e lista as detecções, que abrem a investigação A–F.

Resultado real (7 dias, 15/11): Santarém tem 33 sinais. Entre eles, a Resex Tapajós-Arapiuns com 40 detecções dentro, vista por 4 de 4 satélites; 4 localidades com detecção a ≤ 1 km; 13 unidades de saúde a ≤ 5 km; e 18 detecções sobre avisos DETER. No Pará, na janela de 24 h, são 238 sinais em 84 municípios.

## Imagem de alta resolução

- Tiles do Esri World Imagery, com atribuição "Esri, Vantor, Earthstar Geographics, and the GIS User Community".
- A data, a resolução e o satélite da cena no centro do mapa vêm do serviço público de metadados da Esri. Exemplos: em Santarém, cena Vantor LG03 de 0,34 m de 23/10/2025; no centro, GE01 de 0,46 m de 27/08/2022.
- O aviso diz que **não é imagem atual**. Abaixo do zoom 11, informa que o mosaico é TerraColor de 15 m, sem data única.
- O modo "Satélite do dia" (NASA GIBS, VIIRS diário) continua disponível para fumaça e nuvens da data.
- **Licença:** os metadados remetem ao Esri Master License Agreement. Para uso público, configurar `VITE_ARCGIS_API_KEY` com chave gratuita do ArcGIS Location Platform; o código já anexa o token se a variável existir. *Decisão do usuário antes de publicar.*

## Ficha (seção 6 nova)

- **Proporção por satélite** das detecções dentro de áreas protegidas, terras indígenas e quilombolas: cada sensor dividido pelo próprio total. Isso torna VIIRS e MODIS comparáveis sem somar contagens.
  - Exemplo em Santarém: NOAA-20 7,4%, NOAA-21 4,7%, Aqua 6,9%, Terra 3,8%.
  - Nos assentamentos os quatro sensores concordam: 62–71%.
- Matriz critério × satélite com barras proporcionais, número de alvos e data mais recente.
- Lista dos territórios oficiais com detecções dentro.
- DETER/INPE nos últimos 12 meses: classes, polígonos, área dentro do limite IBGE, imagem mais recente e detecções sobre os avisos, com a ressalva de que coincidência não é causa e de que DETER não é o PRODES.
- O mapa de evidências ganhou os polígonos DETER (desmatamento e cicatriz de incêndio).
- O JSON da ficha inclui `cross_check`.

**Correção encontrada na validação:** a atribuição municipal do INPE (`mun_geocod`) não segue o limite IBGE vigente. Áreas de Mojuí dos Campos aparecem atribuídas a Santarém: 704 polígonos e 672 km² de cicatrizes. Agora o DETER é consultado por retângulo e recortado pelo mesmo limite IBGE das detecções: 457 polígonos e 375 km².

## Camadas

- **Visões prontas:** Investigar impacto, Comparar com o histórico, Perigo meteorológico, Mapa limpo.
- **Mapa-base** em 4 opções, com explicação.
- **Grupos:**
  - Detecções de satélite;
  - Alertas e cruzamentos;
  - Territórios oficiais;
  - Pessoas e infraestrutura;
  - Mudança na floresta (INPE);
  - Histórico;
  - Meteorologia.
- Interruptores acessíveis (`role=switch`), estado só quando há algo a dizer e botão "i" para fonte, resolução, significado e limitação.
- **Camadas novas:**
  - Área do pixel (scan × track);
  - Detecções marcadas pelos critérios;
  - Avisos DETER (12 meses).

## Backend

- `app/integrations/deter.py`: WFS público do TerraBrasilis, com cache de 6 h e cópia anterior em caso de falha.
- `app/services/attention_service.py`: projeção azimutal equidistante e STRtree, com cache em memória de 10 min por região, janela e arquivos FIRMS.
- Rotas novas: `/territory/{id}/attention` e `/territory/{id}/deter`.
- O GeoJSON compacto das detecções ganhou `sc`/`tr` (scan/track, km) para desenhar a área do pixel.
- Fórmulas científicas, banco e histórico inalterados.

## Testes

- Backend **85 passed** (81 + 4 novos em `tests/test_mission07.py`):
  - sinais no município;
  - fonte indisponível explícita;
  - escala estadual e camada DETER;
  - `sc`/`tr`.
- `ruff` limpo.
- Frontend: `tsc` ok, **vitest 25/25** (20 + 5 novos: filtro por satélite, metadados da imagem, área do pixel), build ok.
- E2E `npm run e2e:map` **41/41**. Os 13 passos novos cobrem:
  - alta resolução com data da cena;
  - contagem da aba igual à da API e aviso de não oficial;
  - ausência de pontuação;
  - sinal enquadrado com halos;
  - área do pixel;
  - link do Google Maps;
  - camada DETER e visão "Mapa limpo";
  - seção de cruzamento na ficha.
- E2E `npm run e2e` (Portel) **20/20**, com a aba de alertas aberta por padrão.

## Prints (`docs/mission07/`)

- **Pará:** `para-alerts`.
- **Santarém:** `stm-alerts`, `stm-alert-focus`, `stm-deter-focus`, `stm-layers`, `stm-imagery-z15` (casas visíveis, cena datada).
- **Ficha:** `ficha-top`, `ficha-crosscheck`.
- **Português:** `ptbr-desktop-alerts`, `ptbr-desktop-layers`, `ptbr-mobile-alerts`.
- **Antes:** `docs/mission06/after-*`.

## Limitações

- Sinais são triagem por coincidência espacial: não medem risco, dano, causa nem propagação, e não substituem alertas oficiais.
- Localidades BC250 (1:250.000) omitem comunidades pequenas. O CNES tem coordenadas declaradas. O DETER cobre só a máscara de floresta e atrasa com nuvens.
- Na escala estadual, CNES e DETER não são cruzados (seria uma consulta por município). A lista de detecções de cada sinal é limitada (400 por município, 40 no estado), com aviso.
- A orientação da área do pixel é aproximada (norte–sul; o real é inclinado ~9°).
- A data da imagem Esri vale para o centro da vista; o mosaico pode combinar cenas de datas diferentes.

## Pendências (decisão do usuário)

1. Autorizar commit e push (link público obrigatório na submissão).
2. Licença Esri para uso público (chave gratuita) ou manter só "Satélite do dia" na versão publicada.
3. Texto do aviso de uso de IA exigido pelo regulamento.
4. README em inglês, vídeo ≤ 30 s ou até 7 slides e resumo PT/EN. Prazo: 15/11/2026, 23h59.
