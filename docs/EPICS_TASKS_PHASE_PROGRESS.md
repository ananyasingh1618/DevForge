# DevForge Phase 5 (Epics & Tasks Generation) — Progress Checklist

See [docs/EPICS_TASKS_PHASE_PLAN.md](EPICS_TASKS_PHASE_PLAN.md) for scope, data model, API
contracts, and the full plan. This file tracks the 8 milestones the same way
[docs/ARCHITECTURE_PHASE_PROGRESS.md](ARCHITECTURE_PHASE_PROGRESS.md) tracked Phase 4.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Prisma schema and migration(s)
- [ ] 3. ai-service epics/tasks contracts and providers
- [ ] 4. API endpoints (Node) — epics and tasks
- [ ] 5. Frontend epics/tasks flow
- [ ] 6. Tests
- [ ] 7. Docker verification
- [ ] 8. Documentation

## Per-milestone log

### 1. Inspect and plan
- Confirmed via `git log`/`git status` the repo is exactly where Phase 4 left it (clean tree,
  `b63a024` as HEAD).
- Re-read `docs/ARCHITECTURE_PHASE_PLAN.md` and `docs/ARCHITECTURE_PHASE_PROGRESS.md` in full.
- Inspected `api/prisma/schema.prisma` (the `ArchitectureVersion` model), `api/src/services/
  requirements.ts` in full (specifically `diffRequirementItems` — the id-matched item-list
  diff precedent this phase's content shape needs, as opposed to `PrdContent`/
  `ArchitectureContent`'s flat-field diff), `api/src/schemas/requirements.ts` (the
  `RequirementItem` shape — the precedent for `EpicItem`/`TaskItem`).
- Confirmed `ANTHROPIC_API_KEY` is still unset in this environment.
- **Central decision, made explicit per the task's instruction**: `EpicVersion` and
  `TaskVersion` are two independent versioned artifacts (not one hierarchical "work plan"
  artifact). Reasoning: the spec lists every CRUD/activate/compare capability once per entity
  (epics and tasks each get their own generate/list/view/edit/activate/compare), tasks are
  generated *from* epics as a distinct second AI call exactly like PRD-from-requirements, and
  three phases in a row already established "one table per generation step" as the
  convention — introducing a different shape here (the first phase with two sibling
  generation steps) would be the inconsistent choice. Full reasoning recorded in
  `docs/EPICS_TASKS_PHASE_PLAN.md`.
- Worked out that epic/task content is structurally an **item list** (`EpicItem[]`/
  `TaskItem[]`, mirroring `RequirementItem[]`), not PRD/Architecture's flat-prose-sections
  shape — because epics and tasks are inherently collections of discrete, id-bearing things,
  not one document. This changes both the diff shape (reuses `diffRequirementItems`'s
  id-matched added/removed/changed logic) and the frontend editing UI (per-item cards, not
  per-flat-field textareas).
- Worked out the two dependency checks by the same reasoning every prior phase used:
  `generateEpicsFromActiveArchitecture` requires an active `ArchitectureVersion` (`400
  NO_ACTIVE_ARCHITECTURE`, specified verbatim in the task); `generateTasksFromActiveEpics`
  requires an active `EpicVersion` (`400 NO_ACTIVE_EPICS` — not specified verbatim in the
  task, so chosen and documented here as the direct analogue of
  `NO_ACTIVE_REQUIREMENTS`/`NO_ACTIVE_PRD`/`NO_ACTIVE_ARCHITECTURE`).
- Wrote `docs/EPICS_TASKS_PHASE_PLAN.md` and this progress file; added a pointer from
  `docs/ARCHITECTURE_PHASE_PROGRESS.md` to both, mirroring the pointer chain every prior phase
  established.
- Commit: `e3db5b7` — "docs: Phase 5 (Epics & Tasks Generation) plan and progress tracker".

### 2. Prisma schema and migration(s)
- Files: `api/prisma/schema.prisma` (new `EpicVersion` and `TaskVersion` models +
  `Project.epicVersions`/`Project.taskVersions` and
  `ArchitectureVersion.epicVersions`/`EpicVersion.taskVersions` relations, updated header
  comment), `api/prisma/migrations/20260912093458_add_epic_and_task_versions/migration.sql`
  (one migration containing both tables — they landed together cleanly since both were added
  to the schema in the same `prisma migrate dev` invocation).
- `EpicVersion` mirrors `ArchitectureVersion` exactly field for field (`sourceArchitectureVersionId`
  instead of `sourcePrdVersionId`); `TaskVersion` mirrors it with `sourceEpicVersionId`. Both
  confirmed via generated SQL: `ON DELETE CASCADE` to `projects`, `ON DELETE RESTRICT` to the
  respective upstream table, unique index on `(project_id, version)`, indexes on `project_id`
  and the source FK — exactly matching the plan and every prior artifact's precedent.
- Commands run and results:
  - `pnpm exec prisma format` → clean (also reformatted surrounding relation-array column
    alignment, a cosmetic formatter side effect, not a manual edit).
  - `pnpm exec prisma migrate dev --name add_epic_and_task_versions` → migration created and
    applied to the local dev database.
  - `DATABASE_URL=...devforge_test pnpm exec prisma migrate deploy` → applied to the test
    database too.
  - `pnpm exec prisma generate` → client regenerated.
  - A throwaway `tsx` script exercising the full five-link chain: created a user → project →
    active requirements version → active PRD version → active architecture version → epic
    version referencing it → task version referencing that. Confirmed both new source-tracking
    FKs resolve to the right ids; confirmed a duplicate `(projectId, version)` insert is
    rejected for both `EpicVersion` and `TaskVersion`; confirmed **directly attempting to
    delete the referenced architecture version while an epic version still exists is
    blocked**, and separately that **deleting the referenced epic version while a task version
    still exists is blocked** (RESTRICT firing for real on both new FKs, not just present in
    the schema); then deleted the user and confirmed all five artifact tables
    (requirements/PRD/architecture/epics/tasks) were cascade-deleted via the project relation
    (0 remaining each).
  - `pnpm exec tsc --noEmit` → clean.
  - `pnpm exec eslint .` → clean.
  - `pnpm exec vitest run` → `77 passed (77)` — all pre-existing tests (Foundation + Phases
    2–4) still pass unchanged.
- Commit: `c72853c` — "feat(api): add epic_versions and task_versions data models and migration".

### 3. ai-service epics/tasks contracts and providers
(pending)

### 4. API endpoints (Node) — epics and tasks
(pending)

### 5. Frontend epics/tasks flow
(pending)

### 6. Tests
(pending)

### 7. Docker verification
(pending)

### 8. Documentation
(pending)
