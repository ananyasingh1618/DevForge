# Incident Response

## Architecture note relevant to every scenario below

The background job worker runs **in-process** with the `api` server (`api/src/server.ts` calls `startWorker()` directly at boot) — there is no separate worker service or container. This means "the worker is unavailable" and "the `api` process is unavailable" are the same failure domain in this deployment, not two independent ones. What *is* independent is job **state**, which lives in Postgres, not in worker memory — so an `api` process (and with it, its in-process worker) can be killed, crash, or be redeployed at any point, and every job it had claimed is recovered by the next worker that starts, via the stale-lease mechanism described below. This is a deliberate, documented architectural choice, not an oversight.

## Known failure modes and verified behavior

Each of these was verified live against the real running `docker-compose` stack during Phase 17, not assumed from reading the code. Where a live check turned up a real defect, the defect was fixed and the fix was re-verified live before being recorded here (see "malformed request" below).

### Database unavailable

**Verified**: `docker compose stop postgres` while the stack is running.

- `GET /health` — stays `200`. Liveness never touches the database by design (see [OPERATIONS.md](OPERATIONS.md#health-checks)) — a database outage must not itself cause the API container to be killed and restarted, which would make the outage worse.
- `GET /ready` — becomes `503 {"error":{"code":"NOT_READY","message":"Database is not reachable."}}`. The real connection error (e.g. `ECONNREFUSED`) is logged server-side (through the redacting logger) but never appears in the response body — confirmed by asserting `JSON.stringify(response.body)` does not contain `ECONNREFUSED`.
- An authenticated route hit with a stale/fake session cookie returns a clean `401 UNAUTHENTICATED` rather than crashing or leaking a raw driver error.
- Recovery: `docker compose start postgres` — `/ready` returns to `200` within a few seconds, no `api` restart required.
- Automated regression: `api/src/routes/health.test.ts`, the `/ready` "returns 503 NOT_READY... when the database is unreachable" test (mocks `prisma.$queryRaw` to reject).

### ai-service (AI provider) unavailable

`ai-service`'s `/health` never depends on `GEMINI_API_KEY`/`ANTHROPIC_API_KEY`/`VOYAGE_API_KEY` being set — it reports healthy regardless. Routes that actually need a model return a real `503 PROVIDER_NOT_CONFIGURED` (unset key) or `503 AI_SERVICE_UNAVAILABLE` (the api's `aiServiceClient.ts` cannot reach `ai-service` at all — e.g. the container is stopped) instead of hanging or returning a fabricated result. `/ready` deliberately does **not** check `ai-service` — it's a soft dependency whose failure only affects a subset of features (requirements/PRD/architecture/epics/QA/code-review generation, embeddings), not the whole API. See `api/src/lib/aiServiceClient.ts` and `api/src/routes/health.ts`'s own comment on this design choice.

### GitHub integration failure

An unset `GITHUB_TOKEN_ENCRYPTION_KEY` disables repository connection entirely (routes return `503 GITHUB_INTEGRATION_NOT_CONFIGURED`); a configured-but-failing GitHub call (expired token, revoked access, rate limit, network failure) surfaces as a specific error code from `githubClient.ts` rather than a generic 500, and never leaves a project's indexing state stuck — see `api/src/routes/repository.test.ts` and `api/src/routes/codebaseIndex.test.ts` for the covered cases.

### A job times out

A job exceeding its type's timeout transitions `running → timed_out` (not left running forever), and is retried per the same bounded-retry policy as a `failed` job (up to `maxRetries`, default 3) before becoming terminal. See [OPERATIONS.md](OPERATIONS.md#background-jobs).

### A request is malformed

Zod-validated routes return a clean `400 VALIDATION_ERROR` with field-level details for missing fields, wrong types, etc. (verified live: empty body, wrong-typed fields). **A real defect was found and fixed during this verification**: a syntactically invalid JSON body (e.g. `{not valid json`) was falling through to a `500 INTERNAL_ERROR` instead of a `400`, because `express.json()`'s parse failure is a body-parser `SyntaxError`, not an `AppError`, and the centralized error handler wasn't specifically recognizing that shape. Nothing was ever leaked to the client either way, but the status code was wrong. Fixed in `api/src/app.ts`'s error handler (a specific check for a `SyntaxError` with `status === 400` ahead of the generic fallback) and re-verified live against a rebuilt container: `curl -X POST .../auth/register -d '{not valid json'` now returns `400 VALIDATION_ERROR`. Regression test: `api/src/routes/health.test.ts`, "malformed request body" describe block.

### A user accesses another user's project/job

Every project- and job-scoped route checks ownership before returning data, and a non-owned resource returns the same `404 NOT_FOUND` as a genuinely nonexistent one — never a `403` that would confirm the resource exists but belongs to someone else. Covered extensively (13 test files, 162 tests as of this phase — see [CI_CD.md](CI_CD.md#jobs)'s `security-regression` job) including `api/src/multiUserIsolation.test.ts` and `api/src/routes/projects.ownership.test.ts` specifically.

### A service restarts during work (including "worker unavailable")

**Verified two ways.**

1. **Live, via a real graceful restart**: `docker compose restart api` while the stack was serving traffic. The process logged `Received SIGTERM, shutting down gracefully...` and the container returned to `healthy` (and `/ready` to `200`) within seconds — no manual intervention.
2. **Live, via a simulated abandoned job** (standing in for a hard kill mid-job, e.g. an OOM kill or `docker kill`, where graceful shutdown never gets to run): a job row was inserted directly into the live database with `status = "running"` and an already-expired `leaseExpiresAt`, simulating a worker that died while holding it. Within one stale-job-sweep interval (60s), a live worker's `recoverStaleJobs()` reclaimed it — the job was picked back up by a **new** worker ID, attempted, and reached a clean terminal `failed` state with a real, specific error (`VALIDATION_ERROR: Job input is missing a required 'question' string` — expected, since the job's input was synthetic and could never have succeeded) rather than being silently lost or stuck forever. Test data was deleted after verification. Automated coverage of the same mechanism at the unit level: `api/src/services/jobs.test.ts` and `api/src/services/jobWorker.test.ts`'s stale-lease/recovery tests.

## Escalation checklist (for a real incident)

1. Check `docker compose ps` — which service(s) report unhealthy?
2. Check `GET /health` and `GET /ready` — is this a liveness or readiness problem? (See [OPERATIONS.md](OPERATIONS.md#health-checks) for what each means operationally.)
3. `docker compose logs <service> --since 15m` — find the `category: "server"` (5xx) lines; grep by `requestId` if a specific user report includes one.
4. If the database is the problem: see the "Database unavailable" behavior above (the API degrades cleanly, no immediate action required beyond restoring Postgres) and, if data may have been lost or corrupted, [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md#disaster-recovery-procedure).
5. If a bad deploy is the problem: see [ROLLBACK.md](ROLLBACK.md).
6. If jobs appear stuck: check `GET /jobs` for the affected project — a job stuck in `running` past its lease should self-recover within one sweep interval (60s); if it doesn't, check `docker compose logs api | grep recoverStaleJobs` equivalents / restart `api` to force a fresh sweep.
