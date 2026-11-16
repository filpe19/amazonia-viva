# Auditoria crítica — Amazônia Viva (15/11/2026)

Objetivo: dizer com franqueza o que a plataforma entrega hoje, onde ela é frágil e o que foi corrigido nesta rodada (Missão 08). Os números vêm dos dados reais de 15/11/2026, janela de 7 dias.

## 1. Harmonização VIIRS × MODIS (o tema do desafio)

**O que existe e se sustenta**
- **Comparações históricas sempre no mesmo instrumento**: MODIS × MODIS (2001–2025) e NOAA-20 × NOAA-20 (2021–2025). Nunca se compara contagem de um sensor com a do outro.
- **Calendário harmonizado experimental**: o MODIS Aqua anterior a 2021 é convertido em "equivalente NOAA-20" por uma razão sazonal, com validação deixando um ano de fora.
  - Erro mediano: 15–22% por território (Santarém 22,4%).
  - P90: 32–62%. A cauda é grande, e isso é exibido.
- **Novo nas missões 07 e 08**:
  - proporção por satélite (cada sensor dividido pelo próprio total), que torna VIIRS e MODIS comparáveis sem somar contagens. Em Santarém, os quatro satélites concordam que 62–71% das detecções estão em assentamentos;
  - "vista por N de 4 satélites" e "confirmada por ≥ 2 passagens" como concordância entre sensores.

**Fragilidades**
- A conversão por razão supõe que a relação VIIRS/MODIS de 2021–2025 valia antes, sem teste fora da sobreposição.
- A deriva orbital de Terra e Aqua não é corrigida.
- A harmonização é só agregada por território e mês. Não há harmonização por pixel nem modelo de probabilidade de detecção por FRP ou nebulosidade.
- O mapa ao vivo mostra os sensores separados. É o correto, mas não é "harmonizado" no sentido do desafio, e a interface precisa dizer isso.
- A cobertura real (grânulos processados, nuvens) não foi auditada: dia sem detecção pode ser dia sem observação.
- A série harmonizada só existe para o Pará e seus municípios, os únicos com arquivo importado. Na escala da Amazônia não há linha de base histórica.

**Próximo passo recomendado**: casar passagens quase simultâneas (Aqua ~13h30 × NOAA-20 ~13h30) pixel a pixel, para estimar a probabilidade de o MODIS detectar dado o FRP do VIIRS. É a harmonização física, além da estatística.

## 2. Alertas

**Antes desta rodada (Missão 07)**
- Os "sinais" eram coincidências espaciais corretas, mas sem resposta para "e daí?": não diziam quem vive ali, como chegar, quem acionar nem o que causou o calor.
- Uma categoria dominava a lista: no Pará, em 24 h, 181 dos 238 sinais eram assentamentos.

**Corrigido agora, para terras indígenas**
- **Regras explícitas**: fogo dentro confirmado (≥ 2 passagens); fogo dentro em uma passagem; fogo só no entorno (≤ 10 km).
- **Contexto social**:
  - pessoas residentes na TI (Censo 2022, IBGE tabela 9719);
  - povos e fase da FUNAI;
  - coordenação regional da FUNAI responsável.
- **Acesso**: rodovia federal mais próxima (DNIT) e brigada cadastrada mais próxima (Censipam).
- **Indícios de origem**: garimpo e mineração (ANM SIGMINE), desmatamento e cicatriz de incêndio (INPE DETER).
- **Boletim** pronto para copiar ou enviar por WhatsApp, com fontes e ressalvas.
- Funciona em município, Pará, Brasil e **Amazônia (9 países)**:
  - fora do Brasil, terras indígenas da OTCA;
  - em 7 dias, 465 TIs com fogo dentro, onde vivem 260.639 pessoas indígenas de 94 povos (Censo 2022).

**Ainda falta**
- **Histórico de alertas**: não se guarda o que já foi alertado, então não dá para dizer "novo desde ontem" nem enviar notificação. É a maior lacuna operacional.
- **Notificação ativa** (e-mail, push, WhatsApp automático): exige cadastro e consentimento, fora do escopo e do prazo.
- **Limiares sem calibração**: 10 km de entorno e 2 passagens são escolhas declaradas, não validadas em campo. "Uma passagem" pode ser falso positivo.
- **Quilombolas e UCs** ainda não têm o mesmo contexto social. A camada do INCRA tem número de famílias, que pode ser usado.
- **Escolas (INEP)** e unidades de saúde indígena (SESAI) não estão integradas.

