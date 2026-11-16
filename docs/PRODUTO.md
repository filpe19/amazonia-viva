# Amazônia Viva — o que já é produto e o que falta (15/11/2026)

Diagnóstico franco para colocar a plataforma no ar e evoluir de protótipo de hackathon para produto.

## Cobertura atual

| Escala | Detecções (4 satélites) | Focos e impacto | Terras indígenas | Cruzamentos (UCs, quilombolas, localidades, DETER) | Histórico (arquivo FIRMS) | Municípios detalhados |
|---|---|---|---|---|---|---|
| Amazônia (9 países) | ✅ | ✅ | ✅ FUNAI + OTCA | — (por estado e município) | — | — |
| Estados da Amazônia Legal (9) | ✅ | ✅ | ✅ | ✅ estado | **só Pará** | **só Pará** (144) |
| Municípios do Pará (144) | ✅ | ✅ | ✅ | ✅ (+ saúde CNES, DETER) | ✅ MODIS 2001–2025, NOAA-20 2021–2025 | ✅ |
| **Pilotos: Santarém e Portel** | ✅ | ✅ pré-calculado | ✅ | ✅ | ✅ | ✅ (abre por padrão em Santarém) |

## O que já é produto
- **Dados reais e rastreáveis**, sem simulação: NASA FIRMS, IBGE (malhas, BC250, Censo 2022), FUNAI, ICMBio, CNUC, INCRA, DNIT, Censipam, INPE DETER, ANM, CNES, NASA POWER, Copernicus FWI, Open-Meteo e OTCA.
- **Regras públicas e verificáveis** para alertas, graus e confiabilidade, sem pontuação inventada. A probabilidade de propagação é declarada como "não modelada".
- **Veracidade checada**: 30 de 30 verificações de consistência entre módulos e com o IBGE (`docs/mission11/VERACIDADE.md`).
- **Acessibilidade**: 0 violações WCAG 2.1 AA (axe-core, 6 telas). Português e inglês.
- **Testes**: 93 no backend, 26 no frontend; E2E do mapa 57/57 e do fluxo piloto 20/20.
- **Pronta para subir**: imagens Docker, nginx com limites por IP, HTTPS automático (Caddy) e roteiro de deploy (`deploy/DEPLOY.md`). A API continua respondendo durante os cálculos pesados (fila única e serialização fora do laço de eventos).

## O que falta, por prioridade

### P0 — para colocar no ar com segurança (horas)
1. **Domínio e servidor** (4 vCPU / 8 GB recomendado), DNS apontado e `docker compose up` (ver DEPLOY.md).
2. **Dados de execução no servidor**: copiar ~200 MB (histórico, arquivo FIRMS, referências).
3. **Licença da imagem Esri**: chave gratuita do ArcGIS Location Platform, ou desligar essa opção na versão pública.
4. **Aviso de uso de IA, créditos e termos**: página "Sobre / Fontes / Limitações". Os avisos já existem por tela, mas falta a página única.
5. **Monitoramento e backup**: verificador de disponibilidade em `/api/v1/health` e backup diário do volume.
6. **Chave FIRMS** (gratuita), para não depender só dos arquivos públicos.

### P1 — para ser um produto maduro (semanas)
1. **Histórico de alertas**:
   - gravar cada foco e alerta com horário, para mostrar "novo desde ontem", evolução e duração;
   - hoje os alertas são recalculados a cada consulta, com cache de 30 min.
2. **Avisos ativos**: assinatura por área (município ou TI) com e-mail ou WhatsApp, por opt-in e com termo de consentimento (LGPD).
3. **Calibração com quem está em campo**:
   - validar graus e confiabilidade com Defesa Civil, brigadas Prevfogo/ICMBio, Funai e Censipam;
   - botão "confirmado / descartado" para criar uma base de verdade de campo.
   - É o que transforma "regras públicas" em "assertividade medida".
4. **Pré-cálculo agendado**: um job periódico gravando os resultados, em vez de calcular na consulta. A escala amazônica em 7 dias leva ~1–2 min a frio.
5. **Harmonização física**:
   - casar passagens quase simultâneas Aqua × NOAA-20 pixel a pixel, para estimar a probabilidade de detecção por sensor;
   - hoje a harmonização é estatística e agregada.
6. **Observabilidade**: rastreamento de erros, métricas de latência e CI (testes e build a cada mudança).
7. **Teste com usuários reais**: gestores, brigadas e lideranças indígenas, incluindo pessoas que usam leitor de tela.

### P2 — para cobrir toda a Amazônia no mesmo nível do Pará (semanas a meses)
1. **Malhas municipais** dos outros 8 estados (≈ 630 municípios). O backend já é genérico por região; partes da interface ainda assumem o Pará (lista municipal, mapa de distribuição, sedes).
2. **Arquivo histórico FIRMS** do Brasil amazônico e dos demais países (vários GB). Exige importação incremental e armazenamento em Parquet por estado.
3. **Setores do Censo 2022, CNES e localidades** de todos os estados (exposição e saúde por município). A consulta de localidades precisa de paginação para estados grandes.
4. **Entrega de mapa em escala**: tiles vetoriais para detecções e camadas, em vez de GeoJSON (hoje são 15 MB para 74 mil detecções em 7 dias).
5. **Fontes dos outros países**: áreas protegidas e fontes nacionais, além das terras indígenas da OTCA.

## Riscos a acompanhar
- **Dependência de fontes externas** (Censipam, IBGE, INPE, ANM, Open-Meteo): há cache e cópia anterior, mas quedas longas reduzem o que a tela mostra. A plataforma sempre informa a fonte indisponível.
- **Uso indevido como alerta oficial**: manter avisos claros e, se possível, parceria institucional para validação.
- **Custos**: Open-Meteo e Esri têm limites para uso institucional ou comercial. A FIRMS é gratuita.
