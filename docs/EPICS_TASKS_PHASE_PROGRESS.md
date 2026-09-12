# DevForge Phase 5 (Epics & Tasks Generation) — Progress Checklist

See [docs/EPICS_TASKS_PHASE_PLAN.md](EPICS_TASKS_PHASE_PLAN.md) for scope, data model, API
contracts, and the full plan. This file tracks the 8 milestones the same way
[docs/ARCHITECTURE_PHASE_PROGRESS.md](ARCHITECTURE_PHASE_PROGRESS.md) tracked Phase 4.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Prisma schema and migration(s)
- [x] 3. ai-service epics/tasks contracts and providers
- [x] 4. API endpoints (Node) — epics and tasks
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
- Files: `ai-service/app/schemas.py` (added `EpicItem`/`EpicContent`/`GenerateEpicsRequest`
  — reusing `ArchitectureContent` as-is for the input — `GenerateEpicsResponse`;
  `TaskItem`/`TaskContent`/`GenerateTasksRequest` — reusing `EpicContent` as-is —
  `GenerateTasksResponse`; updated module docstring), new
  `ai-service/app/agents/{epics,tasks}/{__init__,provider,router}.py`, `ai-service/main.py`
  (wires both new routers). Also corrected two more stale docstrings found while touching this
  area: `ai-service/app/agents/__init__.py` and `ai-service/app/agents/architecture/__init__.py`
  (the latter said it was "the last link in the requirements -> PRD -> architecture chain",
  no longer true) — same recurring class of staleness caught and fixed in Phase 4's Milestone 3
  for the prior pair of docstrings.
- `EpicsProvider`/`TasksProvider` are each their own ABC, not a shared generic one with
  `ArchitectureProvider` or each other — same reasoning as every prior phase: input/output
  shapes genuinely differ per agent. `get_anthropic_api_key`/`ProviderNotConfiguredError`
  reused unmodified.
- `EpicItem.id`/`TaskItem.id` are stable short ids (`"EP-1"`, `"T-1"`) mirroring
  `RequirementItem.id`'s exact precedent, not the PRD/Architecture flat-sections shape — see
  the plan doc's "What's genuinely new" section for the full reasoning.
- Commands run and results:
  - `.venv/bin/python -m pytest tests/ -v` (before adding new epics/tasks tests, right after
    the schema addition) → `23 passed` — confirms the schema/router changes are fully
    behavior-preserving for requirements/PRD/architecture.
  - Manual (real, unmocked): started uvicorn with `ANTHROPIC_API_KEY` genuinely unset —
    `GET /health` → `{"status":"ok"}`; `POST /epics/generate` with `{}` → real `400` "Field
    required" on `architecture`; with `{"architecture":{"overview":123}}` → real `400` with
    Pydantic field-level detail; with a fully valid architecture body → real `503
    PROVIDER_NOT_CONFIGURED` with "...to enable epic generation."; `POST /tasks/generate` with
    `{}` → real `400` on `epics`; with `{"epics":{"epics":"not-a-list"}}` → real `400`; with a
    fully valid epics body → real `503 PROVIDER_NOT_CONFIGURED` with "...to enable task
    generation."; re-curled `/requirements/analyze`, `/prd/generate`, `/architecture/generate`
    and confirmed all three messages byte-for-byte unchanged after wiring in two more routers.
  - Verified before writing tests (not assumed): for epics, `{"overview":"x",
    "system_architecture":"y"}` is the minimal-valid `ArchitectureContent` (every other field
    defaults to empty list) — reaches 503, not 400. For tasks, `{"epics":{}}` is the
    minimal-valid body — `EpicContent.epics` itself defaults to an empty list, so even the
    nested object can be empty — also reaches 503, not 400. Both written into their suites as
    explicit `test_generate_accepts_minimal_valid_*_and_reaches_the_provider_check` cases.
  - `.venv/bin/python -m pytest tests/ -v` (full suite) → `39 passed` (8 new epics cases + 8
    new tasks cases, each mirroring `test_architecture.py`'s 8 exactly — plus the 23
    pre-existing requirements/PRD/architecture cases, unaffected).
  - Killed the manually-started uvicorn process by exact PID; confirmed port 8001 free
    afterward.
- Commit: `6b5e397` — "feat(ai-service): add epic- and task-generation endpoints and provider abstractions".

### 4. API endpoints (Node) — epics and tasks
- Files: `api/src/schemas/{epics,tasks}.ts` (new — `epicItemSchema`/`epicContentSchema` and
  `taskItemSchema`/`taskContentSchema`, the latter using Zod `.enum()` for `type`/`priority`/
  `estimatedComplexity` and `.number().int()` for `suggestedOrder`), `api/src/lib/
  aiServiceClient.ts` (extended — added the outbound `mapArchitectureContentToSnakeCase` and
  `mapEpicContentToSnakeCase` directions, the inbound `mapAiEpicContentToCamelCase` and
  `mapAiTaskContentToCamelCase` directions, and `generateEpicsViaAiService`/
  `generateTasksViaAiService`, reusing the existing `postToAiService` helper unchanged),
  `api/src/services/{epics,tasks}.ts` (new — mirror `services/architecture.ts`'s
  generate/list/get/update/activate shape exactly, but with `diffEpicItems`/`diffTaskItems`
  reusing `services/requirements.ts`'s id-matched item-diff logic instead of
  `architecture.ts`'s flat-field diff, per the plan's "what's genuinely new" reasoning),
  `api/src/controllers/{epics,tasks}.ts` (new), `api/src/routes/{epics,tasks}.ts` (new —
  `/compare` registered before `/:versionId` in both), `api/src/app.ts` (wires both routers).
