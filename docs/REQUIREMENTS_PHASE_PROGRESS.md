# DevForge Phase 2 (Requirements Analysis) — Progress Checklist

See [docs/REQUIREMENTS_PHASE_PLAN.md](REQUIREMENTS_PHASE_PLAN.md) for scope, data model, API
contracts, and the full plan. This file tracks the 7 milestones the same way
[docs/FOUNDATION_PROGRESS.md](FOUNDATION_PROGRESS.md) tracked the Foundation phase.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Data model and migration
- [x] 3. AI-service contract and provider abstraction
- [x] 4. API endpoints (Node)
- [x] 5. Frontend requirements flow
- [x] 6. Tests
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
- Commit: `a07a361` — "feat(api): add requirements_versions data model and migration".

### 3. AI-service contract and provider abstraction
- Files: `ai-service/app/schemas.py` (Pydantic `RequirementItem`/`RequirementsContent`/
  request/response models, shared between FastAPI validation and the Anthropic structured-
  output schema), `ai-service/app/errors.py` (`AppError` + subclasses, exception handlers
  producing the same `{"error": {"code","message"}}` envelope the Node API uses),
  `ai-service/app/agents/requirements/{__init__,provider,router}.py`, `ai-service/main.py`
  (wires the router + handlers), `ai-service/app/agents/__init__.py` (docstring updated —
  requirements is no longer "not implemented"), `ai-service/requirements.txt` (added
  `pydantic`, `anthropic`), new `ai-service/requirements-dev.txt` (`pytest`, `httpx`, kept out
  of the production image), `ai-service/tests/test_requirements.py`.
