#!/usr/bin/env bash
# Build and start the DevForge stack (postgres, ai-service, api, web/Caddy).
# Safe to re-run: it rebuilds changed images and leaves the database volume
# untouched. First run also creates the gitignored .env.production.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_prod_common.sh"

docker info >/dev/null 2>&1 || { echo "Docker is not running." >&2; exit 1; }

# Write KEY=VALUE into a file, replacing any existing KEY line. Uses awk with
# ENVIRON so base64 values ('/', '+', '=') need no escaping and never appear
# in a process argument list or on the terminal.
set_kv() {
  local file="$1" key="$2"
  KV_VALUE="$3" awk -v k="$key" 'BEGIN{v=ENVIRON["KV_VALUE"]} $0 ~ "^"k"=" {print k"="v; done=1; next} {print} END{if(!done) print k"="v}' "$file" > "$file.tmp"
  mv "$file.tmp" "$file"
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Creating $ENV_FILE with freshly generated secrets (never printed, never committed)..."
  umask 077
  cp "$ROOT/.env.production.example" "$ENV_FILE"
  set_kv "$ENV_FILE" POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_kv "$ENV_FILE" SESSION_SECRET "$(openssl rand -hex 32)"
  set_kv "$ENV_FILE" GITHUB_TOKEN_ENCRYPTION_KEY "$(openssl rand -base64 32)"
  # Reuse optional AI provider keys from the repo's root .env, if present.
  for key in GEMINI_API_KEY ANTHROPIC_API_KEY VOYAGE_API_KEY; do
    if [[ -f "$ROOT/.env" ]]; then
      val="$(grep -E "^${key}=" "$ROOT/.env" | head -1 | cut -d= -f2- || true)"
      if [[ -n "$val" ]]; then set_kv "$ENV_FILE" "$key" "$val"; echo "  carried over $key from .env"; fi
    fi
  done
  chmod 600 "$ENV_FILE"
fi

echo "Building and starting (first build takes a few minutes)..."
dc up -d --build --wait --wait-timeout 300
echo
dc ps
echo
echo "DevForge is up locally: $LOCAL_URL"
echo "Make it public (temporary URL):  scripts/start-tunnel.sh"
