# DevForge Phase 15 (Production Job Architecture and Repository-Scale Reliability) — Plan

## Scope

A persistent, durable job system for the four expensive operations that currently run
synchronously inside an HTTP request: repository indexing, Q&A, code review, and evaluation runs.
Jobs survive an API process restart, are never executed twice for the same logical attempt, have
bounded retries with classified failure handling, and expose their state (queued/running/
progress/completed/failed/cancelled/timed-out) through a small, authenticated API and a
corresponding frontend experience. Scoped to real, testable reliability properties — not a
general-purpose task-queue product.

## Architecture decision: no new infrastructure

**No Redis, no external queue broker, no separate worker framework.** Justification, matching
this project's own established minimalism precedent (Phase 8's "no pgvector, no vector DB at this
scale" decision, documented in `docs/RETRIEVAL_PHASE_PLAN.md`):

- The existing PostgreSQL database (already the system of record for every other durable entity in
  this codebase) can safely coordinate job claiming across multiple worker processes using the
  standard `SELECT ... FOR UPDATE SKIP LOCKED` pattern — a well-established, textbook technique for
  building a simple, safe job queue directly on a relational database (used in production by many
  real systems, e.g. Postgres-backed queue libraries like `pgboss`/`graphile-worker` use exactly
  this primitive internally). It requires zero new services, zero new Docker containers, and zero
  new operational surface area.
- This project's actual current scale (a single-project-at-a-time developer tool, not a multi-
  tenant SaaS processing thousands of jobs/second) does not need a dedicated message broker's
  throughput or delivery guarantees. A durable Postgres table gives every property this phase's
  acceptance criteria actually require: durability, exactly-once claiming, retry tracking,
  cancellation, and observability — without adding a new failure domain (a broker that can itself
  go down, need its own backup/restore story, and need its own Docker health check).
- If DevForge's real usage ever outgrows this (very high job volume, sub-second latency
  requirements), a message broker becomes justified then, with real production telemetry driving
  the decision — not speculatively now.

**Worker process**: a small polling loop, runnable either in-process inside the existing `api`
Node process (default, simplest) or as a separate `api` container command
(`node dist/worker.js`) for independent scaling — both paths share the exact same job-claiming and
execution code, so there is no behavioral difference between the two deployment modes, only a
process-topology one.

## Job model

`Job` (Prisma model, table `jobs`):

| Field | Type | Purpose |
|---|---|---|
| `id` | uuid | Primary key |
| `projectId` | uuid → `Project` | Ownership path (see Phase 16) |
| `type` | enum: `indexing`/`qa`/`review`/`evaluation` | What the job does |
| `status` | enum: `queued`/`running`/`completed`/`failed`/`cancelled`/`timed_out` | Current state |
| `input` | JSON | The operation's own input (e.g. a Q&A question, a review scope) |
| `output` | JSON, nullable | The operation's result once completed |
| `progress` | JSON, nullable | Free-form progress payload (e.g. `{filesProcessed, totalFiles}`) |
| `errorCode` | string, nullable | A stable, classified failure reason |
| `errorMessage` | string, nullable | Human-readable detail — never a raw provider stack trace |
| `retryCount` | int, default 0 | How many attempts have been made |
| `maxRetries` | int, default 3 | Bound on retries for a transient failure |
| `idempotencyKey` | string, nullable, unique per `(projectId, type, idempotencyKey)` | Caller-supplied de-duplication key |
| `correlationId` | uuid | Traces a job across logs/observability |
| `workerId` | string, nullable | Which worker process currently holds the lease |
| `leaseExpiresAt` | timestamp, nullable | Heartbeat/lease expiry — a `running` job past this is stale |
| `cancelRequested` | boolean, default false | Cooperative cancellation flag the worker checks |
| `startedAt` / `completedAt` / `cancelledAt` | timestamp, nullable | Lifecycle timestamps |
| `createdAt` / `updatedAt` | timestamp | Standard bookkeeping |

## State machine

```
queued ──(worker claims)──> running ──(success)──> completed
queued ──(cancel)─────────> cancelled
running ──(cancelRequested seen)──> cancelled
running ──(transient failure, retryCount < maxRetries)──> queued (retryCount++)
running ──(permanent failure, or retries exhausted)──> failed
running ──(lease expires, no heartbeat)──> queued (retryCount++) or failed (if retries exhausted)
running ──(exceeds job timeout)──> timed_out
```

Explicitly invalid (rejected by the service layer, never silently allowed):
`completed → running`, `cancelled → running`, `failed → completed` (without a fresh `retryJob`
call that resets to `queued` with an incremented `retryCount`, never a direct edit), `queued →
completed` (skipping execution). Enforced by a single `transitionJob()` function with an explicit
allowed-transitions table — see Milestone 15.2.

## Non-goals

No autonomous code modification, execution, commits, PRs. No new infrastructure (Redis/broker/
separate worker framework). No change to VoxMind. No work beyond Phase 16.
