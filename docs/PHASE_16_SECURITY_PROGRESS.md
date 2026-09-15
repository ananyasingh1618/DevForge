# DevForge Phase 16 (Security, Permissions, and Multi-User Isolation) — Progress Log

## Milestone 16.1 — Security architecture

Inspected the current authentication and authorization model end to end (auth middleware, every
project-scoped service's ownership checks, error behavior, GitHub token handling, rate limiting,
CORS/CSRF, existing cross-user tests) before writing any design. Full findings and the resulting
design decisions are in `docs/PHASE_16_SECURITY_PLAN.md`.

**Headline finding**: authentication does not imply authorization in this codebase, and it already
doesn't — every project-scoped service independently re-checks resource ownership rather than
trusting `requireAuth` alone, consistently returns 404 (never 403) on an ownership failure, and this
is backed by existing cross-user tests on nearly every resource type. This meant Milestone 16.1's
job was to find the *real* remaining gaps rather than assume the worst — inflating already-sound
areas with unnecessary rework would violate this phase's own "do not introduce unnecessary
infrastructure" instruction (Phase 15's own framing, carried forward here).

**Real gaps found** (see the plan doc's full list): no rate limiting anywhere, no CSRF token layer,
`EvaluationRun` has no ownership model (by original design, needs an explicit documented decision
rather than silence), ownership-check logic duplicated per service file rather than centralized, no
independent route-level authorization layer (only service-level), no repository-content/path-
traversal/archive-abuse audit yet, no dedicated secret-pattern test suite, no audit logging.

Commit: `3e346cb`

## Milestone 16.2 — Ownership model

Two concrete changes, both matching the plan doc's design decisions exactly:

1. **Centralized the duplicated ownership check.** Confirmed via direct comparison that all 11
   copies of `requireOwnedProject()` (in `codeReview.ts`, `architecture.ts`, `codebaseIndex.ts`,
   `epics.ts`, `jobs.ts`, `prd.ts`, `repository.ts`, `tasks.ts`, `requirements.ts`, `qa.ts`,
   `retrieval.ts`) were byte-for-byte identical, then extracted them into one shared
   `api/src/lib/ownership.ts` and updated every service file to import it instead. Behavior is
   unchanged — same `prisma.project.findFirst({ id, ownerId })` query, same
   `AppError.notFound()` on failure — this is a pure de-duplication, not a logic change, and the
   full existing test suite (383 tests, covering every one of these services' ownership paths) is
   the safety net that proves it.
2. **Made `EvaluationRun`'s "no ownership" status an explicit, tested decision**, closing the exact
   gap Milestone 16.1 flagged ("no test asserting that fact explicitly"). Added
   `api/src/routes/evaluations.test.ts` (new — this route had zero tests before), with 4 tests: auth
   is still required; a run inserted directly (as the separate `evaluation/` CLI does — there is no
   creator field to attribute it to) is visible to every authenticated user, proven with two
   independent registered users both reading the same run via both the list and single-run
   endpoints; a nonexistent run id still 404s. This documents in a running test, not just a code
   comment, that `EvaluationRun`'s lack of a per-user scope is a deliberate design choice (it wraps
   a fixed, version-controlled evaluation dataset with no user-submitted content, so there is no
   cross-user data exposure possible through this resource) rather than an oversight.

Full suite after both changes: 387/387 (383 + 4 new), `tsc --noEmit` and `eslint .` both clean. One
transient failure was observed mid-run in `retrieval.test.ts` on a single pass (a pre-existing
cross-test-file fetch-mock-queue flake, unrelated to this milestone's changes — confirmed by running
that file alone, which passed, and by re-running the full suite immediately after, which also
passed cleanly).

**On the "DB and API tests for every ownership boundary" requirement**: the inventory (Milestone
16.1) already found this fully covered for every project-scoped resource (Project,
RepositoryConnection, CodebaseIndex, Q&A, CodeReview, Retrieval, Job) via each resource's own
`*.ownership.test.ts` or inline cross-user test cases — no new boundary was found missing there.
The one real gap was `EvaluationRun`, closed above.

Commit: `f950560`

## Milestone 16.3 — Authorization middleware and service checks (defense in depth)

Added a genuine second, independent authorization layer at the route boundary, per the plan doc's
design: `api/src/middleware/requireProjectOwnership.ts`, a new Express middleware that does its own
`prisma.project.findFirst({ id, ownerId })` check before any controller runs — deliberately
redundant with, not a replacement for, every service's own `requireOwnedProject()` call from
Milestone 16.2. If a project-ownership bug were ever introduced into a service function in the
future, this layer would still catch it at the route boundary, before any controller or service
code executes.

Wired into all 11 nested `/projects/:projectId/...` routers (`requirements`, `prd`, `architecture`,
`epics`, `tasks`, `repository`, `codebaseIndex`, `retrieval`, `qa`, `codeReview`, `jobs`), mounted
immediately after `requireAuth` in the same `router.use(path, requireAuth,
requireProjectOwnership)` call so `req.user` is always populated first. `/projects/:id` itself
(the base resource, not a nested one) was deliberately left alone — its own service-level
`getProjectForOwner()` check already *is* the ownership check for that resource, so a second layer
there would just be the same query run twice under a different name, not a genuinely independent
boundary.

**Malformed-id handling**: the middleware validates `:projectId` looks like a UUID before querying;
if it doesn't, it calls `next()` and defers entirely to each route's own Zod parameter schema
downstream — this avoids creating a second, potentially-diverging source of truth for what a
"valid id" looks like. Same 404-on-ownership-failure, 401-on-missing-user behavior as every existing
layer — safe, existence-non-revealing errors, consistent with the rest of the codebase.

**Proven independent, not just riding on the existing layer**: the full 387-test suite passed
unchanged after wiring this in — expected, since a correctly-redundant layer should never change
observable behavior when the layer beneath it is already correct. To prove the new layer is
actually doing its own independent check (not simply "present but never exercised because the
other layer always wins first"), added `api/src/middleware/requireProjectOwnership.test.ts` — 5
tests calling the middleware function directly, in isolation, with a hand-built `req`/`res`/`next`
(no HTTP, no controller, no other service code in the call path): confirms `next()` is called with
no error for the true owner, `next(AppError 404)` for another user's project, `next(AppError 404)`
for a well-formed id owned by no one, `next(AppError 401)` if reached with no authenticated user,
and pass-through for a malformed id.

Full suite after this milestone: 392/392 (387 + 5 new), `tsc --noEmit` and `eslint .` both clean.

Commit: `c9affb1`
