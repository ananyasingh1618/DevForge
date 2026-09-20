#!/usr/bin/env bash
# Expose the local DevForge entrypoint through a Cloudflare Quick Tunnel
# (free, no account, temporary random *.trycloudflare.com URL that changes
# every run). Only this script's own cloudflared is ever started or stopped.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_prod_common.sh"

command -v cloudflared >/dev/null || { echo "cloudflared not installed (brew install cloudflared)." >&2; exit 1; }
curl -fsS -m 3 "$LOCAL_URL/healthz" >/dev/null || { echo "DevForge is not running locally — run scripts/start-prod.sh first." >&2; exit 1; }

mkdir -p "$RUN_DIR"
if tunnel_pid_alive; then
  echo "Tunnel already running: $(cat "$URL_FILE")"; exit 0
fi

: > "$LOG_FILE"; rm -f "$URL_FILE"
nohup cloudflared tunnel --no-autoupdate --url "$LOCAL_URL" > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

for _ in $(seq 1 45); do
  url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" | head -1 || true)"
  [[ -n "$url" ]] && break
  sleep 1
done
[[ -n "${url:-}" ]] || { echo "Tunnel did not report a URL; see $LOG_FILE" >&2; "$ROOT/scripts/stop-tunnel.sh"; exit 1; }
echo "$url" > "$URL_FILE"
echo "Public URL: $url"
echo "(Quick Tunnel URLs are temporary and change on every start. Allow ~10-30s for DNS to propagate.)"
