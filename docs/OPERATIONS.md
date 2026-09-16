# Operations

Day-to-day operational reference: health checks, logs, metrics, background jobs, and what to look at when something is wrong. For incident procedure specifically, see [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md); for restoring from backup, see [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md).

## Health checks

Two distinct endpoints, on purpose (`api/src/routes/health.ts`):

| Endpoint | Checks | Used for |
|---|---|---|
| `GET /health` | The process is up and its event loop is responsive. **Never touches the database.** | Liveness — "should this container be restarted?" A slow/down database must not itself cause `api` to be restarted, which would make an outage worse by killing an otherwise-healthy process. |
| `GET /ready` | The above, plus a real `SELECT 1` against Postgres. | Readiness — "should this container receive traffic?" Returns `503 {"error":{"code":"NOT_READY","message":"Database is not reachable."}}` when the database is unreachable — the raw connection error is logged server-side but never sent to the client. |

`ai-service` is deliberately **not** checked by `/ready` — it's a soft dependency; its own routes already degrade per-request to a real `503 PROVIDER_NOT_CONFIGURED` / `AI_SERVICE_UNAVAILABLE` rather than taking the whole API out of rotation for a failure that only affects a subset of features (requirements/PRD/architecture/epics/QA/code-review generation, embeddings).

Each container also declares a Docker `HEALTHCHECK` (in its own Dockerfile) that `docker compose ps` reports on:

- `api`: hits its own `/health` via Node's built-in `fetch`.
- `frontend`: hits `http://localhost:4173` via the same mechanism.
- `ai-service`: hits its own `/health` via `urllib.request`.

Check live status any time with `docker compose ps` (look at the `Health` column) or directly: `curl -s http://localhost:4000/health`, `curl -s http://localhost:4000/ready`.

## Logs

Every log line is structured JSON (`api/src/lib/logger.ts`): `{ level, message, timestamp, ...fields }`. Level is filtered against `LOG_LEVEL` (see [CONFIGURATION.md](CONFIGURATION.md)) — lines below the configured level are never emitted, not even to be dropped downstream.

**Redaction**: before a line is written, any field whose key looks secret-shaped (`secret`, `token`, `password`, `key`, `authorization`, `cookie`, etc., case-insensitively) has its value replaced with `"[REDACTED]"`. This is automatic and cannot be bypassed by a call site forgetting to redact manually — it happens once, centrally, in the logger itself.

**Request correlation**: `api/src/middleware/requestContext.ts` assigns every incoming request an `X-Request-Id` (reusing one if the client already sent one, generating a fresh UUID otherwise), attaches it to `req.requestId`, echoes it back in the response header, and includes it in that request's structured access-log line (method, route, status, latency) plus every log line the centralized error handler writes for that request. Grep any incident by request ID across the whole log stream.

View live logs: `docker compose logs -f api` (or `frontend`, `ai-service`, `postgres`). Filter to one request: `docker compose logs api | grep '"requestId":"<id>"'`.

**Error categorization**: the centralized error handler (`api/src/app.ts`) logs every error with `category: "client"` (4xx — a validation failure, an auth failure, a not-found) or `category: "server"` (5xx — an actual bug or dependency failure), so a log-based alert can distinguish "users are sending bad requests" from "something is actually broken" at a glance.

## Metrics

`GET /metrics` (Prometheus text exposition format) and `GET /metrics.json` (the same data as plain JSON) are served by `api/src/lib/metrics.ts`. These are **real, in-process counters incremented by actual request and job events** — never fabricated or hardcoded numbers, and this project does not claim any external monitoring provider (Prometheus, Datadog, etc.) is actually deployed; the Prometheus text format is used purely for compatibility if one ever is.

Exposed series:

- `devforge_http_requests_total{route}` — request count by route.
- `devforge_http_responses_total{status_class}` — response count by `2xx`/`3xx`/`4xx`/`5xx`.
- `devforge_http_request_latency_ms{quantile}` — p50/p95/p99 request latency, from a bounded 2000-sample rolling window (never unbounded memory growth).
- `devforge_jobs_total{type,outcome}` — background job count by type and outcome (`completed`/`failed`/`retried`/`timed_out`/`cancelled`).
- `devforge_job_queue_depth{state}` — current `queued`/`running` job counts, read live from the database at scrape time (not cached), so it reflects the true current backlog.

These are **per-process, in-memory, and reset on restart** — a deliberate choice matching this project's existing "no new infrastructure" pattern (the same one `auditLog.ts` and `searchObservability.ts` already use). A real multi-replica deployment would aggregate these at the scrape layer, which is exactly what Prometheus itself is designed to do — this process does not try to maintain global cross-replica state itself.

`/metrics` is unauthenticated, appropriate for this project's local/self-hosted deployment model — see [DEPLOYMENT.md](DEPLOYMENT.md#production-checklist-if-deploying-to-a-real-external-target) for the real limitation this implies for a genuinely public multi-tenant deployment.

## Background jobs

The durable Postgres-native job queue (`api/src/services/jobs.ts`, `jobWorker.ts`) predates Phase 17 (Phase 15) and its behavior is unchanged by this phase's work — Phase 17 only added metrics recording (`recordJobOutcome`) at each real transition, and a queue-depth read for `/metrics`.

- **State machine**: `queued → running → completed | failed | cancelled | timed_out`, plus `failed → queued` and `timed_out → queued` for retries. Every transition is a single conditional SQL `UPDATE ... WHERE status IN (...)`, so two workers racing to claim or complete the same job can never both succeed — one wins, the other gets zero affected rows and a clear `InvalidJobTransitionError` (never a lost update or double-processing).
- **Bounded retries**: a job that fails is requeued up to `DEFAULT_MAX_RETRIES` (3) times before being marked terminally `failed`.
- **Idempotency**: creating a job with the same `(projectId, type, idempotencyKey)` as an existing one returns the existing job instead of creating a duplicate.
- **Leases and stale-job recovery**: a running job holds a 5-minute lease. `recoverStaleJobs()` finds jobs whose lease has expired (the worker that held it died, was killed, or the container restarted mid-job) and either requeues them (if retries remain) or marks them terminally `failed` (if not) — a job can never be silently stuck forever because its worker vanished.
- **Timeouts**: a job that exceeds its own type-specific timeout while running is transitioned to `timed_out` (and retried per the same bounded-retry policy) rather than running forever.
- **Visibility**: `GET /jobs` and `GET /jobs/:id` (project-scoped, ownership-checked) surface every job's current status, retry count, and — for a failed job — its last error, so a failed job is always inspectable and never silently swallowed.
- **Graceful worker shutdown**: on `SIGTERM`/`SIGINT`, the worker stops pulling new jobs and lets its current job finish (bounded by that job's own timeout) before the process exits — see [DEPLOYMENT.md](DEPLOYMENT.md#graceful-shutdown-and-restart).

## Security and resilience posture

Authentication, authorization, project ownership, cross-user isolation, rate limiting, audit logging, secret redaction, input validation, CORS, and security headers were built in Phase 16 and are unchanged by Phase 17 — Phase 17 only added the request-ID/structured-logging layer on top. The full test suite enforcing this (13 files, 162 tests as of this phase) is run as a named CI gate — see [CI_CD.md](CI_CD.md#jobs). Documented failure-mode behavior for each dependency (database down, ai-service down, GitHub integration failure, a timed-out job, a malformed request, cross-user access, a service restart mid-work) is in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md#known-failure-modes-and-verified-behavior).
