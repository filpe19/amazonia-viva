# Missão 11 — Veracidade, acessibilidade, mapa expansível e maturidade visual (15/11/2026)

Pedido:
- mostrar a veracidade com base nos dados;
- acessibilidade;
- mapa expansível e menos apertado;
- visual mais maduro, "de órgão grande", analítico e satelital;
- filtros de data em Histórico, Território e Contexto ambiental.

Nada foi commitado, enviado nem publicado.

## Veracidade
- **Bloco "Confiabilidade dos dados"** no topo da aba Alertas. Mostra quantas fontes estão respondendo, quando a FIRMS foi sincronizada e uma tabela com cada fonte: estado, horário e para que é usada (FIRMS, FUNAI, ICMBio, CNUC, INCRA, DNIT, IBGE, Censipam, Open-Meteo, Censo 2022, ANM, DETER).
- **Script de consistência** `backend/scripts/verify_consistency.py`. Resultado com dados reais: **30 de 30 verificações consistentes** (ver [VERACIDADE.md](VERACIDADE.md)). Ele confere:
  - detecções do mapa = metadados por produto e por satélite;
  - focos = detecções sem dupla contagem;
  - grau "alto" só com regra atendida;
  - "a favor do vento" só com vento e a até 20 km;
  - ausência de probabilidade inventada;
  - TI "confirmada" só com ≥ 2 passagens;
  - DETER cruzado = DETER no mapa;
  - residentes indígenas ≤ total oficial do IBGE.

## Acessibilidade (WCAG 2.1 AA)
- Auditoria automática com axe-core em 6 telas (atividade/alertas, atividade/camadas, histórico, território, contexto ambiental, ficha). **Antes**: 4 tipos de violação séria. **Depois: 0 violações**.
- **Correções**:
  - contraste do laranja de alerta moderado (#d9480f → #b83d0b), do marrom de entorno, do estado "indisponível" das camadas e do texto do calendário;
  - nome acessível com o texto visível (botões de idioma, legenda-filtro dos satélites, atalho de alertas, células do calendário);
  - área rolável acessível pelo teclado;
  - lista de definições corrigida.
- **Mais**:
  - foco visível consistente (contorno azul de 2 px) em botões, links, selects e resumos;
  - tamanho mínimo de texto elevado para 11,5–12 px no painel e no mapa.

## Mapa
- Botão **Expandir o mapa** na barra de ferramentas: o painel lateral recolhe e o mapa ocupa a tela; Esc volta.
- Os filtros rápidos passaram para uma linha própria do cabeçalho do mapa (rolável), sem colidir com a legenda e o relógio.

## Visual
- **Aba Alertas** com tom institucional e analítico:
  - abas sublinhadas;
  - cabeçalho sem gradiente;
  - **barra de distribuição por grau** (alto, moderado, baixo, sem alvo);
  - métricas em grade com réguas finas, em vez de cartões em tom pastel;
  - cartões planos com barra de severidade e bordas finas;
  - selos de confiabilidade como texto com ponto;
  - alvos como etiquetas com borda colorida por tipo.

## Filtros de data
- **Contexto ambiental**: período de análise de 7, 14, 30, 60 ou 90 dias (NASA POWER) e títulos dinâmicos.
- **Território**: período (24 h, 48 h, 7 d) e **"Comparar com" 1, 2, 5 ou 10 anos atrás**. A tabela "Atual × mesmo período" traz:
  - detecções por satélite, só dentro do mesmo instrumento;
  - focos e graus;
  - cidades, rodovias e TIs no caminho.
  - Exemplo: Portel, 7 d — NOAA-20 766 agora contra 351 em nov/2025; Aqua 264 contra 46.
- **Histórico**: já tinha períodos A/B e seleção de ano; mantido.

## Estabilidade (achado nesta rodada)
- **Causa**: respostas grandes (dezenas de milhares de feições) passavam pelo conversor genérico do FastAPI (`jsonable_encoder`) dentro do laço de eventos e congelavam a API por até ~70 s, inclusive o `/health`.
- **Correção**: serialização direta, fora do laço (`app/api/responses.py`), nas rotas pesadas (detecções, focos, terras indígenas, cruzamentos, DETER, camadas, arquivo histórico).
- **Resultado**: detecções da Amazônia inteira em 7 dias (15 MB) em 0,66 s; `/health` em ~0,003 s durante a carga.

## Testes
- **Acessibilidade**: 0 violações WCAG A/AA nas 6 telas.
- **Consistência**: 30/30.
- **Backend**: 93 passed; `ruff` limpo.
- **Frontend**: tsc ok, vitest 26/26, build ok.
- **E2E**: `npm run e2e:map` **57/57** (sem erros de console, sem 5xx) e `npm run e2e` (Portel) **20/20**.
