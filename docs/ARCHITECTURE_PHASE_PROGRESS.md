# DevForge Phase 4 (Architecture Generation) — Progress Checklist

See [docs/ARCHITECTURE_PHASE_PLAN.md](ARCHITECTURE_PHASE_PLAN.md) for scope, data model, API
contracts, and the full plan. This file tracks the 8 milestones the same way
[docs/PRD_PHASE_PROGRESS.md](PRD_PHASE_PROGRESS.md) tracked Phase 3.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Prisma schema and migration
- [ ] 3. ai-service architecture contract/provider
- [ ] 4. API endpoints (Node)
- [ ] 5. Frontend architecture flow
- [ ] 6. Tests
- [ ] 7. Docker verification
- [ ] 8. Documentation

## Per-milestone log

### 1. Inspect and plan
- Confirmed via `git log`/`git status` the repo is exactly where Phase 3 left it (clean tree,
  `8494cf8` as HEAD).
- Re-read `docs/PRD_PHASE_PLAN.md` and `docs/PRD_PHASE_PROGRESS.md` in full.
- Inspected `api/prisma/schema.prisma` (the `PrdVersion` model as the exact template to
  mirror), `ai-service/app/agents/prd/{provider,router}.py`, `ai-service/app/schemas.py`,
  `ai-service/app/errors.py`, `ai-service/app/lib/provider_config.py`, `ai-service/main.py`,
  `api/src/schemas/prd.ts`, `api/src/services/prd.ts`, `api/src/controllers/prd.ts`,
  `api/src/routes/prd.ts`, `api/src/lib/aiServiceClient.ts`, `frontend/src/components/
  PrdSection.tsx`, `frontend/src/services/prdApi.ts`, `frontend/src/types/prd.ts`,
  `ai-service/tests/test_prd.py`, and `api/src/routes/prd.test.ts` — all read in full, not
  summarized from memory, to extract the exact conventions to mirror rather than assume them.
- Confirmed `ANTHROPIC_API_KEY` is still unset in this environment (unchanged since Phase 2/3)
  — the same "test the honest not-configured path for real, never claim a real LLM test
  passed" rule applies.
- Worked out the active-PRD dependency by the identical reasoning Phase 3 used for
  active-requirements: `generatePrdFromActiveRequirements`/`activateVersion` together guarantee
  at most one active `PrdVersion` per project, and there's no PRD-deletion endpoint, so "no
  active PRD" is exactly "the project's PRD version list is empty".
- Designed `ArchitectureContent` as 13 fields (2 prose: `overview`/`systemArchitecture`, 11
  string-array sections: technologyStack, components, dataModel, apiDesign, dataFlows,
  security, scalability, deployment, tradeoffs, assumptions, openQuestions) — the same
  "prose-bullet-list per section" shape `PrdContent` uses, chosen deliberately to keep the
  Zod/Pydantic pair trivial and reuse `PrdSection`'s editing UI pattern without inventing a new
  one.
- Wrote `docs/ARCHITECTURE_PHASE_PLAN.md` and this progress file; added a pointer from
  `docs/PRD_PHASE_PROGRESS.md` to both, mirroring the pointer Phase 3 added to
  `docs/REQUIREMENTS_PHASE_PROGRESS.md`.
- Commit: `40b4ea4` — "docs: Phase 4 (Architecture Generation) plan and progress tracker".

### 2. Prisma schema and migration
- Files: `api/prisma/schema.prisma` (new `ArchitectureVersion` model + `Project.architectureVersions`
  and `PrdVersion.architectureVersions` relations, updated header comment),
  `api/prisma/migrations/20260911231732_add_architecture_versions/migration.sql`.
- `ArchitectureVersion` mirrors `PrdVersion` exactly one field for field:
  `sourcePrdVersionId` (instead of `sourceRequirementsVersionId`) is the only structural
  difference. Generated SQL confirms: `ON DELETE CASCADE` to `projects`, `ON DELETE RESTRICT`
  to `prd_versions`, unique index on `(project_id, version)`, indexes on `project_id` and
  `source_prd_version_id` — exactly matching the plan and `PrdVersion`'s precedent.
- Commands run and results:
  - `pnpm exec prisma format` → clean (also reformatted the surrounding relation-array column
    alignment, a cosmetic Prisma-formatter side effect, not a manual edit).
  - `pnpm exec prisma migrate dev --name add_architecture_versions` → migration created and
    applied to the local dev database.
  - `DATABASE_URL=...devforge_test pnpm exec prisma migrate deploy` → applied to the test
    database too.
  - `pnpm exec prisma generate` → client regenerated.
  - A throwaway `tsx` script: created a user → project → active requirements version → active
    PRD version → architecture version referencing it; confirmed the source-tracking FK
    resolves to the right id; confirmed a duplicate `(projectId, version)` insert is rejected;
    confirmed **directly attempting to delete the referenced PRD version while the
    architecture version still exists is blocked** (RESTRICT firing for real); then deleted
    the user and confirmed both the architecture version and PRD version were cascade-deleted
    via the project relation (0 remaining each).
  - `pnpm exec tsc --noEmit` → clean.
  - `pnpm exec eslint .` → clean.
  - `pnpm exec vitest run` → `60 passed (60)` — all pre-existing tests (Foundation + Phase 2 +
    Phase 3) still pass unchanged.
- Commit: `<pending>` — "feat(api): add architecture_versions data model and migration".

### 3. ai-service architecture contract/provider
(pending)

### 4. API endpoints (Node)
(pending)

### 5. Frontend architecture flow
(pending)

### 6. Tests
(pending)

### 7. Docker verification
(pending)

### 8. Documentation
(pending)
