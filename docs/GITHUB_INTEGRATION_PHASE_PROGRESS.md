# DevForge Phase 6 (GitHub Integration) — Progress Checklist

See [docs/GITHUB_INTEGRATION_PHASE_PLAN.md](GITHUB_INTEGRATION_PHASE_PLAN.md) for scope, data
model, API contracts, and the full plan. This file tracks the 8 milestones the same way
[docs/EPICS_TASKS_PHASE_PROGRESS.md](EPICS_TASKS_PHASE_PROGRESS.md) tracked Phase 5.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Prisma schema and migration
- [x] 3. GitHub client and service
- [ ] 4. API endpoints (Node)
- [ ] 5. Frontend repository settings flow
- [ ] 6. Tests
- [ ] 7. Docker verification
- [ ] 8. Documentation

## Per-milestone log

### 1. Inspect and plan
- Confirmed via `git log`/`git status` the repo is exactly where Phase 5 left it (clean tree,
  `bbf6ea2` as HEAD).
- Re-read `docs/EPICS_TASKS_PHASE_PLAN.md` and `docs/EPICS_TASKS_PHASE_PROGRESS.md` in full.
- Inspected `api/src/env.ts` (the zod-validated startup-config pattern — required vars call
  `process.exit(1)` if missing, so any new GitHub config var must be `.optional()` or it would
  crash the whole API in this environment), `api/src/services/projects.ts` /
  `controllers/projects.ts` / `routes/projects.ts` (the ownership-guard/404 pattern reused by
  every project-scoped resource), `api/src/lib/errors.ts` (`AppError` static helpers),
  `api/src/middleware/requireAuth.ts`, `frontend/src/App.tsx` (route table — confirmed there is
  no existing "settings" page/route to reuse).
- **Confirmed real network reachability to `https://api.github.com`** (`curl` returns a
  genuine GitHub 403 rate-limit JSON body, not a network timeout) — meaning real, honest
  GitHub-API-failure paths can be exercised for real in this phase, the same way
  `ai-service` calls to `api.anthropic.com` were reachable but unauthenticated in every prior
  phase. Confirmed via `env | grep -i github` that no `GITHUB_*` variable is set anywhere in
  this environment.
- **Authentication decision, made explicit per the task's instruction**: Personal Access Token
  (PAT), user-supplied, not OAuth and not a GitHub App installation. Reasoning: OAuth needs a
  registered OAuth App (Client ID/Secret) and a reachable callback URL, neither available here;
  a GitHub App installation needs a heavier manifest/private-key/webhook setup, also
  unavailable and disproportionate to "connect one repository." A PAT requires zero app-level
  registration — the user generates their own token and pastes it in, which also directly
  satisfies "do not invent a GitHub token or assume a GitHub account is already connected."
  Full reasoning recorded in `docs/GITHUB_INTEGRATION_PHASE_PLAN.md`.
- **Data-model decision, made explicit**: `RepositoryConnection` is a single row per project
  (`@@unique([projectId])`), not a versioned/append-only artifact like every AI-generated
  phase's tables — a connection is configuration/state (replaced on reconnect, updated in
  place on branch change, hard-deleted on disconnect), not generated content worth keeping a
  history of. Reasoning recorded in the plan doc.
- **Unconfigured-behavior decision**: storing a PAT requires encryption at rest, which requires
  a server-side key (`GITHUB_TOKEN_ENCRYPTION_KEY`, to be added as `.optional()` in `env.ts`
  precisely so its absence — this environment's real, confirmed state — doesn't crash the API
  process). Its absence is checked before any GitHub API call and produces a real
  `503 GITHUB_INTEGRATION_NOT_CONFIGURED`, mirroring every prior phase's `PROVIDER_NOT_CONFIGURED`
  pattern exactly.
- Wrote `docs/GITHUB_INTEGRATION_PHASE_PLAN.md` and this progress file; added a pointer from
  `docs/EPICS_TASKS_PHASE_PROGRESS.md` to both, mirroring the pointer chain every prior phase
  established.
- Commit: `168c147` — "docs: Phase 6 (GitHub Integration) plan and progress tracker".

### 2. Prisma schema and migration
- Files: `api/prisma/schema.prisma` (new `RepositoryConnectionStatus` enum, new
  `RepositoryConnection` model, `Project.repositoryConnection` optional-one relation, updated
  header comment), `api/prisma/migrations/20260912104113_add_repository_connections/
  migration.sql`.
- `RepositoryConnection` is deliberately **not** shaped like `PrdVersion`/`ArchitectureVersion`/
  etc. — no `version` column, no `isActive` invariant, just a unique `project_id` (`@unique`,
  not `@@unique([projectId, version])`) so there is structurally at most one row per project,
  matching the Milestone 1 data-model decision. Generated SQL confirms: `ON DELETE CASCADE` to
  `projects`, a unique index on `project_id` alone, `encrypted_token`/`token_last_4` as
  required text columns (never nullable — a connection row is never created without them),
  every GitHub-derived field (`github_repo_id`, `github_account_login`, `default_branch`,
  `selected_branch`, `last_verified_at`, `last_error`) nullable since they're only known after
  a successful verification.
