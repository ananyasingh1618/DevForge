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

Commit: TBD

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

Commit: `<pending>`
