# DevForge Phase 15 (Production Job Architecture and Repository-Scale Reliability) — Progress Log

See `docs/PHASE_15_JOB_ARCHITECTURE_PLAN.md` for the full design. This log tracks each
milestone's implementation, verification, and commit hashes as work proceeds.

## Milestone 15.1 — Architecture and job model

Designed a Postgres-native job queue (`SELECT ... FOR UPDATE SKIP LOCKED`) with no new
infrastructure, justified against this project's own established minimalism precedent (Phase 8's
"no pgvector at this scale" decision). Defined the `Job` model's full field set (ownership,
input/output, progress, error classification, retry tracking, idempotency key, correlation id,
lease/heartbeat, cooperative cancellation) and the explicit state-transition table.

Deliverables: `docs/PHASE_15_JOB_ARCHITECTURE_PLAN.md`, this progress log.

Commit: `b68aa1a`

## Milestone 15.2 — Database and persistence

Added the `Job` model (migration `20260915223112_add_jobs`): durable job records with ownership
(`projectId`), input/output/progress as JSON, classified error fields (`errorCode`/
`errorMessage`, never a raw stack trace), bounded retry tracking, a unique
`(projectId, type, idempotencyKey)` constraint for de-duplication, a lease/heartbeat pair for
stale-job recovery, and a cooperative `cancelRequested` flag. Indexes support the three real query
patterns: active-job claiming (`status, createdAt`), per-project recent-jobs listing
(`projectId, createdAt`), and stale-lease recovery (`status, leaseExpiresAt`).

Implemented `api/src/services/jobs.ts`: a single `transitionJob()` primitive funnels every state
change through one conditional `UPDATE ... WHERE id = $1 AND status IN (...)`, so two concurrent
callers racing to transition the same job can never both succeed — one wins, the other's `UPDATE`
affects zero rows and gets a clear `InvalidJobTransitionError`, not a silent overwrite or a lost
update. An explicit `ALLOWED_TRANSITIONS` table is the single source of truth for valid
transitions, checked defensively even at call sites that are already correct. `claimNextJob()`
uses `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction — the standard, safe primitive for
exactly-once job claiming across concurrent workers.

**32 new tests** (`api/src/services/jobs.test.ts`), including real concurrency tests (two workers
racing `claimNextJob()` for the same single job — exactly one succeeds; two concurrent
`recoverStaleJobs()` calls — the same stale job is only recovered once, `retryCount` not double-
incremented), every invalid transition the task's own examples name (completed→running,
cancelled→running, failed→completed without a new attempt, queued→completed), idempotency
(same key returns the existing job; different keys/types don't collide), bounded manual and
automatic retries, lease-based stale-job recovery, and ownership (404, never distinguishing
"doesn't exist" from "not yours"). Full `api` suite: 355/355 (323 + 32), zero regressions.

Commit: `b68aa1a`

## Milestone 15.3 — Worker implementation

Added `api/src/services/jobWorker.ts`: a polling loop (`startWorker()`) that claims jobs via
`claimNextJob()` and dispatches to the exact same, already-tested synchronous service functions
every existing route already calls (`startIndexing`/`reindexRepository`, `askQuestion`,
`createReview`) — the worker is a thin, durable wrapper around real, existing operations, not a
new code-execution capability. `evaluation` jobs are deliberately never auto-dispatched (see the
file's own header comment): automatically invoking the separate `evaluation/` package's CLI from
a worker would mean the API triggering an external process in response to a request, which this
phase's own "do not add code execution" rule rules out — evaluation runs remain a manually-invoked
`pnpm eval`, unchanged from every prior phase. An `evaluation`-typed job still fails cleanly and
immediately with a clear `JOB_TYPE_NOT_DISPATCHABLE` reason rather than silently hanging.

`classifyError()` maps a thrown `AppError`'s status to transient (5xx — worth an automatic,
bounded retry) or permanent (4xx — retrying identical input against identical state cannot
succeed); an unrecognized exception is treated as transient but still bounded by the job's own
`maxRetries`, and its raw detail is never surfaced in `errorMessage` (a fixed, safe summary is
used instead — verified by a dedicated test with a deliberately secret-shaped error string).
`runOneClaimedJob()` wraps the dispatched call in a real timeout (`withTimeout()`, `Promise.race`
against `setTimeout`) and checks the cooperative `cancelRequested` flag both before dispatching
and immediately after the dispatched call resolves — a job cancelled while its underlying
operation is still in flight is marked `cancelled`, not `completed`, even though the operation
itself already finished (a known, documented limit: true mid-operation cancellation of the single
synchronous service call is not achievable without deeper instrumentation of each service; this
worker cancels at the checkpoints available to it, not silently drops a cancel request). Lease
renewal runs on its own interval alongside the dispatched call so a genuinely long-running job
doesn't get mistaken for a crashed worker by `recoverStaleJobs()`. `startWorker()`'s `stop()`
awaits any in-flight job before resolving — a graceful shutdown, never an abrupt kill mid-write.

13 new tests (`jobWorker.test.ts`), mocking only the three dispatch-target service modules (each
already has its own full test suite elsewhere) to test the worker's own orchestration in
isolation: dispatch routing (including `force: true` → `reindexRepository`), a qa job missing its
required input failing cleanly without ever calling the service, transient-vs-permanent error
classification and the resulting requeue-vs-fail behavior, secret-safe error messages, cancellation
both before and during a dispatched call, and a real (not faked) timeout. Full `api` suite:
368/368 (355 + 13), zero regressions.

Commit: `8c59bc3`

## Milestone 15.4 — API changes

Added `POST/GET /projects/:projectId/jobs`, `GET /projects/:projectId/jobs/:jobId`,
`POST /projects/:projectId/jobs/:jobId/cancel`, `POST /projects/:projectId/jobs/:jobId/retry` —
all session-authenticated (`requireAuth`) and ownership-checked through the same
`requireOwnedProject`/`requireOwnedJob` pattern every other project-scoped resource in this
codebase already uses, returning the same 404-for-both-"doesn't exist"-and-"not yours" shape (an
intruder's request through their own valid project id for another user's job id still 404s —
verified by a dedicated test). Validation via Zod schemas (`schemas/jobs.ts`) matches this
codebase's existing depth: the HTTP layer validates shape (a real job `type`, `input` is a JSON
object), and `jobWorker.ts`'s own `dispatch()` validates each job type's specific required fields
a second time — the same validated-at-the-boundary-then-validated-again-at-use pattern Phase 9/10
already established for Q&A/review input.

12 new Supertest route tests: auth/ownership across all five endpoints, idempotent job creation
over real HTTP, the full create→read→list→cancel lifecycle, a rejected double-cancel (409, not a
silent 200), a rejected retry of a never-failed job, status/type filtering, and — end to end
through the real worker dispatch path — confirmation that a failed job's error fields never
contain anything stack-trace-shaped. Full `api` suite: 380/380 (368 + 12). `tsc -b`/`eslint`/build
all clean.

Commit: `<pending>`
