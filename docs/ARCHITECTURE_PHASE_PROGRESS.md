# DevForge Phase 4 (Architecture Generation) — Progress Checklist

See [docs/ARCHITECTURE_PHASE_PLAN.md](ARCHITECTURE_PHASE_PLAN.md) for scope, data model, API
contracts, and the full plan. This file tracks the 8 milestones the same way
[docs/PRD_PHASE_PROGRESS.md](PRD_PHASE_PROGRESS.md) tracked Phase 3.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Prisma schema and migration
- [x] 3. ai-service architecture contract/provider
- [x] 4. API endpoints (Node)
- [x] 5. Frontend architecture flow
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
- Commit: `6548f2f` — "feat(api): add architecture_versions data model and migration".

### 3. ai-service architecture contract/provider
- Files: `ai-service/app/schemas.py` (added `ArchitectureContent`, `GenerateArchitectureRequest`
  — reusing `PrdContent` as-is for the input, exactly how `GeneratePrdRequest` reused
  `RequirementsContent` — and `GenerateArchitectureResponse`),
  `ai-service/app/agents/architecture/{__init__,provider,router}.py`, `ai-service/main.py`
  (wires the new router), `ai-service/tests/test_architecture.py`. Also corrected two stale
  docstrings found while touching this area: `ai-service/app/agents/__init__.py` still said
  "PRD/architecture generation are not [implemented]" (true when written in Phase 2, false
  since Phase 3 shipped PRD — never updated then) and `ai-service/app/agents/prd/__init__.py`
  said architecture "remains not implemented"; both corrected as part of this milestone's
  change, not a separate cleanup.
- `ArchitectureProvider` is its own ABC, not a shared generic one with `PrdProvider` — same
  reasoning as Phase 3: input/output shapes genuinely differ (`PrdContent` in,
  `ArchitectureContent` out), so a shared ABC would be premature abstraction for two call
  sites. What's genuinely shared — `get_anthropic_api_key`/`ProviderNotConfiguredError` — was
  already written generically enough in Milestone 3 of Phase 3 to call unmodified here;
  confirmed by reading it before using it, not assumed.
- Commands run and results:
  - `.venv/bin/python -m pytest tests/ -v` (before adding new architecture tests, right after
    the schema addition) → `15 passed` — confirms the schema/router changes are fully
    behavior-preserving for requirements and PRD.
  - Manual (real, unmocked): started uvicorn with `ANTHROPIC_API_KEY` genuinely unset —
    `GET /health` → `{"status":"ok"}`; `POST /architecture/generate` with `{}` → real `400`
    "Field required" on `prd`; with `{"prd":{"overview":123}}` (wrong type) → real `400` with
    Pydantic field-level detail for both the type error and the missing
    `problem_statement`; with a fully valid PRD body → real `503
    {"error":{"code":"PROVIDER_NOT_CONFIGURED","message":"...to enable architecture
    generation."}}` (the feature-specific message); re-curled `/prd/generate` and
    `/requirements/analyze` and confirmed both messages are byte-for-byte unchanged after
    wiring in the third router.
  - Verified before writing the test (not assumed): a body with only
    `{"overview":"x","problem_statement":"y"}` is minimal-but-valid (every other `PrdContent`
    field defaults to an empty list), correctly reaching the 503 provider check, not a 400 —
    written into the suite as
    `test_generate_accepts_minimal_valid_prd_and_reaches_the_provider_check`.
  - `.venv/bin/python -m pytest tests/ -v` (full suite) → `23 passed` (8 new architecture
    cases, mirroring `test_prd.py`'s 8 exactly: health; 400 missing `prd`; 400 wrong field
    type; the minimal-valid-body case above; the real 503 not-configured case with the
    architecture-specific message; a `FakeArchitectureProvider` success case via monkeypatch;
    `AIResponseInvalidError` → 502; `ProviderRequestError` → 502 — plus the 15 pre-existing
    requirements/PRD cases, unaffected).
  - Killed the manually-started uvicorn process by exact PID; confirmed port 8001 free
    afterward.
- Commit: `38c0561` — "feat(ai-service): add architecture-generation endpoint and provider abstraction".

