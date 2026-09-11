# DevForge Phase 2 (Requirements Analysis) — Progress Checklist

See [docs/REQUIREMENTS_PHASE_PLAN.md](REQUIREMENTS_PHASE_PLAN.md) for scope, data model, API
contracts, and the full plan. This file tracks the 7 milestones the same way
[docs/FOUNDATION_PROGRESS.md](FOUNDATION_PROGRESS.md) tracked the Foundation phase.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Data model and migration
- [ ] 3. AI-service contract and provider abstraction
- [ ] 4. API endpoints (Node)
- [ ] 5. Frontend requirements flow
- [ ] 6. Tests
- [ ] 7. Docker and documentation

## Per-milestone log

### 1. Inspect and plan
- Read `docs/FOUNDATION_PROGRESS.md`, `api/prisma/schema.prisma`, `api/src/app.ts`, the
  existing `projects` controller/service/schema/routes (the pattern every new endpoint
  reuses), `frontend/src/pages/ProjectOverview.tsx`, `docker-compose.yml`, `api/src/env.ts`.
- Confirmed via `git log`/`git status` the repo is exactly where the Foundation phase left
  it (clean tree, `5b00c40` as HEAD).
- Confirmed no LLM provider was configured anywhere in the Foundation-phase code, and that
  `ANTHROPIC_API_KEY` is genuinely unset in this shell (`env | grep -i anthropic` → empty) —
  this shapes the whole test plan: the "provider not configured" path can be tested for
  real, but no test in this phase will claim a real LLM call succeeded.
- Consulted the `claude-api` skill for current model IDs and the structured-output pattern;
  chose `claude-opus-5` via `client.messages.parse(output_format=<PydanticModel>)`, since the
  skill requires `claude-opus-5` by default unless the user names another model, and
  documented the provider choice in the plan (no provider existed to prefer instead).
- Wrote `docs/REQUIREMENTS_PHASE_PLAN.md` and this progress file; added a pointer from
  `docs/FOUNDATION_PROGRESS.md` to both.
- Commit: `98de9a4` — "docs: Phase 2 (Requirements Analysis) plan and progress tracker".

### 2. Data model and migration
- Files: `api/prisma/schema.prisma` (new `RequirementsVersion` model + `Project.requirementsVersions`
  relation), `api/prisma/migrations/20260911215302_add_requirements_versions/migration.sql`.
- Commands run and results:
  - `docker compose up -d postgres` → started cleanly; the data volume from the Foundation
    phase (including the `devforge_test` database) was preserved, confirmed via `psql`.
  - `pnpm exec prisma format` → clean.
  - `pnpm exec prisma migrate dev --name add_requirements_versions` → migration created and
    applied to `devforge`.
  - Inspected the generated SQL: `requirements_versions` as `JSONB` content, cascade-delete
    FK to `projects`, and a unique constraint on `(project_id, version)` — exactly as
    designed.
  - `DATABASE_URL=...devforge_test pnpm exec prisma migrate deploy` → applied to the test
    database too.
  - `pnpm exec prisma generate` → client regenerated with the new model.
  - `psql \d requirements_versions` → columns, PK, indexes, and the FK constraint all match.
  - A throwaway `tsx` script created a user/project, created two requirements versions,
    confirmed a duplicate `(projectId, version)` insert is rejected by the unique
    constraint, confirmed `findMany` returns both versions, then deleted the user and
    confirmed all versions were cascade-deleted (0 remaining).
  - `pnpm exec tsc --noEmit` → clean.
  - `pnpm exec eslint .` → clean.
  - `pnpm exec vitest run` → `26 passed (26)` — all pre-existing Foundation-phase tests still
    pass unchanged.
- Commit: recorded below once made.

### 3. AI-service contract and provider abstraction
(pending)

### 4. API endpoints (Node)
(pending)

### 5. Frontend requirements flow
(pending)

### 6. Tests
(pending)

### 7. Docker and documentation
(pending)
