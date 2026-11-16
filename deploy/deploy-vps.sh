#!/usr/bin/env bash
# Update Amazônia Viva on the shared server: fast-forward the checkout, rebuild, restart and check health.
# Usage: ssh deploy@SERVER /var/www/amazonia-viva/deploy/deploy-vps.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch --quiet origin
git merge --ff-only origin/main
sudo docker compose -f deploy/docker-compose.vps.yml up -d --build
for i in $(seq 1 60); do
  if curl -fsS -m 5 http://127.0.0.1:8095/api/v1/health >/dev/null; then echo "healthy: $(git rev-parse --short HEAD)"; exit 0; fi
  sleep 3
done
echo "health check failed" >&2
sudo docker compose -f deploy/docker-compose.vps.yml logs --tail 50 api >&2
exit 1