### 4. API endpoints (Node)
- Files: `api/src/schemas/architecture.ts` (new — `architectureContentSchema` plus the same
  param/query schema shapes `schemas/prd.ts` uses), `api/src/lib/aiServiceClient.ts` (extended
  — added the outbound `mapPrdContentToSnakeCase` direction, the inbound
  `mapAiArchitectureContentToCamelCase` direction, and `generateArchitectureViaAiService`,
  reusing the existing `postToAiService` helper unchanged), `api/src/services/architecture.ts`
  (new — mirrors `services/prd.ts`: ownership guard, `generateArchitectureFromActivePrd`,
  `listVersions`/`getVersion`/`updateVersion`/`activateVersion`,
  `diffArchitectureContent`/`compareVersions`), `api/src/controllers/architecture.ts` (new),
  `api/src/routes/architecture.ts` (new — `/compare` registered before `/:versionId`),
  `api/src/app.ts` (wires `architectureRouter`).
- Before adding any new file, verified the `aiServiceClient.ts` extension was
  behavior-preserving on its own via `pnpm exec tsc --noEmit` and `pnpm exec vitest run`
  (both clean/`60 passed` with only the extension applied, no new route files yet) — same
  discipline as Phase 3 Milestone 4.
- The active-PRD dependency is enforced in `generateArchitectureFromActivePrd`: a missing
  active `PrdVersion` throws `400 NO_ACTIVE_PRD` before the AI service is ever called. The
  AI-service call happens before any database write, so a provider failure leaves nothing
  partially persisted.
- **Environment note**: mid-milestone, `pnpm exec vitest run` twice showed spurious timeouts
  on pre-existing, unrelated tests (`projects.test.ts`'s empty-name-400 case in one run, a
  not-a-uuid case in another) with multi-hundred-second wall-clock durations for an internal
  5000ms test timeout — a symptom of severe host scheduling contention (`uptime` showed a load
  average of 16), not a code defect: `ps aux` confirmed no leftover DevForge processes were
  contributing, and a clean re-run immediately after (`16.9s`, `60 passed (60)`) confirmed the
  failures were transient host-load flakiness, not caused by this milestone's changes.
- Commands run and results (after implementation, on a clean/re-run host):
  - `pnpm exec tsc --noEmit` → clean.
  - `pnpm exec eslint .` → clean.
  - `pnpm exec vitest run` → `60 passed (60)` (unchanged — the automated Supertest file for
    the new architecture routes is written in Milestone 6, per the stated implementation
    order).
