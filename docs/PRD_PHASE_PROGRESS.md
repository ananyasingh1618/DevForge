# DevForge Phase 3 (PRD Generation) — Progress Checklist

See [docs/PRD_PHASE_PLAN.md](PRD_PHASE_PLAN.md) for scope, data model, API contracts, and the
full plan. This file tracks the 8 milestones the same way
[docs/REQUIREMENTS_PHASE_PROGRESS.md](REQUIREMENTS_PHASE_PROGRESS.md) tracked Phase 2.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [ ] 2. Prisma schema and migration
- [ ] 3. AI-service PRD contract/provider
- [ ] 4. API endpoints (Node)
- [ ] 5. Frontend PRD flow
- [ ] 6. Tests
- [ ] 7. Docker verification
- [ ] 8. Documentation

## Per-milestone log

### 1. Inspect and plan
- Confirmed via `git log`/`git status` the repo is exactly where Phase 2 left it (clean tree,
  `501632a` as HEAD).
- Re-read `docs/FOUNDATION_PROGRESS.md`, `docs/REQUIREMENTS_PHASE_PLAN.md`,
  `docs/REQUIREMENTS_PHASE_PROGRESS.md`, and the root `README.md`.
- Inspected the current Prisma schema, the requirements service/controller/routes/AI-service
  client (the exact pattern every PRD endpoint mirrors), the ai-service requirements
  provider/router/schemas/errors, `frontend/src/pages/ProjectOverview.tsx`, and
  `RequirementsSection.tsx` in full.
- Confirmed `ANTHROPIC_API_KEY` is still unset in this shell (`env | grep -i anthropic` →
  empty) — unchanged from Phase 2, so the same "test the honest not-configured path for real,
  never claim a real LLM test passed" rule applies.
- Worked out the active-requirements dependency precisely: because
  `analyzeAndCreateVersion`/`activateVersion` already guarantee at most one active requirements
  version and there is no requirements-deletion endpoint, "no active requirements" is exactly
  equivalent to "the requirements list is empty" — simplifying both the backend guard and the
  frontend's dependency check to a single condition.
- Decided to genuinely reuse code where it's actually shared (not just "in spirit"): extracted
  the `ANTHROPIC_API_KEY`-reading + `ProviderNotConfiguredError`-raising logic, currently
  duplicated if PRD had its own copy, into `ai-service/app/lib/provider_config.py`, used by
  both the requirements and PRD providers. Documented as a deliberate interpretation of "use
  the existing provider abstraction where practical" in `docs/PRD_PHASE_PLAN.md`.
- Wrote `docs/PRD_PHASE_PLAN.md` and this progress file; added a pointer from
  `docs/REQUIREMENTS_PHASE_PROGRESS.md` to both.
- Commit: recorded below once made.

### 2. Prisma schema and migration
(pending)

### 3. AI-service PRD contract/provider
(pending)

### 4. API endpoints (Node)
(pending)

### 5. Frontend PRD flow
(pending)

### 6. Tests
(pending)

### 7. Docker verification
(pending)

### 8. Documentation
(pending)
