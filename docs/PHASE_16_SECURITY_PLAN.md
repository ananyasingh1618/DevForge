# DevForge Phase 16 (Security, Permissions, and Multi-User Isolation) — Plan

## Scope

Harden DevForge's existing auth/authorization model for real multi-user use: close the gaps found
during Milestone 16.1's inventory, add defense-in-depth where it's currently only single-layer, add
the API-level protections a real deployment needs (rate limiting, size/pagination limits, secure
headers), treat repository content as untrusted input, and prove all of it with tests — not just
documentation. This phase does not redesign the existing session-cookie authentication model
(bcrypt + hashed opaque DB session tokens), which Milestone 16.1 found to be sound; it extends the
authorization and API-security layers around it.

## Milestone 16.1 — Current-state inventory (see below) and explicit assumption

**"Authentication does not imply authorization" is already true in this codebase** — every
project-scoped service independently re-checks ownership rather than trusting `requireAuth` alone.
The inventory (full detail in the summary this milestone produced, condensed here) found:

### What already exists and is sound
- Session-cookie auth: DB-backed opaque tokens (SHA-256 hash stored, raw token only in the
  httpOnly cookie), bcrypt (cost 12) passwords, 30-day hard TTL, enumeration-resistant login errors.
- Service-level ownership checks (`requireOwnedProject`-shaped helper, duplicated per service file)
  on every project-scoped resource: Project, RepositoryConnection, CodebaseIndex, Q&A, CodeReview,
  Retrieval, Job.
- Consistent 404-not-403 (existence-hiding) on every ownership failure, tested across every
  resource type.
- GitHub tokens: AES-256-GCM at rest, tamper-evident (auth tag), never serialized in API responses,
  never logged, decrypted only in-memory for the duration of a GitHub API call.

### Real gaps this phase must close
1. **No rate limiting anywhere** — `/auth/login` and `/auth/register` have no request-volume
   throttling (only response-content enumeration resistance).
2. **No CSRF token layer** — relies entirely on `SameSite=Lax` + fixed-origin CORS, no
   defense-in-depth CSRF token.
3. **`EvaluationRun` has no ownership model** — by original design (a system-wide resource with no
   creator), but this needs re-examination now that Phase 16 requires an explicit ownership model
   for every resource type the task lists.
4. **Ownership-check logic is copy-pasted per service file**, not centralized — a consistency risk
   as more resource types are added; also means "defense in depth" today is really "one layer,
   applied consistently," not two independent layers (route + service). Route/controller code does
   no ownership check of its own — only `requireAuth` + Zod parameter parsing.
5. **No route-level authorization middleware** — the task's "defense in depth — route-level AND
   service-level" requirement means adding a genuine second, independent layer at the route/
   controller level, not just relying on the (correct, but singular) service-level check.
6. **No size/pagination/timeout limits** beyond what Phase 15's job-input-size fix already added;
   no audit yet of repository-content handling for path traversal, archive/symlink abuse, or
   prompt-injection resistance.
7. **No dedicated secret-pattern test suite** — secrets are handled correctly by inspection (per
   the inventory), but nothing asserts this mechanically and would catch a regression.
8. **No audit logging** of security-relevant actions (login, failed login, ownership-denied access,
   token connect/disconnect).

## Design decisions for this phase

### 16.2 — Ownership model
Rather than inventing a new ownership abstraction, make the *existing* pattern explicit,
centralized, and complete:
- Extract the duplicated `requireOwnedProject`-shaped helpers into one shared
  `api/src/lib/ownership.ts`, used by every service file (removes the duplication risk the
  inventory flagged, without changing behavior — a refactor with existing tests as the safety net).
- Give `EvaluationRun` an explicit, documented ownership decision. Chosen: add a nullable
  `projectId` foreign key (evaluation runs are conceptually tied to a benchmark run over the whole
  system, not one user's data) is out of scope for the separate `evaluation/` CLI package
  (`evaluation/` intentionally does not share Prisma models — established convention). Instead:
  keep `EvaluationRun` unscoped but make that an *explicit, tested, documented* decision — add the
  missing test asserting "any authenticated user can read any evaluation run, because eval runs are
  a system-wide, non-personal resource, not per-user data" — closing the inventory's "gap: no test
  asserting that fact explicitly" finding. This is a deliberate design choice, not a hole: eval runs
  contain no user-submitted content (they run against the fixed evaluation dataset), so no
  cross-user data exposure is possible through this resource.
- Add DB- and API-level tests for every ownership boundary the task lists (users/projects/repos/
  index runs/jobs/Q&A/reviews already exist per the inventory; ensure coverage is complete and add
  what's missing).

### 16.3 — Defense in depth: route-level AND service-level
Add a real second layer, not a cosmetic one: an Express middleware,
`requireProjectOwnership(paramName)`, that runs *before* the controller for every
`/projects/:projectId/...` route, does its own independent `prisma.project.findFirst({ id,
ownerId })` check, and 404s immediately if it fails — genuinely redundant with (not a replacement
for) the service layer's own check. This means an ownership bug introduced in a service function in
the future would still be caught at the route boundary. Keep both layers; do not remove the
service-level checks (removing them would be optimizing away the isolation Milestone 16.1 found is
already correct).

### 16.4 — Repository and GitHub security
Audit and hardening pass over: GitHub token handling (already sound per the inventory — re-verify,
don't re-architect), repository URL validation, branch/commit ref validation, path traversal in
file listing/content retrieval, large-file/archive abuse limits, and — the task's explicit priority
— treating repository *content* (file contents fed into Q&A/review prompts) as untrusted input that
must never override system instructions or the trusted-source model. Add adversarial tests using a
separate fixture, mirroring Milestone A6's own "separate fixture from the main benchmark" precedent.

### 16.5 — API security
Add `express-rate-limit` (auth endpoints strict, general API endpoints generous), request body size
limits (already partially covered by Phase 15's job-input limit; extend the pattern), pagination
limits (`listJobs` already has one — audit every other list endpoint), secure headers via `helmet`,
and an audit-log table for security-relevant events.

### 16.6 — Secrets and sensitive-data controls
A dedicated `secretScan.test.ts` asserting known secret-shaped patterns (GitHub tokens, API keys,
JWT-shaped strings, passwords, private-key headers, connection strings, auth headers) never appear
in: log output, error responses, job metadata, eval reports, search/citation output, DB debug
output.

### 16.7 — Multi-user isolation tests
A dedicated cross-user test suite exercising the 10 scenarios the task lists, via API, service, and
(where meaningful) direct DB-query patterns.

### 16.8 — Verification
Full test matrix + live security checks (attempted cross-user access over real HTTP against the
Docker stack, rate-limit trigger, secret scan of live logs) — the same "live, not just unit-tested"
standard Milestone 15.8 held itself to.

## Non-goals

- No change to the fundamental session-cookie authentication mechanism.
- No new user roles/permissions system (no admin/member/viewer tiers) — out of scope; the current
  model is single-owner-per-project, and Phase 16 secures that model rather than expanding it.
- No external security scanning service/dependency — pattern-based tests only, consistent with this
  project's own established minimalism precedent.
