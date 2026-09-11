# DevForge Phase 3 (PRD Generation) — Progress Checklist

See [docs/PRD_PHASE_PLAN.md](PRD_PHASE_PLAN.md) for scope, data model, API contracts, and the
full plan. This file tracks the 8 milestones the same way
[docs/REQUIREMENTS_PHASE_PROGRESS.md](REQUIREMENTS_PHASE_PROGRESS.md) tracked Phase 2.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Prisma schema and migration
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
- Commit: `3d2407e` — "docs: Phase 3 (PRD Generation) plan and progress tracker".

### 2. Prisma schema and migration
- Files: `api/prisma/schema.prisma` (new `PrdVersion` model + `Project.prdVersions` +
  `RequirementsVersion.prdVersions` relations),
  `api/prisma/migrations/20260911223705_add_prd_versions/migration.sql`.
- One correction to the plan doc's phrasing: Prisma's actual generated behavior for the
  `sourceRequirementsVersionId` relation (no `onDelete` specified) is `ON DELETE RESTRICT`,
  not Postgres's bare `NO ACTION` as the plan speculated — functionally the same guarantee
  (deleting a referenced requirements version is blocked), confirmed by directly testing it
  below, not just reading the generated SQL.
- Commands run and results:
  - `pnpm exec prisma format` → clean.
  - `pnpm exec prisma migrate dev --name add_prd_versions` → migration created and applied.
  - Inspected the generated SQL: `prd_versions` as `JSONB` content, `ON DELETE CASCADE` to
    `projects`, `ON DELETE RESTRICT` to `requirements_versions`, unique on
    `(project_id, version)` — exactly as designed.
  - `DATABASE_URL=...devforge_test pnpm exec prisma migrate deploy` → applied to the test
    database too.
  - `pnpm exec prisma generate` → client regenerated.
  - `psql \d prd_versions` → columns, PK, both FK constraints (with their correct ON DELETE
    behaviors), and both indexes all match.
  - A throwaway `tsx` script: created a user/project/requirements-version, created a PRD
    version referencing it, confirmed the source-tracking FK actually resolves to the right
    id, confirmed a duplicate `(projectId, version)` insert is rejected, confirmed **directly
    attempting to delete the referenced requirements version while the PRD version still
    exists is blocked** (the RESTRICT constraint firing for real, not just present in the
    schema), then deleted the user and confirmed both the PRD version and requirements
    version were cascade-deleted via the project relation (0 remaining each).
  - `pnpm exec tsc --noEmit` → clean.
  - `pnpm exec eslint .` → clean.
  - `pnpm exec vitest run` → `43 passed (43)` — all pre-existing tests (Foundation + Phase 2)
    still pass unchanged.
- Commit: recorded below once made.

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
