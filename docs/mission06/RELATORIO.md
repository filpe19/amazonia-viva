# Missão 06 — Experiência geoespacial e inteligência de fogo (15/11/2026)

URL local: http://127.0.0.1:5710 (API http://127.0.0.1:8710). Nada foi commitado, enviado ao GitHub ou publicado.
Checkpoint anterior à missão: `refs/checkpoints/pre-mission06` (eac30f1). O estado de antes da recuperação de UI continua em `refs/checkpoints/pre-recovery-ui`.

## Diagnóstico anterior (prints `before-*`)

| Problema | Causa no código |
|---|---|
| A legenda dizia "MODIS detection, 375 m" | Texto fixo `detection, 375 m` para todos os produtos. O produto MODIS da FIRMS é de 1 km (FAQ FIRMS: MODIS 1 km, VIIRS 375 m) |
| O FWI dominava o mapa | Raster inserido acima dos rótulos da base, com opacidade de 0,55 |
| Pontos soltos no Pará (2.890 círculos) | Nenhuma agregação automática em escala estadual; círculos uniformes de 2 a 5 px |
| MODIS Terra e Aqua indistintos | A API já trazia o satélite (`s`), mas a simbologia usava só o produto |
| Sem sede, localidades ou hierarquia de nomes | Nenhuma camada de sedes; localidades só como círculos, sem rótulos |
| A legenda era longa e cobria o sul do Pará | Uma linha por camada, sem agrupamento |
| Ficha com SVG solto | Sem mapa-base, sede, escala, norte ou nomes |
| Painel mobile cobria o topo do mapa | Margens do enquadramento não consideravam a barra superior |

## O que foi implementado

**Base cartográfica.** Três modos (ferramenta "Basemap"); a troca preserva as fontes e camadas próprias via `transformStyle`:
- Analítico: Positron discreto.
- Cartográfico: OpenFreeMap Liberty, com rios, estradas e locais habitados.
- Satélite: NASA GIBS, VIIRS NOAA-20 em cor verdadeira, com data escolhida. Um aviso fixo informa a data, que nuvens e falhas de órbita são reais e que não é imagem ao vivo.

Ordem das camadas garantida por código: base → GIBS → FWI → polígonos → contornos → rótulos da base → detecções → localidades e sedes → seleção.

**Navegação.**
- Ferramentas: zoom, voltar à visão do Pará, enquadrar o território, enquadrar as detecções filtradas, mapa-base e localizar coordenada (com marcador e o município que contém o ponto).
- Trilha "Pará › Santarém" para voltar ao estado.
- O enquadramento usa o bbox da geometria IBGE, com margens que preservam a barra superior, as ferramentas e a legenda. Nunca há `flyTo` automático quando os dados atualizam.
- Agregação só em escala estadual (zoom < 7). Um município selecionado sempre mostra detecções individuais.

**Referências geográficas.**
- Sedes municipais do IBGE BC250 2025 (tipos Cidade e Capital): 144 de 144 municípios. A sede do município selecionado aparece em destaque, com estrela e nome em negrito.
- A partir do zoom 5,6, os rótulos de cidades do OSM dão lugar às sedes do IBGE, para não haver nomes duplicados.
- Localidades BC250 viram pontos pequenos a partir do zoom 9 e rótulos a partir do 9,6, com prioridade para vilas.
- Rios e estradas vêm da base OSM.

**Simbologia das detecções.**
- Cor por satélite: NOAA-20 âmbar, NOAA-21 azul, Aqua verde e Terra magenta `#b8458a`, validado com o validador de CVD.
- Forma por sensor: círculo para VIIRS 375 m, quadrado para Aqua e losango para Terra (MODIS 1 km).
- Idade: ≤ 6 h com anel escuro, 6–24 h normal, > 24 h esmaecido.
- Tamanho fixo, com aviso na legenda.
- Realce ao passar o mouse (tooltip com satélite, horário e FRP) e anel no ponto selecionado.
- Os grupos mostram a contagem por satélite, avisam que não são incêndios e oferecem "Aproximar para investigar".
- A legenda é o próprio filtro: quatro botões, agrupados em VIIRS e MODIS, com contagens. Desligar um satélite muda de fato os dados exibidos, a tabela e as contagens.

**Investigação de um ponto.** A aba Observação tem seis blocos (A–F):
- A, observação: satélite, sensor, coleção e resolução; horário UTC e local (UTC−3); coordenadas; confiança interpretada por produto; FRP com a ressalva. Uma tabela traz os atributos originais com unidades, omitindo campos ausentes em vez de mostrar zero.
- B, posição: município pelo polígono IBGE; distância e rumo até a sede; localidade mais próxima; territórios oficiais a até 10 km, com distância até a borda.
- C, histórico: célula da série escolhida, mediana harmonizada e incerteza de validação (erro mediano deixa-um-ano-de-fora).
- D, ambiente: NASA POWER no ponto, com a observação de que o FWI não tem valor por ponto.
- E, contexto humano: localidades a ≤ 5 km, unidades de saúde a ≤ 10 km e população municipal, com as ressalvas.
- F, ações: aproximar, abrir a análise territorial, abrir a ficha, exportar a evidência em JSON e abrir o arquivo de origem na FIRMS. Mostra também o horário de obtenção, o Last-Modified do arquivo e o SHA-256.

