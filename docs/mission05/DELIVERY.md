# Missão 05 — entrega técnica do Amazônia Viva

> Registro da entrega original. A alternância PT-BR/EN foi implementada posteriormente; consulte a [entrega de internacionalização](../i18n/README.md).

A aplicação existente foi refinada para três experiências: **Current activity**, **Fire history** e **Territory analysis**. A demonstração está em inglês. Backend, arquivos históricos, fórmulas científicas e endpoints foram preservados.

## Aplicação local e recuperação

- Web: http://127.0.0.1:5710/?regiao=para
- Piloto: http://127.0.0.1:5710/?regiao=portel
- Histórico: http://127.0.0.1:5710/historico?regiao=portel
- API: http://127.0.0.1:8710/docs
- Projeto: `/Users/felipealsouza/Projetos/amazonia-viva`.
- Foram reutilizados Vite e Uvicorn já existentes; nenhuma segunda instância foi iniciada.
- O repositório estava sem commits e com seus arquivos não rastreados. O estado anterior foi preservado em `/Users/felipealsouza/Backups/amazonia-viva-before-mission05-20261114-225010/source.tar.gz`, com manifesto SHA-256 de 113 arquivos. Credenciais, dependências e dados de execução foram excluídos desse arquivo de recuperação. Não houve reset do banco nem importação de novas bases.
- Os **66 arquivos do backend** presentes no manifesto continuam idênticos: [integridade](backend-integrity.json).

## Skills verificadas e aplicadas

As duas skills obrigatórias estavam acessíveis no ambiente local e foram lidas antes da implementação:

- [frontend-design](/Users/felipealsouza/.claude/plugins/marketplaces/anthropic-agent-skills/skills/frontend-design/SKILL.md): direção visual deliberada, identidade própria, revisão da interface renderizada.
- [webapp-testing](/Users/felipealsouza/.claude/plugins/marketplaces/anthropic-agent-skills/skills/webapp-testing/SKILL.md): Playwright nativo em Python, Chrome headless, inspeção e screenshots reais.

O Python Playwright foi instalado em ambiente isolado de QA (`/private/tmp/amazonia-viva-m05-qa311`), sem alterar o ambiente Python do backend. O teste anterior em JavaScript foi mantido e adaptado aos rótulos em inglês e às coordenadas reais do mapa.

## Diagnóstico visual anterior

As capturas originais mostram o mapa desktop sem base nem detecções visíveis, embora houvesse canvas e dados. Um diagnóstico no navegador confirmou a recuperação por `resize`/repaint. Painéis flutuantes cobriam a área geográfica e os filtros ficavam separados no mobile.

O histórico começava por importação e versões, adiando o calendário. A introdução dizia que não havia série harmonizada enquanto a própria página exibia uma conversão experimental. A origem dos valores dependia de marcas pequenas e a consulta dependia de hover.

A navegação tinha cinco destinos com peso semelhante, seletores territoriais repetidos e muitos blocos equivalentes. Em 390 px, o conteúdo principal transbordava: histórico 435 px, território 462 px e relatório aproximadamente 496 px. Havia rótulos e textos sem continuidade entre páginas.

## Direção de design e componentes

Identidade institucional com verde floresta, fundo mineral claro, divisórias discretas e a fonte Archivo já disponível localmente. Laranja representa atividade de fogo; azul identifica água/meteorologia e NOAA-21; estados e séries possuem nomes, unidades e legendas. A cor não é a única indicação da origem científica. [Tokens e diagnóstico detalhado](DESIGN.md).

- **AppShell / contexto territorial:** três módulos principais, recursos de apoio, seleção compartilhada e URLs com território. Navegação mobile fixa; períodos específicos por módulo persistem na sessão.
- **CurrentSituation / DetectionMap:** controles acima do mapa, painel lateral, legenda contextual e correção de redimensionamento. MapLibre renderiza base OpenFreeMap, polígonos IBGE, observações e agrupamentos reais. Há estados de carregamento e erro com nova tentativa. Popovers são exclusivos e fecham por Escape.
- **DetectionDetail:** satélite, sensor, observação UTC, horário de Brasília, coordenadas, FRP em MW, confiança conforme o sensor, temperaturas em K, dimensão do pixel, versão e proveniência. Horário de observação é separado da sincronização.
- **HistoryPage / HarmonizedSection:** calendário experimental primeiro; abas para observações originais e métodos/cobertura. Meses observados, convertidos e indisponíveis possuem texto, padrões e controles por clique, toque e teclado. O inspetor explica valor e faixa empírica.
- **TerritoryPage:** cinco perguntas conectam observações, comparação histórica, ambiente, investigação e evidências. A antiga classificação não é apresentada como risco validado. Proximidade não estabelece ameaça a comunidades.
- **Environment / Evidence / Ficha:** unidades e períodos visíveis, reanálise diferenciada de previsão, notas em inglês na apresentação, exportações e relatório imprimível preservados. Payloads e cabeçalhos científicos originais não foram traduzidos.
- **Controles e responsividade:** foco visível, navegação por setas nos segmentos e abas, movimento reduzido e tabelas com rolagem local. Metadados extensos não ampliam o documento mobile.

## Ciência conferida

A resposta real de `/api/v1/history/harmonized?region=portel` confirma, para o modelo **sazonal**, erro percentual absoluto mediano **15,9%**, P90 **31,5%**, **25 meses ativos avaliados**, sobreposição **2021–2025** e pelo menos **30 detecções em ambos os sensores** na avaliação deixa-um-ano-de-fora. O P90 é excedido pelo pior décimo dos meses avaliados; não é uma taxa de acerto de 90%.

