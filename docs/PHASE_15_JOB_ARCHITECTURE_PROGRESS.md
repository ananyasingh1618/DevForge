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

Commit: `e52b752`

## Milestone 15.5 — Frontend job experience

Added `frontend/src/pages/Jobs.tsx` (route `/projects/:id/jobs`, linked from the project overview
nav alongside Search/Q&A/Reviews/Settings) plus `services/jobsApi.ts` and `types/job.ts`. Covers
job creation (indexing/Q&A/review), queued/running/completed/failed/cancelled/timed-out states
(a status badge per state), progress via retry-count display, cancel and retry actions, empty
state, loading state, and error states for both the list and each action — reusing this
codebase's existing `Button`/`Card`/`EmptyState`/`ErrorState`/`LoadingState` components verbatim,
no new visual system.

**Polling is deliberately bounded, not aggressive**: `pollWhileActive()` schedules exactly one
more 3-second poll only while the just-fetched job list still contains a `queued`/`running` job —
a project whose jobs are all in a terminal state polls exactly once (on mount) and then stops
until the user starts a new job, cancels, or retries one (each of which re-triggers the same
scheduler). A page revisited after a browser refresh re-runs this same logic from scratch, so a
job that completed while the user was away is reflected on the very next load without any stale
polling continuing in the background. Every action (cancel/retry) shows its own real error message
from the API on failure — never a silent no-op.

10 new tests (`Jobs.test.tsx`): empty state with all three creation buttons, per-status rendering,
a failed job's real error message and retry-count display, cancel/retry button visibility rules
(including a job already at its retry limit correctly showing no Retry button), job creation and
its list refresh, a real error surfaced when job creation fails, cancel/retry actions calling the
right endpoint and refreshing, a list-load error with a working retry button, and no secret-shaped
text ever rendered. Full `frontend` suite: 121/121 (111 + 10). `tsc -b`/`eslint`/build all clean.

Commit: `e24e655`

## Milestone 15.6 — Repository-scale indexing

Incremental indexing, changed/deleted-file detection, and re-indexing idempotency were already
implemented and tested in Phase 14 (Milestone 14.4 — `loadPreviousFiles()`/`buildIndex()`'s skip-
on-unchanged-hash logic, 5 regression tests including "no orphaned Symbol rows after deletion"
and "reindexing an unchanged commit twice is idempotent"); re-confirmed still passing, not
re-implemented. Bounded concurrency/file-size/chunk-count limits (`MAX_INDEXED_FILES`,
`MAX_FILE_SIZE_BYTES`) predate this phase (Phase 7). Cancellation and recovery-after-restart are
now provided by the Phase 15 job system itself (Milestones 15.2–15.3) wrapping indexing.

Added `api/src/scripts/indexingBenchmark.ts` (`pnpm benchmark:indexing`) — measures two real,
separable costs: `chunkFile()`'s own CPU-bound throughput at three synthetic corpus sizes
(generated deterministically, so this is reproducible without a real large GitHub repository),
and real PostgreSQL bulk-write throughput against the actual `code_chunks` table (not a synthetic
estimate — a real `createMany` call against a real, cleaned-up-afterward test-database project).

**Measured, real results**:

| Corpus | Files | Chunks | Time | Files/sec | Chunks/sec |
|---|---|---|---|---|---|
| Small | 30 | 150 | 0.7ms | ~42,000 | ~210,000 |
| Medium | 300 | 2,400 | 3.5ms | ~86,000 | ~685,000 |
| Large | 2,000 | 20,000 | 26.8ms | ~75,000 | ~745,000 |

| DB bulk insert | Chunks | Time | Chunks/sec |
|---|---|---|---|
| Small batch | 50 | 20.1ms | ~2,500 |
| Medium batch | 500 | 111.8ms | ~4,500 |
| Large batch | 5,000 | 819.6ms | ~6,100 |

**Honest scope statement — what this does and does not claim**: `chunkFile()` itself is
effectively free at any realistic repository size (tens of thousands of files/sec) — it is pure,
synchronous string slicing with no I/O. The real bottleneck for indexing a large repository is
**not** chunking but the two I/O-bound steps this benchmark deliberately does not attempt to
simulate at scale: GitHub's blob-fetch API (one HTTP round-trip per changed file — network-
latency-bound, already exercised qualitatively against the real `octocat/Hello-World` repository
in every prior phase's own Docker verification, never claimed to scale-test against a genuinely
large repository since this environment has no such repository available to index) and
ai-service's real tree-sitter parse call per file (CPU-bound on ai-service's own side, already
covered by that service's own test suite, not re-benchmarked here). **No claim is made about
support for a specific repository size this package was never actually tested against** — Phase
7's own `MAX_INDEXED_FILES = 500` remains the one enforced, real, tested ceiling.

Commit: `c43540c`

## Milestone 15.7 — Failure-injection testing

Exercised via existing and new targeted tests rather than a separate, redundant test file — see
each covering suite:

