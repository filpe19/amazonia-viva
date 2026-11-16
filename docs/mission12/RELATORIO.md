# Missão 12 — Pilotos, Amazônia Legal inteira e prontidão para produção (15/11/2026)

Pedido:
- Santarém e Portel como pilotos, com Santarém refinada para a demonstração;
- o Pará inteiro refinado;
- viabilidade de colocar no ar (domínio e servidor);
- o que falta para ser produto;
- avançar para toda a Amazônia.

Nada foi commitado, enviado nem publicado.

## Feito
- **Pilotos**: Santarém (código 1506807) e Portel aparecem como "Território piloto" na busca. **A plataforma abre em Santarém** na primeira visita.
- **Pré-cálculo em segundo plano**:
  - Santarém e Portel (24 h e 7 d), Pará e Amazônia (24 h): focos, terras indígenas, cruzamentos, camadas e ficha;
  - roda numa fila única, sem bloquear a API, e independe da chave FIRMS.
- **Amazônia Legal inteira selecionável**:
  - os 8 outros estados (AC, AP, AM, MA, MT, RO, RR, TO), com limites do IBGE;
  - por estado funcionam detecções, focos e impacto, terras indígenas, cruzamentos, camadas e eventos do Censipam (generalizados por UF);
  - histórico e municípios detalhados continuam só no Pará (ver PRODUTO.md, P2).
- **Página "Sobre"** (`/sobre`): o que a plataforma faz, fontes e licenças (11 grupos), regras e limitações, acessibilidade, **uso de IA (rascunho para aprovar)** e código-fonte.
- **Kit de produção** (`deploy/`):
  - `backend/Dockerfile` (usuário sem privilégios, healthcheck);
  - `frontend/Dockerfile` (build estático + nginx);
  - `frontend/nginx.conf`: gzip, cache de assets, limites por IP (10 req/s; 20 req/min nas rotas pesadas, com 429), cabeçalhos de segurança e CSP em modo relatório;
  - `deploy/docker-compose.prod.yml` com **Caddy (HTTPS automático)**;
  - `.env.example` e `DEPLOY.md` (servidor, DNS, dados, subida, operação, backup, monitoramento).
- **Validação local do kit**:
  - imagens construídas;
  - stack em containers saudável; interface, API, detecções e camadas pelo proxy;
  - cabeçalhos de segurança presentes e limite por IP retornando 429;
  - navegador sem erros (`prod-santarem.png`, `prod-sobre.png`).
- **Diagnóstico de produto**: [docs/PRODUTO.md](../PRODUTO.md) (P0 horas; P1 semanas; P2 Amazônia no nível do Pará).

## Pendências (decisão do usuário)
- **Deploy**: domínio, servidor (4 vCPU / 8 GB) e autorização. O kit está pronto: `docker compose -f deploy/docker-compose.prod.yml up -d --build`.
- **Push para o GitHub** (link público da submissão).
- **Chave Esri** (ou desligar a imagem de alta resolução na versão pública) e chave FIRMS.
- **Aprovar o texto de uso de IA** da página "Sobre".

## Correções vindas da bateria final
- **Pré-aquecimento da ficha removido**: ele executava partes síncronas (histórico em SQLite, setores do Censo) e travava a API a cada ciclo. Essas partes agora rodam em threads também nas consultas normais (análise territorial, impacto).
- **Alvos duplicados**: uma rodovia com vários trechos (ex.: BR-163) aparecia várias vezes no mesmo foco. Agora fica um alvo por tipo e nome, o mais próximo.
- **Legenda-filtro dos satélites**: o nome acessível passou a vir do próprio conteúdo (WCAG 2.5.3).
- **E2E**:
  - os testes passaram a escolher detecções não cobertas pelos controles do mapa;
  - corrigido o parâmetro de tempo-limite do Playwright, que estava ignorado e caía nos 30 s padrão.

## Testes finais
- **Backend**: 93 passed; `ruff` limpo.
- **Frontend**: tsc ok, vitest 26/26, build ok.
- **Acessibilidade**: 0 violações WCAG 2.1 AA em 7 telas (incluindo "Sobre").
- **E2E**: mapa **57/57** (sem erros de console, sem 5xx) e Portel **20/20**.
- **Kit de produção** validado em Docker local: imagens, saúde, proxy, cabeçalhos e limite 429.
