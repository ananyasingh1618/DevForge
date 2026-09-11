# Scripts

- `setup-test-db.sh` — creates the dedicated `devforge_test` Postgres database (used by
  `api/vitest.config.ts`) and applies migrations to it. Run once after
  `docker compose up -d postgres` on a fresh volume (including after `docker compose down
  -v`), before running `pnpm test` in `api/`.