- Manual end-to-end verification (real Postgres via Docker, real api dev server on :4000, real
  ai-service on :8001 with `ANTHROPIC_API_KEY` genuinely unset — killed and confirmed-clean
  stale processes on both ports before starting):
  - Registered `arch-manual@example.com`, created project "Architecture Test Project".
  - `POST /projects/:id/architecture/generate` with no PRD yet → real `400 NO_ACTIVE_PRD`
    ("Generate and activate a PRD version before generating an architecture.").
  - Seeded an active requirements version and an active PRD version directly via Prisma, then
    re-ran generate → real `503 AI_PROVIDER_UNAVAILABLE` ("...to enable architecture
    generation.") propagated end-to-end through Node → ai-service; confirmed no
    `ArchitectureVersion` row was created.
  - Seeded two `ArchitectureVersion` rows directly via Prisma (v1 inactive, v2 active, both
    pointing at the same source PRD version).
  - `GET /projects/:id/architecture` → both versions returned, newest-first, correct
    `isActive` flags, correct `sourcePrdVersionId` on both.
  - `GET /projects/:id/architecture/:v1` → correct content returned.
  - `POST /projects/:id/architecture/:v1/activate` → v1 becomes active; `GET
    .../architecture/:v2` immediately after confirms v2's `isActive` flipped to `false` — the
    single-active-version invariant holds transactionally.
  - `GET /projects/:id/architecture/compare?a=:v1&b=:v2` → correct diff, `technologyStack: {
    added: ["Redis for caching weekly stats"], removed: [] }` (the only field seeded to
    differ), all other fields empty diffs.
  - `PATCH /projects/:id/architecture/:v1` with a full valid body → `200`, content persisted
    and echoed back correctly.
  - `PATCH /projects/:id/architecture/:v1` with a body missing required fields → real `400`.
  - `GET /projects/:id/architecture/compare?a=:v1&b=:v1` → real `400` (same-id rejected).
  - Unauthenticated `GET /projects/:id/architecture` → real `401`.
  - Registered a second user and confirmed `GET /projects/:id/architecture` with that user's
    session against the first user's project → real `404`.
  - Cleanup: deleted both manually-created users (cascaded to their projects/requirements/
    PRD/architecture versions); confirmed via `ps aux` that only the two manually-started
    processes existed; found and killed one orphaned `tsx watch` child still bound to port
    4000 after killing its parent (same recurring pattern as every prior phase); confirmed
    ports 4000/8001 free afterward; removed the temporary session-cookie files.
- Commit: `37b3ddb` — "feat(api): add architecture generation, versioning, and comparison endpoints".

### 5. Frontend architecture flow
- Files: `frontend/src/types/architecture.ts` (new — `ArchitectureContent`, `ArchitectureVersion`,
  `ArchitectureDiff` mirroring the backend Zod/Pydantic shapes),
  `frontend/src/services/architectureApi.ts` (new — one function per endpoint, mirroring
  `prdApi.ts`), `frontend/src/components/ArchitectureSection.tsx` (new — structurally parallel
  to `PrdSection.tsx`, including the `VersionDetail` `key={version.id}`-remount pattern, all 13
  content fields editable), `frontend/src/pages/ProjectOverview.tsx` (renders
  `<ArchitectureSection>` below `<PrdSection>`; removed "Architecture" from the "Not yet
  implemented" grid), `frontend/src/pages/ProjectOverview.test.tsx` (mocks `architectureApi`,
  updated the "Not yet implemented" count from 5 to 4, added an assertion for the
  architecture-blocked-state message).
- `ArchitectureSection` fetches the PRD list and its own architecture list independently on
  mount (no new coupling to `PrdSection`) and derives exactly three states, per the plan:
  **blocked** ("PRD needed first" — no active PRD version, no Generate control ever rendered),
  **empty** (active PRD exists, no architecture yet — a single "Generate architecture from PRD
  v{N}" button), **populated** (version list with an active badge, full per-field editing for
  all 13 `ArchitectureContent` fields, "Save changes", "Make active", "Regenerate from PRD
  v{N}").
- Commands run and results:
  - `pnpm exec tsc --noEmit` → clean.
  - `pnpm exec eslint .` → clean (one pre-existing, unrelated warning in `useAuth.tsx`).
  - `pnpm exec vitest run` → `30 passed (30)` after wiring `ArchitectureSection` into
    `ProjectOverview` and updating its test (the count-of-5→4 change and the new blocked-state
    assertion were verified against the real rendered DOM, not just adjusted to pass).
- Manual browser verification (real Postgres, real api on :4000, real ai-service on :8001 with
  `ANTHROPIC_API_KEY` unset, real Vite dev server on :5173 — all three started fresh after
  confirming no stale processes), driven with Playwright via a cached `npx` install against a
  real registered user and real project:
  - No requirements/PRD yet → confirmed the three-section cascade renders correctly in one
    screenshot: Requirements empty, PRD blocked ("Requirements needed first"), Architecture
    blocked ("PRD needed first") — no Generate button present anywhere in the DOM for either
    blocked section.
  - Seeded an active requirements version and an active PRD version directly via Prisma,
    reloaded → Architecture section shows the **empty** state with "Generate architecture from
    PRD v1".
  - Clicked Generate with no LLM provider configured → the real `503 AI_PROVIDER_UNAVAILABLE`
    message ("No LLM provider is configured. Set ANTHROPIC_API_KEY in the ai-service
    environment to enable architecture generation.") rendered in the UI, propagated end-to-end
    from ai-service through Node with no fabricated success.
  - Seeded two `ArchitectureVersion` rows directly via Prisma (v1 inactive, v2 active) →
    **populated** state: both versions listed, all 13 content fields rendered and editable,
    active badge on v2.
  - Selected the inactive version and clicked "Make active" → the active badge moved
    correctly and the previously-active version's badge disappeared, confirming the
    single-active-version invariant holds visually.
  - Edited the `overview` field and clicked "Save changes" → change persisted.
  - Screenshots captured for each state and reviewed directly (not just asserted to exist).
  - Cleanup: deleted the test user (cascaded through project/requirements/PRD/architecture
    versions via existing FK cascade rules), confirmed via `ps aux` that only the three
    manually-started DevForge processes existed (no orphaned `tsx watch` child this time —
    all four PIDs, including the api watcher's child, killed cleanly on the first pass),
    confirmed ports 4000/8001/5173 all free afterward.
- Commit: `58da8ed` — "feat(frontend): add Architecture section with dependency, generate, and version flows".

### 6. Tests
(pending)

### 7. Docker verification
(pending)

### 8. Documentation
(pending)