Esses resultados não devem ser confundidos com o modelo constante: mediana 14,7% e P90 61,7%. O ajuste do calendário usa outro critério: pelo menos 10 detecções em ambos os produtos e três anos válidos por mês, com razão geral como fallback. O primeiro mês com dados Aqua é julho de 2002.

A faixa P10–P90 descreve dispersão empírica das razões de conversão, **não um intervalo de confiança ou previsão calibrado**. As faixas anuais somadas também não são um intervalo anual calibrado. Deriva orbital, diferenças de coleção, nuvens, sensibilidade dos sensores e extrapolação temporal permanecem limitações explícitas. Nenhuma fórmula foi alterada nesta missão.

## Fluxo validado no navegador

Pará → clique real no polígono municipal de Portel → detecção real no mapa → metadados e filtros → calendário e incerteza → gráficos observados e métodos → análise territorial → relatório e evidências → exportações.

O teste também verificou filtros noturnos e por satélite com feições reais, agrupamentos renderizados, estado sem satélites, persistência de período, histórico do navegador e seleção no mobile. A falha NASA FIRMS foi **simulada somente em um contexto isolado do navegador**, sem modificar o backend e sem inventar observações; a nova tentativa recuperou dados reais.

## Resultados e evidências

| Verificação | Resultado | Evidência |
|---|---|---|
| Typecheck | Aprovado, também executado pelo build | [build.log](build.log) |
| Build de produção | Aprovado | [build.log](build.log) |
| Backend | **77/77**, igual à base anterior | [resultado registrado](backend-tests.json) |
| Frontend Vitest | **4/4** | [log](frontend-tests.log) |
| Fluxo Portel anterior | Todas as verificações passaram | [log](e2e-existing.log) |
| Playwright Python | **41/41** | [resultados](test-results.json), [log](playwright-flow.log) |
| Auditoria visual | **12 vistas**: seis páginas × desktop/mobile | [antes](before/audit.json), [depois](after/audit.json) |
| Console, runtime e rede | Zero erros inesperados no fluxo real e nas 12 capturas finais | [auditoria](after/audit.json) |
| Layout | Documento e conteúdo principal sem transbordamento em 1440 e 390 px | [auditoria](after/audit.json) |

A lista `overflow` da auditoria inclui células que ultrapassam a janela **dentro das tabelas roláveis**. Ela não representa transbordamento do documento; as métricas de largura do documento e do conteúdo principal estão dentro de seus respectivos limites.

As imagens abaixo foram capturadas no Chrome em **1440×900** e **390×844**, além de versões `-full.png`. Foram inspecionadas visualmente: mapa, histórico, território, ambiente, evidências e relatório. O contraste, a hierarquia e o comportamento no mobile foram revisados; não se afirma certificação formal WCAG.

| Página | Desktop antes → depois | Mobile antes → depois |
|---|---|---|
| Monitoramento | [antes](before/desktop-current.png) → [depois](after/desktop-current.png) | [antes](before/mobile-current.png) → [depois](after/mobile-current.png) |
| Histórico | [antes](before/desktop-history.png) → [depois](after/desktop-history.png) | [antes](before/mobile-history.png) → [depois](after/mobile-history.png) |
| Território | [antes](before/desktop-territory.png) → [depois](after/desktop-territory.png) | [antes](before/mobile-territory.png) → [depois](after/mobile-territory.png) |
| Ambiente | [antes](before/desktop-environment.png) → [depois](after/desktop-environment.png) | [antes](before/mobile-environment.png) → [depois](after/mobile-environment.png) |
| Evidências | [antes](before/desktop-evidence.png) → [depois](after/desktop-evidence.png) | [antes](before/mobile-evidence.png) → [depois](after/mobile-evidence.png) |
| Relatório | [antes](before/desktop-report.png) → [depois](after/desktop-report.png) | [antes](before/mobile-report.png) → [depois](after/mobile-report.png) |

Evidências adicionais: [detecção real selecionada](after/qa-map-observation.png), [gráficos observados](after/qa-history-observed.png), [falha de fonte simulada](after/qa-simulated-source-outage.png). Os pequenos arquivos de exportação conferidos estão em [qa-downloads](qa-downloads/).

## Limitações e pendências para a apresentação global

- A interface prioriza inglês. Alternância EN/PT-BR ainda não foi implementada; nomes geográficos e valores/cabeçalhos dos arquivos originais são preservados. Novas mensagens desconhecidas vindas da API podem exigir tradução adicional na apresentação.
- Testes executados em Chrome headless com WebGL por software. Safari, Firefox, aparelhos físicos, GPU real, conectividade móvel e uso assistivo completo continuam pendentes. Não foi feito benchmark de grande volume nem certificação de acessibilidade.
- A harmonização continua experimental, sem validação operacional externa, correção de deriva orbital ou auditoria completa de grânulos/nuvens. A reanálise POWER não descreve condições instantâneas no ponto de uma detecção.
- O índice externo Censipam não possui fórmula verificável na documentação já integrada; o relatório o identifica como externo. Alegações regulatórias anteriores permanecem explicitamente por verificar no diário oficial.
- O bundle principal de produção tem aproximadamente 1,40 MB antes da compressão (393 kB gzip); MapLibre é parte relevante do custo. Avaliar desempenho em aparelho físico antes da apresentação.
- O aviso preexistente de depreciação Starlette/httpx continua presente nos testes do backend. Não impede os 77 testes.
- Antes da submissão: revisão científica independente dos textos e intervalos, teste com pessoas que não conheçam o projeto, ensaio da demonstração em inglês e conferência das exigências oficiais de apresentação e atribuição. Publicação exige uma etapa própria autorizada.
