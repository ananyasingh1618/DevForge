# Shared by the *-prod.sh / *-tunnel.sh scripts (sourced, not executed).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker/docker-compose.prod.yml"
ENV_FILE="$ROOT/.env.production"
RUN_DIR="$ROOT/.run"
PID_FILE="$RUN_DIR/tunnel.pid"
URL_FILE="$RUN_DIR/tunnel.url"
LOG_FILE="$RUN_DIR/tunnel.log"
# Loopback port of the public entrypoint; must match WEB_PORT in the env file.
WEB_PORT="$(grep -E '^WEB_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)"
WEB_PORT="${WEB_PORT:-8090}"
LOCAL_URL="http://127.0.0.1:${WEB_PORT}"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# A pid we started AND that is still our cloudflared (guards against pid reuse
# and, importantly, never matches another project's tunnel).
tunnel_pid_alive() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid; pid="$(cat "$PID_FILE")"
  [[ -n "$pid" ]] && ps -p "$pid" -o command= 2>/dev/null | grep -q "cloudflared.*127.0.0.1:${WEB_PORT}"
}