- Before adding any new file, verified the `aiServiceClient.ts` extension was
  behavior-preserving on its own via `pnpm exec tsc --noEmit` and `pnpm exec vitest run` (both
  clean/`77 passed` with only the extension applied, no new route files yet) — same discipline
  as every prior phase's Milestone 4.
- The two dependency checks are enforced in `generateEpicsFromActiveArchitecture` (`400
  NO_ACTIVE_ARCHITECTURE`) and `generateTasksFromActiveEpics` (`400 NO_ACTIVE_EPICS`), both
  before the AI service is ever called. Both AI-service calls happen before any database
  write, so a provider failure leaves nothing partially persisted.
- Commands run and results (after implementation):
  - `pnpm exec tsc --noEmit` → clean.
  - `pnpm exec eslint .` → clean.
  - `pnpm exec vitest run` → `77 passed (77)` (unchanged — the automated Supertest files for
    the new epics/tasks routes are written in Milestone 6, per the stated implementation
    order).
- Manual end-to-end verification (real Postgres via Docker, real api dev server on :4000, real
  ai-service on :8001 with `ANTHROPIC_API_KEY` genuinely unset — killed and confirmed-clean
  stale processes on both ports before starting):
  - Registered `epics-manual@example.com`, created project "Epics Test Project".
  - `POST /projects/:id/epics/generate` with no architecture yet → real `400
    NO_ACTIVE_ARCHITECTURE`. `POST /projects/:id/tasks/generate` with no epics yet → real
    `400 NO_ACTIVE_EPICS` — both checked before any upstream artifact existed at all.
  - Seeded an active requirements version, active PRD version, and active architecture version
    directly via Prisma (the full three-link upstream chain), then re-ran epics generate →
    real `503 AI_PROVIDER_UNAVAILABLE` ("...to enable epic generation.") propagated
    end-to-end through Node → ai-service; confirmed no `EpicVersion` row was created.
  - Seeded two `EpicVersion` rows directly via Prisma (v1 with one epic "EP-1", v2 adding a
    second epic "EP-2", v2 active). `GET .../epics` → both versions, newest-first, correct
    `isActive`/`sourceArchitectureVersionId`. `GET .../epics/:v1` → correct content.
  - `POST .../epics/:v1/activate` → v1 active, v2's `isActive` flips to `false` on immediate
    re-fetch — the single-active-version invariant holds transactionally.
  - `GET .../epics/compare?a=:v1&b=:v2` → correct **item-list** diff (not the flat-field shape
    PRD/architecture use): `{"epics":{"added":[{"id":"EP-2","title":"Weekly stats
    view"}],"removed":[],"changed":[]}}` — confirms `diffEpicItems` works as designed against
    real seeded data, not just in isolation.
  - With epic v1 now active, `POST .../tasks/generate` → real `503 AI_PROVIDER_UNAVAILABLE`
    ("...to enable task generation.") — confirms the second link of the dependency chain
    reaches the AI service correctly once its own upstream is active.
  - `PATCH .../epics/:v1` with a full valid body → `200`, content persisted and echoed back.
  - `PATCH .../epics/:v1` with a body missing required item fields → real `400`.
  - `GET .../epics/compare?a=:v1&b=:v1` → real `400` (same-id rejected). Unauthenticated
    `GET .../epics` → real `401`. Cross-user `GET .../epics` → real `404`.
  - Seeded two `TaskVersion` rows directly via Prisma (v1 with task "T-1", v2 adding "T-2",
    v2 active, both sourced from epic v1). Repeated the full list/get/activate/compare/PATCH
    cycle for tasks — all correct, including the item-list diff (`{"tasks":{"added":[{"id":
    "T-2",...}],...}}`) and a real `400` when PATCHing an invalid `type` enum value
    (`"not-a-type"`), confirming Zod's `.enum()` validation fires for real through the full
    HTTP stack, not just at the schema-unit level.
  - Cleanup: deleted both manually-created users (cascaded through project/requirements/PRD/
    architecture/epics/tasks versions); confirmed via `ps aux` that only the two
    manually-started processes existed; found and killed one orphaned `tsx watch` child still
    bound to port 4000 after killing its parent (same recurring pattern as every prior phase);
    confirmed ports 4000/8001 free afterward; removed the temporary session-cookie files.
- Commit: `780fa4b` — "feat(api): add epic and task generation, versioning, and comparison endpoints".

### 5. Frontend epics/tasks flow
(pending)

### 6. Tests
(pending)

### 7. Docker verification
(pending)

### 8. Documentation
(pending)
