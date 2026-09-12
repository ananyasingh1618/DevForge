# DevForge Phase 6 (GitHub Integration) — Progress Checklist

See [docs/GITHUB_INTEGRATION_PHASE_PLAN.md](GITHUB_INTEGRATION_PHASE_PLAN.md) for scope, data
model, API contracts, and the full plan. This file tracks the 8 milestones the same way
[docs/EPICS_TASKS_PHASE_PROGRESS.md](EPICS_TASKS_PHASE_PROGRESS.md) tracked Phase 5.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [ ] 2. Prisma schema and migration
- [ ] 3. GitHub client and service
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
(pending)

### 3. GitHub client and service
(pending)

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