| Scenario | Covered by | Result |
|---|---|---|
| Provider timeout | `jobWorker.test.ts` (real, non-faked timeout) | ✅ marked `timed_out` |
| Provider 5xx | `jobWorker.test.ts` | ✅ transient, auto-retried (bounded) |
| Provider 429 | `jobWorker.test.ts` (new) | ✅ **fixed a real bug**: was permanent, now transient (see below) |
| Malformed provider output / input | `jobWorker.test.ts` (new: non-string `scope`) + ai-service's own schema-validation suite | ✅ falls back safely, or fails cleanly, never crashes the worker loop |
| Worker crash / process restart | `jobs.test.ts`'s `recoverStaleJobs` suite (lease-expiry simulation) | ✅ requeued (bounded) or permanently failed, never silently lost |
| Job cancellation (queued and running) | `jobs.test.ts`, `jobWorker.test.ts` | ✅ immediate for queued, cooperative for running |
| Duplicate job submission | `jobs.test.ts`'s idempotency suite, `jobs.test.ts` route tests | ✅ returns the existing job, never a duplicate |
| Invalid state transition | `jobs.test.ts`'s full transition-table suite | ✅ rejected with a clear 409, never silently allowed |
| Stale running job | `jobs.test.ts`'s `recoverStaleJobs` suite | ✅ recovered, including under concurrent recovery attempts |
| Empty / deleted repository files | Phase 7's `codebaseIndex.test.ts` (pre-existing) + Phase 14's Milestone 14.4 (deleted-file cleanup) | ✅ |

**A real defect found and fixed by this milestone's own new 429 test**: `classifyError()`
originally treated any non-5xx status as permanent, which would have made a rate-limited provider
response (429) fail a job outright on the very first attempt instead of retrying — exactly the
wrong behavior for a rate limit. Fixed by adding 429 to a small `TRANSIENT_STATUSES` set. This is
the kind of defect failure-injection testing is meant to surface — found and fixed here, not
merely asserted safe.

