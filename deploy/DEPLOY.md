# Colocar a Amazônia Viva no ar

Arquitetura de produção, em um servidor com Docker:

```
Internet ──443──▶ Caddy (HTTPS automático, Let's Encrypt) ──▶ nginx (interface estática + proxy /api, limites por IP) ──▶ API FastAPI (1 processo)
                                                                                                                         └─ volume av-runtime: cache, histórico (SQLite), arquivo FIRMS (Parquet), referências
```

## 1. Servidor

| | Mínimo | Recomendado |
|---|---|---|
| vCPU | 2 | 4 |
| RAM | 4 GB | 8 GB (escala amazônica em 7 dias usa ~1–2 GB no cálculo) |
| Disco | 20 GB | 40 GB (cache de fontes externas cresce até ~1–2 GB) |
| Sistema | Ubuntu 22.04/24.04 LTS com Docker Engine e o plugin compose | |

Portas 80 e 443 abertas. Nenhuma outra porta precisa ficar exposta.

## 2. Domínio

1. Registre o domínio (ex.: `amazoniaviva.org.br` no Registro.br).
2. Crie um registro **A** (e **AAAA**, se houver IPv6) apontando para o IP do servidor.
3. Espere a propagação. Confira com `dig +short SEU_DOMINIO`.

O Caddy só consegue emitir o certificado depois que o DNS aponta para o servidor.

## 3. Código e dados

```bash
git clone https://github.com/filpe19/amazonia-viva.git && cd amazonia-viva
cp deploy/.env.example deploy/.env      # editar DOMAIN (obrigatório); FIRMS_MAP_KEY e VITE_ARCGIS_API_KEY (opcionais)
```

**Dados de execução (~200 MB): histórico, arquivo FIRMS do Pará e referências.** Há duas opções.

- **A — copiar do ambiente atual** (rápido; os mesmos dados validados):
  ```bash
  # no computador de origem
  rsync -avz backend/data/runtime/{history.sqlite,detections,reference} usuario@SERVIDOR:/tmp/av-runtime/
  # no servidor, depois do primeiro "up" (que cria o volume):
  docker compose -f deploy/docker-compose.prod.yml cp /tmp/av-runtime/. api:/app/data/runtime/
  ```
- **B — reconstruir a partir das fontes oficiais** (lento; download do arquivo FIRMS de vários anos):
  ```bash
  docker compose -f deploy/docker-compose.prod.yml run --rm api python -m scripts.fetch_reference
  docker compose -f deploy/docker-compose.prod.yml run --rm api python -m scripts.fetch_amazonia --indigenous
  docker compose -f deploy/docker-compose.prod.yml run --rm api python -m scripts.import_history   # ver --help (anos/produtos)
  ```

Os limites territoriais (`backend/data/boundaries`) já vão dentro da imagem.

## 4. Subir

```bash
cd deploy
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps          # api e web "healthy"
curl -s https://SEU_DOMINIO/api/v1/health
```

Na primeira hora, a API pré-calcula os pilotos (Santarém, Portel), o Pará e a Amazônia em segundo plano, sem bloquear as rotas.

## 5. Operação

- **Logs**: `docker compose -f deploy/docker-compose.prod.yml logs -f api` (JSON, um evento por linha).
- **Atualizar**: `git pull && docker compose -f deploy/docker-compose.prod.yml up -d --build`.
- **Voltar versão**: `git checkout <commit-anterior> && docker compose ... up -d --build`.
- **Backup diário do volume** (o cache pode ser descartado; histórico e referências não):
  ```bash
  docker run --rm -v deploy_av-runtime:/d -v $PWD:/b alpine tar czf /b/av-runtime-$(date +%F).tgz -C /d history.sqlite detections reference
  ```
- **Monitoramento**: aponte um verificador externo (UptimeRobot, Better Stack…) para `https://SEU_DOMINIO/api/v1/health`.
- **Limites por IP** (nginx): 10 req/s nas rotas comuns; 20 req/min nas rotas de cálculo pesado.

## 6. Teste local do kit (sem domínio)

```bash
cd deploy
DOMAIN=localhost docker compose -f docker-compose.prod.yml -f docker-compose.local.yml up -d --build api web
open http://127.0.0.1:8088
```

## 7. Antes de divulgar

- [ ] **Licença da imagem de alta resolução (Esri)**: configurar `VITE_ARCGIS_API_KEY` (ArcGIS Location Platform, plano gratuito) ou remover essa opção de mapa-base na versão pública.
- [ ] **Open-Meteo**: o uso não comercial é gratuito. Uso institucional ou comercial exige plano pago ou servidor próprio.
- [ ] **Aviso de uso de IA e créditos das fontes** visíveis (exigência do regulamento do hackathon).
- [ ] **Chave FIRMS** (`FIRMS_MAP_KEY`) para não depender só dos arquivos públicos.
