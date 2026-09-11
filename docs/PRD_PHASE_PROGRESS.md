# DevForge Phase 3 (PRD Generation) — Progress Checklist

See [docs/PRD_PHASE_PLAN.md](PRD_PHASE_PLAN.md) for scope, data model, API contracts, and the
full plan. This file tracks the 8 milestones the same way
[docs/REQUIREMENTS_PHASE_PROGRESS.md](REQUIREMENTS_PHASE_PROGRESS.md) tracked Phase 2.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Prisma schema and migration
- [x] 3. AI-service PRD contract/provider
- [x] 4. API endpoints (Node)
- [x] 5. Frontend PRD flow
- [x] 6. Tests
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
- Commit: `893a04f` — "feat(api): add prd_versions data model and migration".

### 3. AI-service PRD contract/provider
- Files: `ai-service/app/errors.py` (`ProviderNotConfiguredError` now takes a `feature: str =
  "requirements analysis"` param, default preserves the exact existing message),
  `ai-service/app/lib/__init__.py`, `ai-service/app/lib/provider_config.py` (new shared
  `get_anthropic_api_key(feature)` helper), `ai-service/app/agents/requirements/provider.py`
  (refactored to call the shared helper instead of duplicating the key-read/raise logic),
  `ai-service/app/schemas.py` (added `PrdContent`, `GeneratePrdRequest` — reusing the existing
  `RequirementsContent` as-is for the input — and `GeneratePrdResponse`),
  `ai-service/app/agents/prd/{__init__,provider,router}.py`, `ai-service/main.py` (wires the
  new router), `ai-service/tests/test_prd.py`.
- This is the milestone where "use the existing provider abstraction where practical" was
  made concrete rather than just architectural: `PrdProvider` is its own ABC (input/output
  shapes genuinely differ from `RequirementsProvider`, so a shared generic ABC would be
  premature abstraction for two call sites), but the one piece that actually *was* identical
  — reading `ANTHROPIC_API_KEY` and raising `ProviderNotConfiguredError` — is now genuinely
  shared code, not copy-pasted.