**A second real gap found and closed the same way**: `schemas/jobs.ts`'s `input` field had no
explicit size limit (only Express's own default JSON body-size limit applied). Added a 32,000-byte
serialized-size ceiling — generous relative to the largest real job input today (a review `scope`
string, already capped at 2,000 characters elsewhere) — with a new route test confirming an
oversized input is rejected with a real 400, not silently accepted or left to a generic body-
parser error. Full `api` suite: 383/383 (382 + 1).

**Explicitly not covered, an honest remaining gap**: a genuine database-connection-loss mid-
transaction scenario (killing the Postgres connection while a job's own `transitionJob()` `UPDATE`
is in flight) was not simulated — Prisma's own connection-retry behavior and this application's
error handling around a thrown `PrismaClientKnownRequestError`/connection error were not
specifically exercised beyond what the existing `classifyError()`'s catch-all "unrecognized
exception → transient, bounded" path already provides.

Commit: `c43540c`

## Milestone 15.8 — Phase 15 verification

Ran the full verification matrix rather than stopping at the unit/integration suites already
passing from prior milestones, per this milestone's own "do not mark Phase 15 complete if the job
system works only in the happy path" instruction.

**Full test matrix (clean run, this milestone):**

| Suite | Result |
|---|---|
| `api` typecheck (`tsc --noEmit`) | ✅ clean |
| `frontend` typecheck (`tsc -b`) | ✅ clean |
| `tests` (integration) typecheck | ✅ clean |
| `evaluation` typecheck | ✅ clean |
| `api` lint (`eslint .`) | ✅ clean |
| `frontend` lint | ✅ clean (1 pre-existing, unrelated warning) |
| `api` build (`tsc -p tsconfig.build.json`) | ✅ clean |
| `api` tests | ✅ 383/383 |
| `frontend` tests | ✅ 121/121 |
| `evaluation` tests | ✅ 135/135 (includes the 14 Milestone A6 adversarial tests) |
| `tests` (integration, real stack) | ✅ 11/11 files, 12/12 tests, run against the live Docker stack below |

**Full Docker rebuild**: `docker compose down -v` (wiping the local `postgres` volume) followed by
`docker compose up -d --build` for all four services (`postgres`, `ai-service`, `api`, `frontend`).
All four became healthy. The `api` container's startup log confirms all 12 migrations — the 11 from
prior phases plus this phase's own `20260915223112_add_jobs` — applied cleanly to a completely
fresh database, and the 11-file integration suite then passed against this live stack.

**A real gap found and fixed: the worker was never actually started.** `jobWorker.ts`'s
`startWorker()` had its own full test suite (`jobWorker.test.ts`) but, checked directly, was never
called from anywhere outside tests — `server.ts` only ever did `app.listen(...)`. This meant that on
a real deployment, a job created over HTTP would sit in `queued` forever: fully tested in isolation,
never actually wired to run. Fixed in `api/src/server.ts` by calling `startWorker()` alongside
`app.listen()` (in-process, no new service or Dockerfile — the minimal fix consistent with this
phase's own "do not introduce unnecessary infrastructure" instruction), and by handling `SIGTERM`/
`SIGINT` to call `worker.stop()` (draining any in-flight job) before the process exits.

**Live job exercise against the running Docker stack** (real HTTP, real Postgres, real worker poll
loop — not a test mock): registered a user, created a project, and submitted one job of each of the
four types (`indexing`, `qa`, `review`, `evaluation`) via `POST /projects/:id/jobs`. Within one poll
cycle (~1–5s) the worker claimed and completed all four:
- `evaluation` → failed with `JOB_TYPE_NOT_DISPATCHABLE`, exactly as designed.
- `indexing` → failed with `NO_REPOSITORY_CONNECTED` (no GitHub repo was connected in this
  smoke check — a genuine, correct service-level validation response, not a worker defect).
- `qa` / `review` → failed with `NO_COMPLETED_INDEX`, for the same underlying reason.

This is an honest scope note, not a gap: reaching the `completed` outcome for these three types
requires a real indexed repository (a live GitHub connection, AI-service parsing, real embeddings),
which was deliberately not exercised here to avoid an unnecessary external GitHub call during a
verification pass — the `completed` path itself is already covered by `jobWorker.test.ts`'s
mocked-service tests. What this live check specifically proves, and what those unit tests cannot,
is the full production wiring: HTTP create → worker poll → claim → dispatch → real service call →
result persisted — all against the actual running server, not an in-process test harness. Also
exercised live: `retry` (a failed `qa` job → `queued`, `retryCount: 1`) and `cancel` (a freshly
queued job → `cancelled` immediately). Confirmed via `docker compose logs api` that none of the four
failure messages leaked a stack trace or internal detail, matching `runOneClaimedJob`'s designed
error handling.

**A second real bug found and fixed: `SIGTERM` never reached the Node process.** After wiring in the
shutdown handler above, `docker compose stop api` was used to verify it actually fires — it did not.
The `Dockerfile`'s `CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/server.js"]` runs
`node` as a child of `sh`; a plain `sh -c "cmd1 && cmd2"` does not forward signals to its child
process, so `sh` (PID 1) absorbed the `SIGTERM` and Node never saw it, meaning `server.ts`'s new
graceful-shutdown code — and the safety property it exists for, letting `worker.stop()` drain an
in-flight job before exit — silently never ran, with Docker left to fall back to a hard kill after
its grace period. Fixed by changing the `CMD` to `... && exec node dist/server.js`: `exec` replaces
the shell process image with Node, so Node becomes PID 1 and receives `SIGTERM` directly. Re-verified
live: after the fix, `docker compose stop api` produced the `"Received SIGTERM, shutting down
gracefully..."` log line and exited in ~0.26s (a clean, fast exit — not a 10-second forced-kill
timeout). Rebuilt the `api` image with this fix, restarted the full stack, and re-ran `tsc --noEmit`
+ `eslint .` clean.

**Secret scan**: captured the full `api` container log across this milestone's live job runs
(including four deliberately-triggered failures) and grepped for Anthropic/GitHub/JWT-shaped key
patterns, `password`-adjacent fields, private-key headers, and credential-bearing connection
strings. No matches beyond the intentionally-non-secret Docker Compose placeholder
(`SESSION_SECRET: docker-compose-local-verification-secret-not-for-prod-...`, itself already labeled
as non-production in `docker-compose.yml`).

**VoxMind isolation**: confirmed before and after this milestone's Docker rebuild — `ps -p 16012`
still shows the native `uvicorn voxmind.main:app --port 8000` process running throughout, with its
five native Postgres connections on port 5432 (`lsof -i :5432`) unaffected. DevForge's own Postgres
remained on its separate host port 5433 throughout, per `docker-compose.yml`'s existing convention.

**Environment restored after verification**: `docker compose down` (full stack, without `-v`) then
`docker compose up -d postgres` to return to this session's established local-dev baseline (a single
standalone `postgres` container, not the full 4-service stack) — matching how the environment was
found at the start of this milestone. Because the earlier `down -v` wiped the shared Postgres
volume, migrations were re-applied to both `devforge` (already current, applied automatically by the
`api` container's own startup during the rebuild) and `devforge_test` (via `scripts/setup-test-db.sh`,
the established per-phase pattern). Re-ran the full `api` suite once more against the restored local
test database: 383/383 passing, confirming the restored environment is fully consistent.

**Milestone 15.8 conclusion**: Phase 15 is not "happy-path only" — failure-injection (15.7), a full
clean-volume Docker rebuild with live migrations, and a live, real-HTTP job exercise (including two
real production bugs found and fixed, not just tests passing) all corroborate the job system
actually works end to end in a real deployment, not merely inside its own test suite.

Commit: `<pending>`
