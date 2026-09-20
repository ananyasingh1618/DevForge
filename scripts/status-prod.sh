#!/usr/bin/env bash
# Show containers, memory, the local health check and the tunnel URL.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_prod_common.sh"
[[ -f "$ENV_FILE" ]] || { echo "Not set up yet: run scripts/start-prod.sh"; exit 1; }
dc ps
echo
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}' \
  $(dc ps -q 2>/dev/null) 2>/dev/null || true
echo
if curl -fsS -m 3 "$LOCAL_URL/healthz" >/dev/null 2>&1; then echo "Local:  $LOCAL_URL  (healthy)"; else echo "Local:  $LOCAL_URL  (NOT responding)"; fi
if tunnel_pid_alive; then echo "Public: $(cat "$URL_FILE" 2>/dev/null || echo '(starting)')"; else echo "Public: tunnel not running (scripts/start-tunnel.sh)"; fi
