#!/usr/bin/env bash
# Stop only the tunnel started by start-tunnel.sh (identified by pid file AND
# command line) — never any other cloudflared, e.g. another project's.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_prod_common.sh"
if tunnel_pid_alive; then
  kill "$(cat "$PID_FILE")" && echo "Tunnel stopped."
else
  echo "No DevForge tunnel running."
fi
rm -f "$PID_FILE" "$URL_FILE"
