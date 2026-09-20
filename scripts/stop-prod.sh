#!/usr/bin/env bash
# Stop the tunnel and the DevForge production stack. The database volume is
# kept — data survives restarts. (This script never uses `down -v`.)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_prod_common.sh"
"$ROOT/scripts/stop-tunnel.sh" || true
[[ -f "$ENV_FILE" ]] || { echo "No $ENV_FILE — nothing to stop."; exit 0; }
dc down
echo "Stopped. Data volume devforge-prod_devforge_prod_pgdata preserved."
