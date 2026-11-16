# Deploying on a shared server (behind an existing nginx)

This is how Amazônia Viva runs in production at https://amazviva.online, on a server that already hosts other applications behind the host nginx. Nothing
here binds to public ports or changes the other sites. For a dedicated server with automatic HTTPS, see
[deploy/DEPLOY.md](../deploy/DEPLOY.md) (Caddy profile).

```
Internet ─443─▶ host nginx (TLS by certbot) ─▶ 127.0.0.1:8095 web container (nginx: static app, rate limits)
                                                   └─▶ api container (FastAPI, 1 CPU / 3 GB cap)
                                                         └─ /var/www/amazonia-viva-shared/runtime (cache, archive, references)
```

## Layout on the server

| Path | Content |
|---|---|
| `/var/www/amazonia-viva` | Git checkout (`main`), fast-forward only |
| `/var/www/amazonia-viva-shared/api.env` | API settings and secrets (never in git), mode 600 |
| `/var/www/amazonia-viva-shared/runtime/` | Runtime data mounted into the API: `history.sqlite`, `detections/` (Parquet), `reference/`, `cache/`, `logs/`. Owned by uid 10001 (the container user) |
| `/etc/nginx/sites-available/amazonia-viva` | Host vhost from [deploy/nginx-vps.conf](../deploy/nginx-vps.conf) |

## First install

```bash
# 1. Code
sudo mkdir -p /var/www/amazonia-viva-shared/runtime && sudo chown -R deploy:deploy /var/www/amazonia-viva /var/www/amazonia-viva-shared
git clone https://github.com/filpe19/amazonia-viva.git /var/www/amazonia-viva

# 2. Settings (see backend/.env.example). Minimum:
cat > /var/www/amazonia-viva-shared/api.env <<'ENV'
CORS_ORIGINS=["https://amazviva.online","https://www.amazviva.online"]
# Background pre-computation; the Amazon-wide scale needs ~3 GB, so leave it out on small shared servers
WARM_TARGETS=["santarem:7d","santarem:24h","portel:7d","portel:24h"]
# FIRMS_MAP_KEY=   (optional, free: https://firms.modaps.eosdis.nasa.gov/api/map_key/)
ENV
chmod 600 /var/www/amazonia-viva-shared/api.env

# 3. Runtime data (~200 MB), copied from a machine that already imported it
rsync -az backend/data/runtime/{history.sqlite,detections,reference} deploy@SERVER:/var/www/amazonia-viva-shared/runtime/
sudo chown -R 10001:10001 /var/www/amazonia-viva-shared/runtime

# 4. Containers
cd /var/www/amazonia-viva && sudo docker compose -f deploy/docker-compose.vps.yml up -d --build

# 5. Host nginx + TLS
sudo cp deploy/nginx-vps.conf /etc/nginx/sites-available/amazonia-viva
sudo ln -s /etc/nginx/sites-available/amazonia-viva /etc/nginx/sites-enabled/amazonia-viva
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d amazviva.online -d www.amazviva.online
```

Before the domain existed, a temporary hostname on [sslip.io](https://sslip.io) (`*.179-197-65-61.sslip.io` resolves to the
server IP) was used with the same steps and no DNS change. It stays enabled as a fallback.

## Updating

```bash
ssh deploy@SERVER /var/www/amazonia-viva/deploy/deploy-vps.sh   # git ff-only, rebuild, restart, health check
```

## Switching to the final domain

1. Point the domain's DNS `A` record to the server IP.
2. Add the domain to `server_name` in `/etc/nginx/sites-available/amazonia-viva`, then run `sudo nginx -t && sudo systemctl reload nginx`.
3. Run `sudo certbot --nginx -d NEW_DOMAIN`.
4. Add the new origin to `CORS_ORIGINS` in `api.env`, then run `sudo docker compose -f deploy/docker-compose.vps.yml up -d`.

Keep the sslip.io name until the new domain answers over HTTPS, then remove it.

## Operations

- **Logs:** `sudo docker compose -f deploy/docker-compose.vps.yml logs -f api` (JSON, one event per line).
- **Health:** `curl -s http://127.0.0.1:8095/api/v1/health`.
- **Backup:** the cache can be discarded; keep `history.sqlite`, `detections/` and `reference/`.
  ```bash
  tar czf ~/av-runtime-$(date +%F).tgz -C /var/www/amazonia-viva-shared/runtime history.sqlite detections reference
  ```
- **Resources:** the API is capped at 1 CPU and 3 GB without swap (`docker-compose.vps.yml`). The background warm-up
  (`WARM_TARGETS`) keeps the pilots ready. The state (Pará) and Amazon-wide scales are computed when someone opens them, one job at a time.
- **Stop or remove:**
  ```bash
  sudo docker compose -f deploy/docker-compose.vps.yml down   # runtime data stays in the shared folder
  ```
