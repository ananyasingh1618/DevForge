#!/usr/bin/env bash
# Creates the dedicated devforge_test database (used by api/vitest.config.ts's
# test env) if it doesn't already exist, and applies migrations to it.
# Run once after `docker compose up -d postgres` on a fresh volume (including
# after a `docker compose down -v`), before running `pnpm test` in api/.
set -euo pipefail

PGHOST=${PGHOST:-localhost}
PGPORT=${PGPORT:-5433}
PGUSER=${PGUSER:-devforge}
export PGPASSWORD=${PGPASSWORD:-devforge}

EXISTS=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d devforge -tAc \
  "SELECT 1 FROM pg_database WHERE datname = 'devforge_test'")

if [ "$EXISTS" != "1" ]; then
  echo "Creating devforge_test database..."
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d devforge -c "CREATE DATABASE devforge_test;"
else
  echo "devforge_test database already exists."
fi

echo "Applying migrations to devforge_test..."
DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/devforge_test" \
  pnpm --filter @devforge/api exec prisma migrate deploy

echo "Done."