**FWI.**
- Desligado por padrão, com opacidade de 35% ajustável.
- Legenda oficial, data, fonte e nota de que é um índice adimensional de perigo, não extensão de fogo.
- Antes de ligar, um tile real é testado; se a fonte não responder, a camada fica oculta e marcada como indisponível.

**Inteligência espacial.**
- Detecções por município, um satélite por vez, como camada estadual em rampa ardósia (distinta da recorrência marrom e do FWI).
- Ranking "Onde no estado?" com os municípios clicáveis.
- Contagens separadas para NOAA-20, NOAA-21, Aqua e Terra.
- Recorrência com série selecionável: NOAA-20 2021–2025 ou MODIS 2001–2025.

**Ficha.** Mapa de evidências em MapLibre, com:
- base discreta, sede, vilas, municípios vizinhos, contorno em destaque;
- detecções pelos quatro satélites e polígonos sutis;
- escala, norte e legenda organizada, com a contagem por satélite e o período;
- créditos e fontes.

Para o PDF, o canvas vira imagem (`preserveDrawingBuffer`), o que foi validado em `after-ficha.pdf`. Se o WebGL falhar, volta o SVG antigo.

**Backend.**
- `GET /api/v1/regions/{id}/seats` (IBGE BC250, consulta CQL com cache de 30 dias).
- O detalhe da detecção ganhou `product`, `units`, `attributes_doc` e `provenance` (URL do arquivo FIRMS, horário de obtenção, Last-Modified, SHA-256, latência nominal).
- Fórmulas científicas inalteradas; banco e histórico intocados.

**Performance.**
- Uma única fonte GeoJSON com agregação nativa, em vez de duas cópias.
- Grade de recorrência e sedes carregadas só quando usadas.
- Consultas canceladas pelo `AbortSignal` do TanStack Query.
- Nenhuma requisição concluída em duplicidade: as cópias em dev são o cancelamento do StrictMode.
- Heap JS entre 80 e 113 MB. Santarém fica pronto em cerca de 3,5 s.

## Fontes e endpoints
- NASA FIRMS NRT (arquivos públicos de 7 dias: VIIRS C2 NOAA-20/21 e MODIS C6.1) e arquivo anual.
- IBGE: malhas v3 e WFS BC250 2025 (`CCAR:BC250_2025_lml_posic_geo_localidade_p`).
- NASA GIBS WMTS `VIIRS_NOAA20_CorrectedReflectance_TrueColor`.
- Copernicus GWIS WMS `ecmwf.fwi`.
- NASA POWER.
- Censipam GeoServer (ICMBio, CNUC, FUNAI, INCRA).
- CNES.
- OpenFreeMap (Positron, Liberty), © OpenStreetMap.
- API própria: `/detections`, `/detections/{produto}/{id}`, `/regions/{id}/seats`, `/regions/para/municipalities`, `/history/grid`, `/territory/{id}/context|impact|brief`.

## Testes
- Backend: **81 passed** (78 + 3 novos: proveniência do detalhe, sedes do IBGE e falha do WFS virando erro explícito). `ruff` limpo.
- Frontend: `tsc` ok, **vitest 20/20** (11 + 9 novos de simbologia e geografia), build ok.
- E2E `npm run e2e` (Portel): **19/19**.
- E2E novo `npm run e2e:map`: **28/28**, cobrindo:
  - os 16 passos pedidos;
  - console sem erros e nenhuma resposta 5xx da API;
  - atributos exibidos iguais aos da API;
  - FWI abaixo das detecções e do limite;
  - layout mobile sem rolagem lateral.

  Falhas transitórias de tiles externos (GIBS) aparecem como aviso, não como falha.

## Prints
- `before-*`: Pará, Santarém, Santarém com FWI, ficha e mobile.
- `after-*`: os mesmos, mais `after-santarem-7d`, `after-hover`, `after-observation(-2)`, `after-close-zoom`, `after-basemap-{cartographic,satellite,analytical}`, `after-fwi`, `after-para-distribution`, `after-para-cluster`, `after-ficha-map`, `after-ficha.pdf`, `after-mobile-*` e `after-desktop-observation-ptbr`.
- `iter*`: iterações intermediárias.

## Limitações
- FWI sem valor por ponto: o GWIS não oferece GetFeatureInfo.
- A imagem do GIBS é diária, tem nuvens e perde nitidez acima do zoom 9 (nível máximo da camada).
- Horário de disponibilização: o FIRMS não publica o horário por linha. Usamos o Last-Modified do arquivo e a latência nominal (< 3 h).
- Localidades BC250 em escala 1:250.000: comunidades pequenas podem faltar. Os nomes vêm como publicados, por exemplo "M0aca".
- Distâncias de círculo máximo; distância até um polígono por projeção local (adequada para dezenas de km).
- Área queimada, cobertura vegetal, vulnerabilidade e fumaça não são avaliadas.

## Pendências
- Autorizar o commit e o push para o GitHub.
- Materiais obrigatórios da submissão: README em inglês, vídeo de até 30 s ou até 7 slides, resumo PT/EN e aviso de uso de IA.
- Prazo: 15/11/2026, 23h59.
