# Recuperação de UI/UX — Centro de Situação (15/11/2026)

URL local: http://127.0.0.1:5710 (API em http://127.0.0.1:8710)
Checkpoint anterior à missão: `refs/checkpoints/pre-recovery-ui` (5a73a6d). Para voltar: `git checkout refs/checkpoints/pre-recovery-ui -- .`

## Antes × depois

| Tela | Antes | Depois |
|---|---|---|
| Atividade (desktop) | `before-desktop-situation.png`: mapa começava em y=337 e ocupava ~45% da tela; lateral era só uma lista | `after-desktop-situation.png`: mapa em altura total e ~70% da largura, painel de inteligência ao lado |
| Atividade (celular) | `before-mobile-situation.png`: mapa abaixo da dobra | `after-mobile-situation.png`: mapa em 68vh logo no topo, abas do painel abaixo |
| Clique numa detecção | trocava de município se o clique caísse no vizinho; sem explicação da observação | `after-desktop-observation.png`, `after-mobile-observation.png`: 5 blocos e o território continua o mesmo |
| Camadas | só pontos e limite | `iter2-desktop-layers.png`, `after-desktop-fwi-layer.png`: recorrência, FWI, áreas protegidas, assentamentos, localidades, saúde e célula POWER |
| Histórico | `before-desktop-history.png`, `before-desktop-harmonization.png`: calendário poluído com "~" | `after-desktop-history.png`, `after-desktop-seasonal.png`, `after-mobile-seasonal.png` |
| Fonte fora do ar | não testado; unidades protegidas apareciam como **0** quando a API caía | `outage-partial-desktop.png`, `outage-api-down-desktop.png` |
| PT-BR | — | `after-desktop-situation-ptbr.png` |
| Demais páginas | — | `after-{desktop,mobile}-{territory,ficha,environment,evidence}.png` (sem overflow horizontal) |

## O que mudou

**Centro de Situação** (`frontend/src/pages/CurrentSituation.tsx`, `features/situation/*`)
- O mapa é o protagonista. A barra sobre o mapa traz o território, a janela (24 h/48 h/7 d), dia ou noite, os satélites e o CSV. O relógio mostra a última observação e a sincronização com a FIRMS, e a legenda acompanha as camadas ativas.
- O painel de inteligência tem três abas: Território, Observação e Camadas.
- A aba Território mostra 4 dimensões independentes, sem índice único:
  1. **Atividade de fogo:** contagens por satélite, FRP, barras diárias de 7 dias, comparação com o histórico (MODIS × arquivo, NOAA-20 × arquivo, série harmonizada experimental) e o contexto sazonal do mês.
  2. **Perigo meteorológico:** chuva de 14 dias × climatologia, UR, Tmáx e vento do NASA POWER. O FWI do GWIS entra como camada do mapa, porque o serviço não oferece valor por ponto.
  3. **Exposição humana potencial:** população do Censo 2022, localidades e unidades de saúde a ≤ 5 km, limite superior por setor censitário e brigada mais próxima.
  4. **Impacto ambiental potencial:** áreas protegidas, TIs e assentamentos. Área queimada e cobertura vegetal aparecem como "Não avaliado".
- O rodapé separa perigo, exposição, vulnerabilidade (não avaliada) e dano observado (não avaliado).
- A aba Observação abre ao clicar numa detecção real e tem 5 blocos: o que foi detectado, contexto histórico (célula de 0,1° e mediana harmonizada), contexto ambiental (POWER no ponto), contexto territorial (área protegida que contém o ponto, localidades e unidade de saúde mais próximas) e o que requer atenção.
- A aba Camadas organiza os grupos A–F com origem, data, resolução, significado e limitação. Uma camada só aparece como disponível se a fonte respondeu: o FWI é testado com um tile real antes de ser ligado.

**Histórico** (`components/HarmonizedSection.tsx`)
- O prefixo "~" saiu. A hachura passou a marcar os meses MODIS convertidos.
- Novo **Perfil sazonal e comparação de anos**: faixa P10–P90 de todos os anos, mediana tracejada, ano A e ano B escolhidos pelo usuário e intervalo de conversão sombreado nos meses convertidos.
- Nenhuma fórmula foi alterada. Os valores vêm de `/history/harmonized`.

**Backend**
- Novo `GET /api/v1/history/grid`: recorrência por célula de um único produto (total, anos ativos, meses ativos, média por ano), sem somar sensores. Em Portel são 214 células de 0,1° (2021–2025).
- Teste novo: `test_camada_de_recorrencia_por_celula`.

**Estados de indisponibilidade** (corrigidos nesta rodada)
- Quando a API ou o contexto falham, aparece erro explícito com "Tentar novamente", e não mais **0**.
- Se parte das camadas oficiais falha, a contagem aparece como "≥ N" ou "—", com o aviso "X de 4 camadas não responderam".
- Se a detecção falha, o mapa mostra um aviso sobreposto.
- Se o GWIS não responde, a camada FWI é ocultada e marcada como indisponível.

**Idioma**: interface em inglês para a demonstração. Foram adicionadas 190+ traduções PT-BR, e textos do backend em português passam por `sourceCopy`.

## Fluxo testado (E2E automatizado — `npm run e2e`, 19/19 ok)
1. No Pará, clique real no polígono de Portel: Portel fica selecionado.
2. Relógio com hora UTC e as 4 dimensões preenchidas com dados reais.
3. Clique numa detecção real (id 69affdc60a20ba3a): 5 blocos, e o território continua Portel.
4. Liga a recorrência histórica: a legenda "Recurrence 2021–25" aparece.
5. Histórico: perfil sazonal com anos de 2002 a 2025, troca do ano B.
6. Análise territorial: MODIS × arquivo, chuva/umidade/vento, pessoas e infraestrutura.
7. Ficha: as 7 perguntas, exportação JSON e CSV de proximidade, sem erros de página.

## Testes
- Backend: **78 passed** (77 anteriores + 1 novo). `ruff` limpo.
- Frontend: `tsc` ok, vitest 11/11, `vite build` ok.
- Simulação de falha (Playwright com rotas interceptadas): parcial (impacto, grade, série harmonizada, TI e INCRA) e API inteira fora do ar.

## Fontes de dados usadas na tela
NASA FIRMS (NRT e arquivo anual), NASA POWER, Copernicus GWIS (FWI, WMS), IBGE (malhas v3, Censo 2022, BC250 2025), Censipam (API e GeoServer: FUNAI, ICMBio, CNUC, INCRA, brigadas), CNES, OpenFreeMap/OSM (mapa base).

## Pendências e limitações
- O FWI não tem valor por ponto, porque o GWIS não oferece GetFeatureInfo. Ele aparece só como camada com a legenda oficial.
- A recorrência usa só NOAA-20 (2021–2025). No mapa não há harmonização, que existe apenas na série temporal.
- Área queimada, cobertura vegetal e vulnerabilidade não estão integradas e aparecem como "Não avaliado".
- Os scripts Python de E2E do outro agente (`e2e/ux_flow.py`, `i18n_flow.py`, `mission05_flow.py`, `visual_audit.py`) não foram reexecutados. O fluxo oficial é `portel-flow.mjs`.
- Nada foi commitado nem publicado. Commit, push e deploy dependem de autorização.
