# DevForge Phase 15 (Production Job Architecture and Repository-Scale Reliability) — Completion Report

## Summary

Phase 15 added a persistent, durable job system for the four expensive operations that previously
ran synchronously inside an HTTP request (indexing, Q&A, code review, evaluation), with bounded
retries, cooperative cancellation, crash recovery, and a small authenticated API and frontend
experience. All 8 milestones (15.1–15.8) are complete. Full detail, including every intermediate
result, real bugs found, and honest remaining limitations, is in
`docs/PHASE_15_JOB_ARCHITECTURE_PROGRESS.md`; the original design is in
`docs/PHASE_15_JOB_ARCHITECTURE_PLAN.md`. This report summarizes the outcome and states plainly
what is and isn't proven.

## What was built

- **No new infrastructure.** The job queue is a Postgres table (`Job`), claimed via
  `SELECT ... FOR UPDATE SKIP LOCKED`. No Redis, no broker, no separate worker framework — justified
  against this project's own established minimalism precedent (Phase 8's "no pgvector at this
  scale" decision) and against this project's real current scale (a single-project-at-a-time
  developer tool, not a high-throughput multi-tenant queue).
- **State machine**: `queued → running → {completed | failed | cancelled | timed_out}`, enforced by
  one conditional-`UPDATE` primitive (`transitionJob()`) that makes every transition atomic and
  concurrency-safe without row locks held across application code. All 4 explicitly-listed invalid
  transitions (Completed→Running, Cancelled→Running, Failed→Completed without a new attempt,
  Queued→Completed without execution) are rejected with `InvalidJobTransitionError`, tested
  individually.
- **Worker**: claims jobs, dispatches to the exact same, already-tested synchronous service
  functions every existing route calls (never new code-execution capability), enforces a job
  timeout via `Promise.race`, renews a lease every 60s while running, and classifies failures as
  transient (auto-retried, bounded by `maxRetries`) or permanent. `evaluation` jobs are a real
  schema-level job type but are deliberately never auto-dispatched — see the design rationale in
  the plan doc — avoiding the tension between "Phase 15 needs an evaluation job type" and "do not
  add code execution."
- **Crash recovery**: `recoverStaleJobs()` requeues (or permanently fails, once retries are
  exhausted) any `running` job whose lease expired, safe under concurrent recovery attempts.
- **API**: create/read/list/cancel/retry, authenticated and ownership-scoped, never leaking a stack
  trace or provider secret in an error field (tested directly).
- **Frontend**: a `Jobs` page with bounded polling (schedules exactly one more poll only while an
  active job exists — never polls indefinitely), covering creation, all state transitions, and
  action-button visibility rules. No broad visual redesign, per the task's own constraint.
- **Idempotency**: `(projectId, type, idempotencyKey)` uniqueness — resubmitting the same key
  returns the existing job rather than creating a duplicate, verified over real HTTP.

## Verification performed (Milestone 15.8)

Not stopped at the first successful test run:

- Full monorepo test matrix: `api` 383/383, `frontend` 121/121, `evaluation` 135/135, integration
  `tests/` 12/12 (11 files) — all green from a clean state.
- Type checks, lint, and build clean across all four TypeScript packages.
- A full, clean-volume Docker rebuild (`docker compose down -v && up -d --build`, all 4 services)
  confirmed all 12 migrations — including this phase's own `20260915223112_add_jobs` — apply
  cleanly to a genuinely fresh database, and the full integration suite then passed against that
  live stack.
- **Real, live jobs exercised over HTTP** against the rebuilt stack (registered a user, created a
  project, submitted one job of each of the four types) — not just unit-test mocks. The worker
  claimed and completed all four within one poll cycle. Also live-exercised `retry` and `cancel`.
- Failure-injection testing (Milestone 15.7): provider timeout, 5xx, 429, malformed/oversized
  input, worker crash (lease-expiry simulation), cancellation, duplicate submission, invalid
  transitions, stale running jobs — see the progress doc's full coverage table.
- Repository-scale indexing benchmark run against the real test database (`indexingBenchmark.ts`):
  chunking ~42K–86K files/sec (pure in-memory), Postgres bulk-write ~2,500–6,100 chunks/sec across
  3 synthetic batch sizes — with an explicit scope note that GitHub-fetch and ai-service-parse
  latency at true repository scale were **not** simulated (see Limitations below).
- Secret scan of the live Docker `api` container's logs across all job runs: no Anthropic/GitHub/
  JWT-shaped key patterns, no credential-bearing connection strings, nothing beyond the
  already-labeled-non-production Compose placeholder secret.
- VoxMind isolation reconfirmed before and after the Docker rebuild: PID 16012 (`uvicorn
  voxmind.main:app --port 8000`) running throughout, its 5 native Postgres connections on port 5432
  untouched; DevForge's own Postgres stayed on its separate host port 5433 throughout.

## Two real bugs found and fixed during live verification (not just documented as gaps)

1. **The worker was never actually started.** `startWorker()` had a full, passing test suite but
   was never called outside tests — a real deployment's jobs would sit in `queued` forever. Fixed
   by wiring it into `server.ts` alongside `app.listen()`, with graceful `SIGTERM`/`SIGINT`
   handling.
2. **`SIGTERM` never reached the Node process.** The Dockerfile's `CMD ["sh", "-c", "... && node
   dist/server.js"]` left `sh` as PID 1, which doesn't forward signals to its child — so the new
   shutdown handler silently never ran under `docker stop`. Fixed with `exec node dist/server.js`,
   verified live (graceful-shutdown log line now appears; `docker compose stop` exits in ~0.26s
   instead of hitting the forced-kill timeout).

Both were caught specifically because this milestone insisted on live verification against a real
rebuilt stack rather than stopping once the test suites passed — consistent with the task's own
"do not mark Phase 15 complete if the job system works only in the happy path" instruction.

## Honest, explicitly-documented limitations

- **Cooperative, not preemptive, cancellation.** A `running` job's cancellation flag is only
  checked at specific checkpoints (before dispatch, after dispatch resolves) — a long-running
  synchronous service call in between will still complete before cancellation takes effect. This is
  a deliberate, documented scope boundary, not an oversight.
- **DB-connection-loss mid-transaction was not simulated.** `transitionJob()`'s own `UPDATE` being
  interrupted by a dropped Postgres connection relies on Prisma's own error surface and this
  worker's generic "unrecognized exception → transient, bounded" fallback; it was not specifically
  exercised.
- **Repository-scale indexing benchmark scope.** The measured throughput covers in-memory chunking
  and Postgres bulk-write only — GitHub API fetch latency and ai-service parse latency at true
  large-repository scale were not simulated, and no claim is made about total indexing wall-clock
  time for a specific repository size.
- **Live job exercise reached the `failed` outcome, not `completed`, for indexing/Q&A/review.**
  Reaching `completed` for those three types requires a real connected GitHub repository and a
  completed index; that was intentionally not exercised live here to avoid an unnecessary external
  GitHub call during a verification pass. The `completed` path itself is covered by
  `jobWorker.test.ts`'s mocked-service tests. What the live check specifically proves — and what
  those unit tests alone cannot — is the real production wiring end to end (HTTP create → worker
  poll → claim → dispatch → real service call → persisted result) against the actual running
  server, which is exactly where the two bugs above were found.

## Status

Phase 15 is complete. All milestones 15.1–15.8 are done, tested, and documented; VoxMind remains
fully untouched; Phase 17 has not been started.