- Consulted the `claude-api` skill's Python docs for the exact `client.messages.parse(...,
  output_format=PydanticModel)` structured-output pattern and the typed-exception chain
  (`BadRequestError` → `AuthenticationError` → `PermissionDeniedError` → `NotFoundError` →
  `RateLimitError` → `APIStatusError` → `APIConnectionError`), used as-is in `provider.py`.
  Model is `claude-opus-5` per the skill's default (no model was named).
- Real bug found and fixed by testing, not assumed: with `provider: RequirementsProvider =
  Depends(get_provider)` as a route parameter, FastAPI resolved that parameter-less
  dependency *before* validating the request body — a too-short or missing `idea` returned
  503 `PROVIDER_NOT_CONFIGURED` instead of 400 `VALIDATION_ERROR`, confirmed by curling both
  cases against a live instance. Fixed by calling `get_provider()` explicitly inside the
  handler, after FastAPI has already validated `body: AnalyzeRequirementsRequest` as a normal
  parameter — tests override it via `monkeypatch.setattr(provider_module, "get_provider",
  ...)` instead of `app.dependency_overrides`, documented in a code comment so it isn't
  "fixed" back to the broken version later.
- Commands run and results:
  - `.venv/bin/pip install -r requirements-dev.txt` → clean install.
  - Manual (real, unmocked): started uvicorn with `ANTHROPIC_API_KEY` genuinely unset —
    `GET /health` → `{"status":"ok"}`; `POST /requirements/analyze` with a valid idea → real
    `503 {"error":{"code":"PROVIDER_NOT_CONFIGURED",...}}`; with `"idea":"short"` → real
    `400 VALIDATION_ERROR` with Pydantic's field-level detail; with `{}` → real `400` "Field
    required". All three curled directly against a running instance, not just unit-tested.
  - `.venv/bin/python -m pytest tests/ -v` → `7 passed` (health; 400 short idea; 400 missing
    field; the real 503-not-configured case; a `FakeRequirementsProvider` success case via
    monkeypatch; that same double raising `AIResponseInvalidError` → 502; raising
    `ProviderRequestError` → 502) — all in well under a second, confirming none of them made
    a real network call.
- Commit: `9fc6344` — "feat(ai-service): add requirements-analysis endpoint and provider
  abstraction".

### 4. API endpoints (Node)
- Files: `api/src/schemas/requirements.ts`, `api/src/lib/aiServiceClient.ts` (calls ai-service,
  maps its snake_case response to camelCase, re-validates with Zod before returning), 
  `api/src/services/requirements.ts` (CRUD + the transactional single-active-version
  invariant + the structural diff), `api/src/controllers/requirements.ts`,
  `api/src/routes/requirements.ts` (mounted in `api/src/app.ts`), `api/src/env.ts`
  (`AI_SERVICE_URL` added).
- Route ordering note (not a bug, a deliberate precaution): `GET
  /projects/:projectId/requirements/compare` is registered before `GET
  /projects/:projectId/requirements/:versionId`, since Express matches route patterns in
  registration order and "compare" would otherwise be swallowed as a `:versionId` value.
- Real process-hygiene issue hit and fixed while manually verifying: after starting a fresh
  dev server, every new endpoint returned 404 `Route not found`, including the simplest one
  (`GET .../requirements`). `ps aux` revealed roughly a dozen orphaned `tsx watch` processes
  accumulated across this entire session (both phases) — killing "the" server by port only
  ever frees whichever process currently holds the port, and earlier stale wrapper processes
  survived un-killed. Port 4000 turned out to still be bound by a leftover process running
  code from before Milestone 4's files existed. Fixed by killing every matching `tsx`/loader
  process for this project and starting exactly one fresh instance; the same routes then
  worked immediately (also independently confirmed via an in-process Supertest check before
  touching any server process, which returned 401 as expected, proving the route logic itself
  was correct all along and the 404 was purely a stale-process artifact).
- Commands run and results, all against the real running API (+ ai-service where relevant),
  never mocked at this layer:
  - `pnpm exec tsc --noEmit` → clean. `pnpm exec eslint .` → clean.
  - `pnpm exec vitest run` → `26 passed (26)`, unchanged (requirements tests are Milestone 6).
  - Registered a user, created a project. `POST .../analyze` with ai-service **not running** →
    real `502 AI_SERVICE_UNREACHABLE`.
  - Started ai-service for real (still no `ANTHROPIC_API_KEY`). `POST .../analyze` with a
    valid idea → real `503 AI_PROVIDER_UNAVAILABLE`, message passed through from ai-service's
    own real 503.
  - `POST .../analyze` with `"idea":"short"` → real `400 VALIDATION_ERROR` at the Node layer,
    before any call to ai-service.
  - Confirmed via `GET .../requirements` that all three failed attempts above persisted
    nothing (empty list) — no partial/garbage rows.
  - Seeded two requirements versions directly via a Prisma script (clearly test data, not a
    claimed LLM result) to exercise the rest of the surface: `GET .../requirements` → both
    versions, newest first, correct `isActive` flags; `GET .../requirements/:id` → full
    content; `POST .../requirements/:id/activate` on v1 → `200`, and a follow-up `GET` on v2
    confirmed it was atomically deactivated; `GET .../requirements/compare?a=&b=` → correct
    diff (`FR-2` reported as `added` between v1 and v2); the same id twice → real `400`;
    `PATCH .../requirements/:id` → content updated and echoed back.
  - Registered a second user and confirmed `GET .../requirements` for the first user's
    project returns a real `404` (cross-owner, not a 403, no leaked data).
  - Confirmed a fully unauthenticated request → real `401`.
  - Test users and their data deleted afterward; both server processes stopped.
- Commit: `5fba1e9` — "feat(api): add requirements endpoints
  (analyze/list/get/update/activate/compare)".

### 5. Frontend requirements flow
- Files: `frontend/src/types/requirements.ts`, `frontend/src/services/requirementsApi.ts`,
  `frontend/src/components/RequirementsSection.tsx` (+ test), `frontend/src/pages/
  ProjectOverview.tsx` (Requirements removed from the "Not yet implemented" grid, real
  section rendered above it) and its test updated to match.
- Real lint-caught bug, same class as the Foundation phase's `Projects.tsx` fix: resetting an
  editable `draft` copy via `useEffect(() => setDraft(...), [selectedVersion])` tripped
  `eslint-plugin-react-hooks`'s synchronous-setState-in-effect rule. Fixed the React-idiomatic
  way this time — extracted the editable panel into its own `VersionDetail` component
  rendered with `key={selectedVersion.id}`, so switching versions remounts it with fresh
  local state instead of syncing state via an effect. No effect needed at all afterward.
- Commands run and results:
  - `pnpm exec tsc -b` (frontend) → clean.
  - `pnpm exec eslint .` (frontend) → clean (one pre-existing unrelated warning).
  - `pnpm exec vitest run` (frontend) → `23 passed (23)` across 7 files — empty state +
    Analyze-button-disabled-until-10-chars + a provider-unavailable analyze failure that
    leaves the empty state intact (no fabricated content rendered); populated state shows the
    active version's content and version list; switching to a non-active version and
    activating it calls the API with the right ids; editing the summary and saving PATCHes
    the right payload and surfaces a real server error on failure; a list-load failure shows
    the error state with retry. `ProjectOverview.test.tsx` updated: now asserts exactly 6
    "Not yet implemented" cards (Requirements removed) and that the Requirements section's own
    empty state renders.
  - Manual, full real stack (Postgres + api + ai-service with no key + frontend, all
    genuinely running): drove a real browser with Playwright — registered, created a project,
    saw the real empty state, submitted a real idea, and got the real, honest
    `AI_PROVIDER_UNAVAILABLE` error message in the UI (idea text preserved for retry) — zero
    console errors, and confirmed the page never rendered fabricated requirement content
    (`FR-1` absent from the DOM). Seeded a full version directly via Prisma and reloaded in a
    fresh browser session (had to log in again, confirming session cookies work correctly
    across a new context) — the populated UI correctly showed the version sidebar, editable
    summary/lists, and both functional/non-functional requirement cards with priority and
    source badges. Screenshots sent to the user in-session.
  - Process hygiene: after stopping all three servers, `ps aux` again showed two orphaned
    `tsx watch` processes for this project (the same class of issue as Milestone 4) — killed
    them by exact PID this time, and left an unrelated VoxMind `uvicorn` process on port 8000
    completely untouched (confirmed by name/path before killing anything).
  - Test user and project data deleted afterward.
- Commit: `afda276` — "feat(frontend): add Requirements section to project overview".

### 6. Tests
- Files: `api/src/routes/requirements.test.ts` (17 Supertest cases), new
  `tests/requirements.test.ts` (real-HTTP integration, extends the Foundation phase's
  `tests/` package). Milestones 3 and 5 already added `ai-service/tests/test_requirements.py`
  (7 pytest cases) and `frontend/src/components/RequirementsSection.test.tsx` (part of the
  frontend's 23), so this milestone closes the one remaining gap: automated API-layer tests
  for the new endpoints (Milestone 4 verified them thoroughly but only manually).
- `requirements.test.ts` (api) mocks the outbound `fetch()` call to ai-service via
  `vi.stubGlobal`/`vi.unstubAllGlobals` — a clearly-commented test double for that one HTTP
  boundary, never presented as a real LLM call — while everything else (auth, Postgres via
  Prisma, ownership) runs for real, matching how `auth.test.ts`/`projects.test.ts` already
  work. Covers: 401 unauthenticated and 404 cross-owner on every endpoint; 400 for a
  too-short idea *without calling ai-service at all* (asserted via the mock's call count);
  version 1 created active from a mocked successful ai-service response, including the
  snake_case→camelCase mapping; a mocked real ai-service 503 `PROVIDER_NOT_CONFIGURED`
  correctly becomes the Node API's 503 `AI_PROVIDER_UNAVAILABLE` with nothing persisted; a
  network failure becomes 502 `AI_SERVICE_UNREACHABLE`; list ordering and `isActive` flags;
  get 400 (malformed id) / 404 (missing); PATCH updates in place without creating a new
  version, and rejects an invalid content shape; activate atomically deactivates the
  previous version; compare returns the correct structural diff, rejects `a === b` with 400,
  and 404s on a foreign/missing id.
- Bug caught by the tests themselves while writing them: the compare test's second `analyze`
  call originally sent `{"idea": "v2"}` — 2 characters, failing the API's own 10-character
  minimum before the mocked ai-service was ever reached, so `res.body.data` was `undefined`.
  Fixed by using a real ≥10-character idea string; not a product bug, a test-authoring
  mistake caught immediately by running it.
- `tests/requirements.test.ts` runs against the genuinely running API + ai-service (both
  started for real, Postgres included) with no mocking anywhere. It first confirms directly
  against ai-service's own `/requirements/analyze` that this environment truly has no
  provider configured (real 503 `PROVIDER_NOT_CONFIGURED`), then makes the same request
  through the Node API a user's browser would use and asserts the real 503
  `AI_PROVIDER_UNAVAILABLE`, then confirms nothing was persisted. No test in this phase
  claims a real LLM call succeeded, consistent with the plan.
- Commands run and results:
  - `pnpm exec tsc --noEmit` (api) → clean.
  - `pnpm exec vitest run` (api) → `43 passed (43)` (26 pre-existing + 17 new), after fixing
    the idea-length test bug above.
  - `pnpm exec eslint .` (api) → clean.
  - Root `pnpm typecheck` / `pnpm lint` / `pnpm test` → all clean across api, frontend, and
    the integration-tests package.
  - `.venv/bin/python -m pytest tests/ -v` (ai-service) → `7 passed` (re-run for completeness,
    unchanged from Milestone 3).
  - Started Postgres + a real api instance + a real ai-service instance (no
    `ANTHROPIC_API_KEY`); `cd tests && pnpm test` → `2 test files, 3 passed` (the Foundation
    phase's original register→login→create→list test plus the new requirements one).
  - `psql`: confirmed 0 leftover rows for both integration tests' email patterns after the
    run.
  - Process hygiene: after stopping both servers, one more orphaned `tsx watch` process was
    found and killed by exact PID (same recurring class of issue, now routinely checked for
    after every manual server session in this phase).
- Commit: recorded below once made.

### 7. Docker and documentation
(pending)
