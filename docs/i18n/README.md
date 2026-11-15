# Tradução PT-BR / EN — Amazônia Viva

A interface possui botões **PT-BR / EN** na barra superior, disponíveis também em 390 px. O idioma escolhido permanece entre os módulos e após recarregar. Inglês continua como padrão da demonstração global quando não há preferência salva.

## O que muda

Navegação, títulos, filtros, estados de carregamento, erros, detalhes de detecção, legendas, calendário harmonizado, incerteza científica, gráficos, contexto ambiental, análise territorial e relatórios possuem apresentação em português e inglês. Meses, números, separadores decimais e rótulos acessíveis acompanham o idioma. Horários continuam explicitamente UTC, com horário de Brasília quando aplicável.

A alternância usa um catálogo local e estado reativo compartilhado, sem serviço externo de tradução. Ela atualiza `html.lang`, o título do documento e os controles nativos do MapLibre. O mapa não é recriado: câmera, detecção selecionada, território e período permanecem. A preferência é salva em `amazonia-viva:language`; se o armazenamento do navegador estiver bloqueado, a troca continua funcionando na sessão.

Nomes geográficos, sensores, IDs de produto, unidades, geometrias, fórmulas, contratos de API e dados originais são preservados. Os CSVs mantêm seus campos científicos; a exportação JSON do relatório foi comparada **byte a byte** antes/depois da troca e permaneceu idêntica.

## Arquivos centrais

- [Catálogo português](../../frontend/src/lib/messages.pt-BR.json), com 781 mensagens.
- [Tradução e assinatura reativa](../../frontend/src/lib/i18n.ts) e [preferência de idioma](../../frontend/src/lib/locale.ts).
- [Seletor PT-BR / EN](../../frontend/src/components/LanguageSwitcher.tsx).
- [Formatação de datas e números](../../frontend/src/lib/format.ts).
- [Notas das fontes](../../frontend/src/lib/sourceCopy.ts): mantém os dados descritivos originais em português e sua apresentação em inglês. Mensagens desconhecidas continuam em seu idioma de origem, evitando inventar traduções científicas.

## Verificação

| Verificação | Resultado |
|---|---|
| Typecheck e build | Aprovados; [log do build](build.log) |
| Testes do frontend | **8/8**: quatro existentes e quatro de internacionalização |
| Testes do backend | **77/77**, sem alterações no backend; aviso preexistente Starlette/httpx |
| Fluxo anterior de Portel | Aprovado; [log](portel-flow.log) |
| Playwright bilíngue | **49/49**, Chrome real headless; [resultados](results.json), [log](playwright.log) |
| Erros inesperados | Nenhum erro de página, console ou HTTP nos fluxos reais |
| Capturas auditadas | **29**, incluindo as abas de histórico e falha da fonte simulada |
| Traduções conhecidas restantes em inglês no modo português | Nenhuma nas capturas auditadas |

O teste usa Python Playwright com os servidores locais existentes, sem iniciar instâncias duplicadas. Verifica os dois idiomas em **1440×900** e **390×844**, a mesma instância/canvas/câmera do MapLibre, filtros preservados, idioma após reload, origem/erro/faixa empírica no calendário, gráficos, cabeçalhos CSV, JSON imutável e recuperação após HTTP 503 simulado apenas no navegador.

Foram conferidos os valores sazonais de Portel em ambos os formatos: **15.9% / 31.5%** em inglês e **15,9% / 31,5%** em português. A amostra de 25 meses ativos, referência 2021–2025 e as ressalvas científicas são preservadas. A série continua experimental, sem apresentar a faixa empírica como intervalo calibrado.

## Screenshots

[Antes, somente inglês](before-en.png). As capturas principais abaixo usam o tamanho da janela; arquivos `-full.png`, quando disponíveis, mostram o conteúdo completo.

| Página | Português desktop | English desktop | Português mobile | English mobile |
|---|---|---|---|---|
| Monitoramento | [PT-BR](pt-desktop-current.png) | [EN](en-desktop-current.png) | [PT-BR](pt-mobile-current.png) | [EN](en-mobile-current.png) |
| Histórico | [PT-BR](pt-desktop-history.png) | [EN](en-desktop-history.png) | [PT-BR](pt-mobile-history.png) | [EN](en-mobile-history.png) |
| Território | [PT-BR](pt-desktop-territory.png) | [EN](en-desktop-territory.png) | [PT-BR](pt-mobile-territory.png) | [EN](en-mobile-territory.png) |
| Ambiente | [PT-BR](pt-desktop-environment.png) | [EN](en-desktop-environment.png) | [PT-BR](pt-mobile-environment.png) | [EN](en-mobile-environment.png) |
| Evidências | [PT-BR](pt-desktop-evidence.png) | [EN](en-desktop-evidence.png) | [PT-BR](pt-mobile-evidence.png) | [EN](en-mobile-evidence.png) |
| Relatório | [PT-BR](pt-desktop-report.png) | [EN](en-desktop-report.png) | [PT-BR](pt-mobile-report.png) | [EN](en-mobile-report.png) |

Outras evidências: [histórico observado em português](pt-desktop-history-observed.png), [métodos em português](pt-desktop-history-methods.png) e [estado de erro da fonte em português](pt-mobile-source-outage.png).

## Reproduzir

Com Python 3.11, pacote `playwright`, Chrome local e os servidores web/API já ativos:

```bash
python frontend/e2e/i18n_flow.py --help
python frontend/e2e/i18n_flow.py
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run e2e
```

Aplicação local: http://127.0.0.1:5710/?regiao=para. Não houve publicação em hospedagem externa. Safari, Firefox, aparelhos físicos e revisão linguística humana de novas mensagens de fontes externas continuam como verificações futuras.