- Commands run and results:
  - `pnpm exec prisma format` → clean (also reformatted surrounding relation-array column
    alignment, a cosmetic formatter side effect, not a manual edit).
  - `pnpm exec prisma migrate dev --name add_repository_connections` → migration created and
    applied to the local dev database.
  - `DATABASE_URL=...devforge_test pnpm exec prisma migrate deploy` → applied to the test
    database too.
  - `pnpm exec prisma generate` → client regenerated.
  - A throwaway `tsx` script: created a user → project → repository connection (with a
    placeholder "encrypted" value shaped like real ciphertext — `iv:authTag:ciphertext` — never
    a real token, since Milestone 3's actual encryption code doesn't exist yet); confirmed a
    second connection for the same `projectId` is rejected by the unique constraint; confirmed
    the stored `encryptedToken` value is not a bare token shape; then deleted the user and
    confirmed the connection was cascade-deleted via the project relation (0 remaining).
  - `pnpm exec tsc --noEmit` → clean.
  - `pnpm exec eslint .` → clean.
  - `pnpm exec vitest run` → `111 passed (111)` — all pre-existing tests (Foundation + Phases
    2–5) still pass unchanged.
- Commit: `aacc141` — "feat(api): add repository_connections data model and migration".

### 3. GitHub client and service
- Files: `api/src/env.ts` (added `GITHUB_TOKEN_ENCRYPTION_KEY` as `.optional()` with a
  base64-32-byte-length `.refine()`, so its absence — this environment's real state — does not
  call `process.exit(1)` at startup), `api/src/lib/githubTokenCrypto.ts` (new —
  `encryptToken`/`decryptToken` via Node's built-in `crypto`, AES-256-GCM, key read at call
  time via `getEncryptionKey()`; `isGithubIntegrationConfigured()`; `lastFourOf()`),
  `api/src/lib/githubClient.ts` (new — `getAuthenticatedUser`/`getRepository`/`listBranches`
  against the real `https://api.github.com`, throwing `AppError` directly rather than a
  separate typed-exception layer — this call happens inside the Node API, not across an HTTP
  boundary into a different service, so there's no second mapping step to justify, unlike
  `aiServiceClient.ts`), `api/src/schemas/repository.ts` (new — `connectRepositorySchema`,
  `updateBranchSchema`, owner/repo name validation via GitHub's real character rules),
  `api/src/services/repository.ts` (new — `connectRepository`, `getConnection`,
  `verifyAccess`, `listBranches`, `updateBranch`, `disconnectRepository`, a private `sanitize()`
  that always strips `encryptedToken` before any data leaves the service layer).
- `GITHUB_TOKEN_ENCRYPTION_KEY` absence is checked explicitly in `connectRepository` **before**
  any GitHub API call (`isGithubIntegrationConfigured()`), not just implicitly via
  `encryptToken` throwing later — mirrors every prior phase's "check the dependency before
  doing any work" ordering exactly.
- `verifyAccess` persists a degraded `status: "error"`/`lastError` on failure (so a later `GET`
  reflects the real "last verification status" without another reverify call) but still
  rethrows the original error so the triggering request gets the correct real HTTP status —
  a deliberate two-part behavior documented here since it wasn't obvious from the endpoint list
  alone.
- Commands run and results:
  - `pnpm exec tsc --noEmit` → clean.
  - `pnpm exec eslint .` → clean.
  - Manual, real, unmocked verification against the actual GitHub API (confirmed reachable
    from this environment in Milestone 1): `isGithubIntegrationConfigured()` → `false` (this
    environment's real state); `getAuthenticatedUser()` with a genuinely fake token → real
    GitHub `401` mapped to `GITHUB_INVALID_CREDENTIALS`; `getRepository()` with the same fake
    token → real GitHub `401` mapped the same way — no fabricated success anywhere, matching
    every prior phase's `ANTHROPIC_API_KEY` discipline exactly.
  - Manual verification of the encryption scheme with a locally-generated (never persisted)
    32-byte key: `isGithubIntegrationConfigured()` → `true` once set; encrypt→decrypt round-trip
    recovers the exact original plaintext; the stored ciphertext string never contains the
    plaintext token; `lastFourOf()` matches the real last four characters; **tampering with the
    ciphertext is correctly rejected** by AES-GCM's authentication tag, confirmed by mutating
    two hex characters and observing `decryptToken` throw.
  - `pnpm exec vitest run` (full suite) → `111 passed (111)` — all pre-existing tests
    (Foundation + Phases 2–5) still pass unchanged; this milestone's automated tests are
    written in Milestone 6, per the stated implementation order (matching every prior phase's
    Milestone 3, which also deferred automated tests to Milestone 6).
- Commit: `3c51b0e` — "feat(api): add GitHub client, token encryption, and repository connection service".

### 4. API endpoints (Node)
(pending)

### 5. Frontend repository settings flow
(pending)

### 6. Tests
(pending)

### 7. Docker verification
(pending)

### 8. Documentation
(pending)
