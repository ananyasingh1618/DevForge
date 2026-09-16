#!/usr/bin/env bash
# Restores a backup created by scripts/backup-db.sh into a target database
# (Phase 17, Milestone 17.3 — see docs/BACKUP_AND_RESTORE.md). Restores
# into RESTORE_TARGET_DB (default: a fresh, disposable
# "devforge_restore_test" database, never the live "devforge" database by
# default) — an explicit, deliberate safety default, since an accidental
# restore into the live database would silently discard everything written
# since the backup was taken. Pass RESTORE_TARGET_DB=devforge explicitly to
# restore over the real database (e.g. during an actual incident), and only
# after taking a fresh backup of the current state first.
set -euo pipefail

COMPOSE_SERVICE=${COMPOSE_SERVICE:-postgres}
PGUSER=${PGUSER:-devforge}
RESTORE_TARGET_DB=${RESTORE_TARGET_DB:-devforge_restore_test}
BACKUP_FILE=${BACKUP_FILE:?"Set BACKUP_FILE to the .dump file produced by backup-db.sh"}

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

echo "Restoring $BACKUP_FILE into database '$RESTORE_TARGET_DB' (service: $COMPOSE_SERVICE) ..."

if [ "$RESTORE_TARGET_DB" != "devforge" ]; then
  echo "Recreating '$RESTORE_TARGET_DB' fresh before restore ..."
  docker compose exec -T "$COMPOSE_SERVICE" psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS ${RESTORE_TARGET_DB};"
  docker compose exec -T "$COMPOSE_SERVICE" psql -U "$PGUSER" -d postgres -c "CREATE DATABASE ${RESTORE_TARGET_DB};"
else
  echo "WARNING: restoring into the live 'devforge' database. This will overwrite" >&2
  echo "existing data. Press Ctrl-C within 5 seconds to abort." >&2
  sleep 5
fi

docker compose exec -T "$COMPOSE_SERVICE" pg_restore -U "$PGUSER" -d "$RESTORE_TARGET_DB" --clean --if-exists --no-owner < "$BACKUP_FILE"

echo "Restore complete into '$RESTORE_TARGET_DB'."
ROW_CHECK=$(docker compose exec -T "$COMPOSE_SERVICE" psql -U "$PGUSER" -d "$RESTORE_TARGET_DB" -tAc "SELECT count(*) FROM users;" 2>/dev/null || echo "0")
echo "Sanity check — rows in the users table after restore: $ROW_CHECK"
