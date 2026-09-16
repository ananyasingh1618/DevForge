#!/usr/bin/env bash
# Creates a compressed, timestamped logical backup of the running
# docker-compose Postgres instance (Phase 17, Milestone 17.3 — see
# docs/BACKUP_AND_RESTORE.md for the full recovery-point/recovery-time
# discussion). Uses `docker compose exec` so it works identically whether
# this script is run from a host with or without a local `pg_dump`
# installed — the dump runs *inside* the postgres container, using the
# exact server-matching pg_dump version that ships with the image.
set -euo pipefail

COMPOSE_SERVICE=${COMPOSE_SERVICE:-postgres}
PGUSER=${PGUSER:-devforge}
PGDATABASE=${PGDATABASE:-devforge}
BACKUP_DIR=${BACKUP_DIR:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/backups"}

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_FILE="$BACKUP_DIR/devforge-${TIMESTAMP}.dump"

echo "Backing up '$PGDATABASE' from the '$COMPOSE_SERVICE' service to $OUT_FILE ..."

# Custom format (-Fc): compressed, supports selective/parallel restore via
# pg_restore, and is pg_dump's own recommended format for anything beyond
# a quick plain-SQL inspection.
docker compose exec -T "$COMPOSE_SERVICE" pg_dump -U "$PGUSER" -Fc "$PGDATABASE" > "$OUT_FILE"

SIZE=$(du -h "$OUT_FILE" | cut -f1)
echo "Backup complete: $OUT_FILE ($SIZE)"
echo ""
echo "To restore this backup into a fresh database, run:"
echo "  BACKUP_FILE=$OUT_FILE ./scripts/restore-db.sh"
