# Troubleshooting

## "Database `devforge_test` does not exist" when running `pnpm test` in `api/`

The dedicated test database was wiped — almost always because of a `docker compose down -v` (the `-v` removes the Postgres volume). Fix:

```bash
docker compose up -d postgres
bash scripts/setup-test-db.sh
```

This is the single most common local-dev gotcha in this project; the script is idempotent (safe to re-run any time) and always re-creates the database and re-applies migrations.

## `docker compose up` fails with `api` unhealthy, logs show `Invalid environment configuration`

`api` refused to start because [`env.ts`](../api/src/env.ts)'s validation rejected a variable — the log line lists exactly which one and why (e.g. a `SESSION_SECRET` matching a known placeholder, or a `DATABASE_URL` pointing at `devforge_test` while `NODE_ENV=production`). See [CONFIGURATION.md](CONFIGURATION.md#production-only-guardrails) for the exact guardrails and how to satisfy them. `docker compose logs api` shows the full validation error.

## A single test fails under the full suite but passes when run alone

A known, pre-existing environmental flakiness on resource-constrained machines under heavy parallel `vitest` worker load — connection-level errors like "socket hang up" or a body-parser "Parse Error" on an otherwise-correct test, never reproducible when that one file is re-run in isolation immediately after. This is not a real regression; confirm by re-running just that file:

```bash
cd api && npx vitest run src/path/to/the.test.ts
```

If it passes in isolation, it's this known flakiness, not a code problem. If you want more headroom, reduce parallelism: `npx vitest run --pool=forks --poolOptions.forks.maxForks=2`.

## `prisma migrate deploy` fails on container start

Check `docker compose logs api` for Prisma's own error. Common causes:

- Postgres isn't actually reachable yet (shouldn't happen given `depends_on: condition: service_healthy`, but check `docker compose ps postgres`'s health status if it does).
- A migration was hand-edited or the `_prisma_migrations` table is out of sync with `api/prisma/migrations/` on disk (see [ROLLBACK.md](ROLLBACK.md#database-migration-rollback) — never hand-edit migration history outside of an actual incident).

## `GET /ready` returns 503 but `GET /health` is 200

This is by design, not a bug — see [OPERATIONS.md](OPERATIONS.md#health-checks). It means the process is up but Postgres is unreachable. Check `docker compose ps postgres` and `docker compose logs postgres`.

## A background job is stuck in `running`

Check `GET /jobs/:id` for its `leaseExpiresAt`. If the lease has expired, it should self-recover (transition to `queued` for a retry, or terminal `failed`) within one stale-job-sweep interval (60 seconds) of any worker being up — see [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md#a-service-restarts-during-work-including-worker-unavailable). If it's still stuck well past that, confirm at least one `api` container is actually running (the worker runs in-process with `api` — see [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md#architecture-note-relevant-to-every-scenario-below)); if none is, start one.

## A request that should work returns 401

Confirm the session cookie is actually being sent (browsers require `credentials: "include"` on cross-origin fetches; `curl` requires `-b <cookie jar>`). Confirm `FRONTEND_ORIGIN` matches the origin the browser is actually running on exactly — CORS with `credentials: true` requires an exact origin match, not a wildcard.

## A request that should be rejected for another user succeeds (or vice versa)

This would be a serious regression in the ownership-checking pattern every project/job route uses (`requireOwnedProject`/`requireOwnedJob` in `api/src/services/jobs.ts` and `api/src/lib/ownership.ts`) — see [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md#a-user-accesses-another-users-projectjob). This should never happen given the current test coverage (13 files / 162 tests gate this in CI — [CI_CD.md](CI_CD.md#jobs)); if it does, treat it as a critical security incident, not a routine bug.

## `docker compose build` is slow or fails pulling base images

The build context is the repository root for `api` and `frontend` (`context: .` in `docker-compose.yml`, so pnpm can resolve the workspace) — a large `node_modules` or `.git` directory not covered by `.dockerignore` can slow context transfer. Confirm `.dockerignore` excludes `node_modules/` and `.git/` at the root.