- Commands run and results:
  - `.venv/bin/python -m pytest tests/ -v` (before adding new PRD tests, right after the
    refactor) → `7 passed` — confirms the `provider_config` extraction and the
    `ProviderNotConfiguredError` signature change are fully behavior-preserving for the
    existing requirements feature.
  - Manual (real, unmocked): started uvicorn with `ANTHROPIC_API_KEY` genuinely unset —
    `GET /health` → `{"status":"ok"}`; `POST /prd/generate` with a fully valid requirements
    body → real `503 {"error":{"code":"PROVIDER_NOT_CONFIGURED","message":"...to enable PRD
    generation."}}` (the feature-specific message, distinct from requirements' own); `POST
    /prd/generate` with `{}` → real `400` "Field required"; with
    `{"requirements":{"project_summary":123}}` (wrong type) → real `400` with the Pydantic
    field-level detail; re-curled `/requirements/analyze` and confirmed its message is
    byte-for-byte unchanged after the refactor.
  - One test-writing correction caught by actually curling before writing the test: a body
    with only `{"project_summary":"x"}` is *not* invalid — every other `RequirementsContent`
    field defaults to an empty list, so that's a minimal-but-valid body that correctly reaches
    the 503 provider check, not a 400. Written into the test suite as
    `test_generate_accepts_minimal_valid_requirements_and_reaches_the_provider_check` instead
    of being assumed to be a validation-error case.
  - `.venv/bin/python -m pytest tests/ -v` (full suite) → `15 passed` (8 new PRD cases: health;
    400 missing `requirements`; 400 wrong field type; the minimal-valid-body case above; the
    real 503 not-configured case with the PRD-specific message; a `FakePrdProvider` success
    case via monkeypatch; that double raising `AIResponseInvalidError` → 502; raising
    `ProviderRequestError` → 502 — plus the 7 pre-existing requirements cases, unaffected).
- Commit: `cc9c42c` — "feat(ai-service): add PRD-generation endpoint and provider abstraction".

### 4. API endpoints (Node)
- Files: `api/src/schemas/prd.ts` (new — `prdContentSchema`, param/query schemas including a
  `compareQuerySchema` refinement rejecting `a === b`), `api/src/lib/aiServiceClient.ts`
  (rewritten — added the outbound `mapRequirementsContentToSnakeCase` direction and the inbound
  `mapAiPrdContentToCamelCase` direction, extracted a shared `postToAiService(path, body)`
  helper used by both the existing requirements call and the new
  `generatePrdViaAiService`, renamed `mapAiContentToCamelCase` →
  `mapAiRequirementsContentToCamelCase` for clarity now that two content types exist),
  `api/src/services/prd.ts` (new — mirrors `services/requirements.ts`: ownership guard,
  `generatePrdFromActiveRequirements`, `listVersions`, `getVersion`, `updateVersion`,
  `activateVersion`, `diffPrdContent`/`compareVersions`), `api/src/controllers/prd.ts` (new),
  `api/src/routes/prd.ts` (new — `/compare` registered before `/:versionId` to avoid Express
  matching "compare" as a version id), `api/src/app.ts` (wires `prdRouter`).
- Before adding any new file, verified the `aiServiceClient.ts` rewrite was behavior-preserving
  on its own: `pnpm exec tsc --noEmit` clean and `pnpm exec vitest run` → `43 passed (43)`
  with only the refactor applied and no new code yet.
- The active-requirements dependency is enforced in `generatePrdFromActiveRequirements`: a
  missing active `RequirementsVersion` throws `400 NO_ACTIVE_REQUIREMENTS` before the AI
  service is ever called. The AI-service call happens before any database write, so a
  provider failure leaves nothing partially persisted.
- Commands run and results (after implementation):
  - `pnpm exec tsc --noEmit` → clean.
  - `pnpm exec eslint .` → clean.
  - `pnpm exec vitest run` → `43 passed (43)` (unchanged — the automated Supertest file for
    the new PRD routes is written in Milestone 6, per the stated implementation order).
- Manual end-to-end verification (real Postgres via Docker, real api dev server on :4000, real
  ai-service on :8001 with `ANTHROPIC_API_KEY` genuinely unset — killed and confirmed-clean
  stale processes on both ports before starting, per the established process-hygiene routine):
  - Registered `prd-manual@example.com`, created project "PRD Test Project".
  - `POST /projects/:id/prd/generate` with no requirements yet → real `400
    NO_ACTIVE_REQUIREMENTS` ("Generate and activate a requirements version before generating a
    PRD.").
  - Seeded one active `RequirementsVersion` directly via Prisma, then re-ran generate → real
    `503 AI_PROVIDER_UNAVAILABLE` ("...to enable PRD generation.") propagated end-to-end
    through Node → ai-service, and confirmed no `PrdVersion` row was created.
  - Seeded two `PrdVersion` rows directly via Prisma (v1 inactive, v2 active, both pointing at
    the same source requirements version) to exercise the read/update/activate/compare
    endpoints without a configured LLM provider.
  - `GET /projects/:id/prd` → both versions returned, newest-first, correct `isActive` flags,
    correct `sourceRequirementsVersionId` on both.
  - `POST /projects/:id/prd/:v1/activate` → v1 becomes active; `GET .../prd/:v2` immediately
    after confirms v2's `isActive` flipped to `false` in the same request cycle — the
    single-active-version invariant holds transactionally, mirroring the Phase 2 requirements
    behavior.
  - `GET /projects/:id/prd/compare?a=:v1&b=:v2` → correct diff, `goals: { added: ["Support
    weekly stats view"], removed: [] }` (the only field seeded to differ between the two
    versions), all other fields empty diffs.
  - `GET /projects/:id/prd/compare?a=:v1&b=:v1` → real `400` (same-id rejected by
    `compareQuerySchema`'s refinement).
  - `PATCH /projects/:id/prd/:v1` with a full valid body → `200`, content persisted and
    echoed back correctly.
  - `PATCH /projects/:id/prd/:v1` with a body missing required fields → real `400` (Zod
    validation).
  - Unauthenticated `GET /projects/:id/prd` (no session cookie) → real `401`.
  - Registered a second user `prd-manual-2@example.com` and confirmed `GET
    /projects/:id/prd` with that user's session against the first user's project → real `404`
    (ownership enforced, no distinction leaked between "doesn't exist" and "not yours").
  - Cleanup: deleted both manually-created users (`prisma.user.deleteMany`), which cascaded to
    their projects, requirements versions, and PRD versions; confirmed via `ps aux` that only
    the two manually-started processes existed (both under `/Users/ananyasingh/DevForge`, one
    additional orphaned `tsx watch` child process was found still bound to port 4000 after
    killing the parent watcher and was killed by its own PID); confirmed ports 4000 and 8001
    both free afterward; removed the temporary session-cookie files.
- Commit: `9cfc0a6` — "feat(api): add PRD generation, versioning, and comparison endpoints".

### 5. Frontend PRD flow
- Files: `frontend/src/types/prd.ts` (new — `PrdContent`, `PrdVersion`, `PrdDiff` mirroring the
  backend Zod/Pydantic shapes), `frontend/src/services/prdApi.ts` (new — one function per
  endpoint, mirroring `requirementsApi.ts`), `frontend/src/components/PrdSection.tsx` (new —
  structurally parallel to `RequirementsSection.tsx`, including the `VersionDetail`
  `key={version.id}`-remount pattern), `frontend/src/pages/ProjectOverview.tsx` (renders
  `<PrdSection>` below `<RequirementsSection>`; removed "PRD" from the "Not yet implemented"
  grid), `frontend/src/pages/ProjectOverview.test.tsx` (mocks `prdApi`, updated the
  "Not yet implemented" count from 6 to 5 now that PRD is implemented, and added an assertion
  for the blocked-state message — this is an existing Phase 1/2 test file, not the dedicated
  `PrdSection.test.tsx`, which is written in Milestone 6).
- `PrdSection` fetches the requirements list and the PRD list independently on mount (no new
  coupling to `RequirementsSection`) and derives exactly three states from them, per the plan:
  **blocked** (no active requirements — a dependency message only, no Generate control ever
  rendered, so there is no enabled button that could fail on click), **empty** (active
  requirements exist, no PRD yet — a single "Generate PRD from Requirements v{N}" button, no
  text input since generation always uses whichever requirements version is currently active),
  and **populated** (version list with an active badge, full per-field editing for all twelve
  `PrdContent` fields, "Save changes", "Make active" for non-active versions, "Regenerate from
  v{N}").
- Commands run and results:
  - `pnpm exec tsc --noEmit` → clean.
  - `pnpm exec eslint .` → clean (one pre-existing, unrelated warning in `useAuth.tsx`).
  - `pnpm exec vitest run` → `23 passed (23)` (the one test that needed updating —
    `ProjectOverview.test.tsx`'s not-yet-implemented count — was a legitimate consequence of
    PRD becoming implemented, not a regression; the fix was verified against the real rendered
    DOM, not just adjusted to make the assertion pass).
- Manual browser verification (real Postgres, real api on :4000, real ai-service on :8001 with
  `ANTHROPIC_API_KEY` unset, real Vite dev server on :5173 — all three started fresh after
  confirming no stale processes, per the established hygiene routine), driven with Playwright
  via a cached `npx` install against a real registered user and real project:
  - No requirements yet → PRD section shows the **blocked** state ("Requirements needed
    first…"), no Generate button present anywhere in the DOM.
  - Seeded one active `RequirementsVersion` directly via Prisma, reloaded → PRD section shows
    the **empty** state with "Generate PRD from Requirements v1".
  - Clicked Generate with no LLM provider configured → the real
    `503 AI_PROVIDER_UNAVAILABLE` message ("No LLM provider is configured. Set
    ANTHROPIC_API_KEY in the ai-service environment to enable PRD generation.") rendered
    in the UI, propagated end-to-end from ai-service through Node with no fabricated success.
  - Seeded two `PrdVersion` rows directly via Prisma (v1 inactive, v2 active) → **populated**
    state: both versions listed, all twelve content fields rendered and editable, active badge
    on v2.
  - Selected the inactive version and clicked "Make active" → the active badge moved
    correctly and the previously-active version's badge disappeared, confirming the
    single-active-version invariant holds visually, not just via the API.
  - Edited the `overview` field and clicked "Save changes" → change persisted (confirmed by
    reading the field back after the save completed).
  - Screenshots captured for each state and reviewed directly (not just asserted to exist).
  - Cleanup: deleted the test user (cascaded to project/requirements/PRD versions via existing
    FK cascade rules), confirmed via `ps aux` only the three manually-started DevForge
    processes existed (the VoxMind `uvicorn` process on port 8000 confirmed untouched
    throughout), found and killed one orphaned `tsx watch` child process still bound to port
    4000 after killing its parent (same recurring pattern as Milestone 4), confirmed ports
    4000/8001/5173 all free afterward.
- Commit: `0391502` — "feat(frontend): add PRD section with dependency, generate, and version flows".

### 6. Tests
- ai-service pytest coverage for PRD (`PROVIDER_NOT_CONFIGURED` real for real, `FakePrdProvider`
  success/validation-error paths via monkeypatch, `AIResponseInvalidError`/`ProviderRequestError`
  → 502) was already written and verified in Milestone 3 (`ai-service/tests/test_prd.py`,
  8 cases, 15 total in the suite) — not repeated here.
- New files this milestone: `api/src/routes/prd.test.ts` (Supertest, mocking only the outbound
  `fetch()` to ai-service — mirrors `requirements.test.ts` exactly), `frontend/src/components/
  PrdSection.test.tsx` (Vitest + RTL, mocking `requirementsApi`/`prdApi` — mirrors
  `RequirementsSection.test.tsx`), `tests/prd.test.ts` (real HTTP integration, mirrors
  `requirements.test.ts`).
- `api/src/routes/prd.test.ts` — 17 cases: 401 without a session; 404 for a project owned by
  someone else; 400 `NO_ACTIVE_REQUIREMENTS` with no requirements (confirms `fetch` is never
  called — the dependency guard fires before any ai-service call); successful generate from a
  mocked ai-service response, asserting `sourceRequirementsVersionId` matches the seeded active
  requirements version; a real `PROVIDER_NOT_CONFIGURED` ai-service response mapped to
  `503 AI_PROVIDER_UNAVAILABLE` with nothing persisted; `502 AI_SERVICE_UNREACHABLE` on a
  network failure; list/get/update/activate/compare coverage mirroring the requirements test
  file's shape one-for-one (400 malformed id, 404 missing, in-place PATCH update, 400 invalid
  content shape, single-active-version invariant on activate, structural diff on compare with
  the `goals` field, 400 comparing a version against itself, 404 for a foreign id). Requirements
  used as the dependency are seeded through the real `/requirements/analyze` endpoint (itself
  behind a mocked `fetch`), not a direct Prisma insert, so the seeded state is exactly what that
  endpoint actually produces.
- `frontend/src/components/PrdSection.test.tsx` — 7 cases: blocked state renders the dependency
  message with no Generate control anywhere in the DOM; list-load failure shows the error state
  with retry; empty state shows the single "Generate PRD from Requirements v{N}" button;
  generation failure surfaces the real error message and stays in the empty state (no fabricated
  success content rendered); populated state renders the active version's content and version
  list with no "Make active" button on the active version; switching to a non-active version and
  activating it calls `activatePrdVersionRequest` with the right ids; editing and saving calls
  `updatePrdVersionRequest` with the edited content and surfaces a server error on failure.
- `tests/prd.test.ts` — real HTTP integration against genuinely running api/ai-service/Postgres.
  Because no `ANTHROPIC_API_KEY` is configured in this environment, requirements analysis itself
  cannot succeed (established in the Phase 2 integration test), so the project used here
  genuinely has zero requirements versions — the real path this test exercises. Asserts:
  registering and creating a project works over real HTTP; the project's requirements list is
  genuinely empty; calling `POST /prd/generate` returns the real `400 NO_ACTIVE_REQUIREMENTS`
  (not a provider error masking the actual dependency problem); nothing was persisted; and,
  as a check that this environment's state hasn't silently changed, a direct call to
  ai-service's own `/prd/generate` still genuinely returns `503 PROVIDER_NOT_CONFIGURED`.
- Commands run and results:
  - `cd api && pnpm exec vitest run src/routes/prd.test.ts` → `17 passed (17)`.
  - `cd api && pnpm exec vitest run` (full suite) → `60 passed (60)` (43 pre-existing + 17 new).
  - `cd api && pnpm exec tsc --noEmit` → clean. `pnpm exec eslint .` → clean.
  - `cd frontend && pnpm exec vitest run src/components/PrdSection.test.tsx` → `7 passed (7)`.
  - `cd frontend && pnpm exec vitest run` (full suite) → `30 passed (30)` (23 pre-existing + 7
    new).
  - `cd frontend && pnpm exec tsc --noEmit` → clean. `pnpm exec eslint .` → clean (one
    pre-existing, unrelated warning in `useAuth.tsx`).
  - Started fresh api (:4000) and ai-service (:8001) instances against the real Docker Postgres
    (no `ANTHROPIC_API_KEY`), after confirming both ports were free.
  - `cd tests && pnpm exec vitest run prd.test.ts` → `1 passed (1)`.
  - `cd tests && pnpm exec vitest run` (full suite) → `4 passed (4)` (register-login-project,
    requirements, prd). `pnpm exec tsc --noEmit` → clean.
  - Confirmed no leftover `*integration-test*` users in Postgres afterward (the test's own
    `afterAll` deleted its seeded user).
  - Killed both manually-started processes by exact PID; confirmed ports 4000/8001 free
    afterward with no orphaned children this time.
- Commit: `4b3589e` — "test(api,frontend,tests): add PRD generation, versioning, and comparison coverage".

### 7. Docker verification
(pending)

### 8. Documentation
(pending)