## 3. Dados cruzados — qualidade e armadilhas encontradas

| Fonte | Uso | Problema real encontrado | Situação |
|---|---|---|---|
| INPE DETER | desmatamento, cicatriz, mineração | `mun_geocod` diverge da malha IBGE: áreas de Mojuí dos Campos aparecem como Santarém (704 → 457 polígonos) | **Corrigido**: recorte pelo limite IBGE |
| ANM SIGMINE | garimpo e mineração | o servidor não envia o certificado intermediário, e o TLS falhava em Python | **Corrigido**: cadeia completada com o intermediário oficial da Sectigo; a verificação continua ativa |
| ANM SIGMINE | idem | limite de registros por consulta | sinalizado como "resultado parcial" |
| IBGE Censo 2022 (TI) | população por TI | o código do IBGE não é o da FUNAI; o casamento é por nome e UF | 50 de 61 no Pará; TIs sem par aparecem como "não publicada" |
| FUNAI (via Censipam) | polígonos, povos, fase, CR | o WFS da própria FUNAI responde 403; usa-se o espelho do Censipam (data de atualização não informada) | declarado na fonte |
| IBGE BC250 | localidades | escala 1:250.000, sem tipo "aldeia"; comunidades pequenas faltam | declarado |
| Censipam CNUC | UCs | o espelho tem só UCs estaduais; UCs municipais estão em outra camada (`mma_cnuc_unidade_conservacao_municipal`), ainda não usada | **pendente** |
| DNIT | rodovias | só federais; estaduais e vicinais (IBGE BC250) não integradas | **pendente** |
| FIRMS `type` | fonte estática | só existe no arquivo de processamento padrão e só foi importado para o Pará | declarado no painel |
| OTCA | Amazônia e TIs estrangeiras | cada país define "Amazônia" de um jeito; TIs estrangeiras sem população | declarado |
| Esri World Imagery | imagem de alta resolução | licença para uso público não confirmada | **decisão do usuário** |

## 4. "É incêndio mesmo?"

Agora há resposta por detecção, com regra explícita:
1. **Fonte estática**: FIRMS type 2 a até 500 m no arquivo → provável fonte não florestal.
2. **Contexto de mineração**: dentro de título minerário ou reserva garimpeira (ANM), ou de aviso DETER de mineração.
3. **Queima após desmatamento**: dentro de aviso DETER de desmatamento dos últimos 12 meses.
4. **Compatível com queima de vegetação**: confirmada por outra passagem a até 1 km em ± 24 h, sem os indícios acima.
5. **Inconclusivo**: nos demais casos.

Limites:
- Sem cobertura do solo (MapBiomas), não se distingue pasto de floresta.
- Sem dado geoestacionário (GOES), não se sabe a duração do fogo entre passagens. O Censipam publica camadas de eventos GOES, que são candidatas.
- Nada disso define causa ou responsabilidade.

## 5. Operação

- **Alertas da Amazônia inteira** levam cerca de 45 s na primeira consulta (FUNAI 37 MB, 74 mil detecções), depois ficam em cache por 10 min. Para produção, calcular em segundo plano a cada atualização da FIRMS.
- **Dependência de serviços externos** (FIRMS, Censipam, IBGE, INPE, ANM): cada fonte tem estado explícito e cópia anterior quando possível. O E2E com dados reais pode oscilar se uma fonte cair.
- **Testes**: serviços novos cobertos com dados sintéticos (sem rede); fluxos de navegador com dados reais.

## 6. Veredito

A plataforma é honesta com os dados e já entrega valor social concreto:
- quais terras indígenas estão com fogo agora;
- quantas pessoas vivem nelas e de que povos;
- quem acionar e como chegar;
- se há indício de garimpo ou desmatamento.

Os pontos fracos que um avaliador pode apontar:
- a harmonização ainda é estatística e agregada;
- não há histórico nem notificação de alertas;
- algumas camadas existem na fonte mas ainda não foram usadas (UCs municipais, rodovias estaduais, GOES).
