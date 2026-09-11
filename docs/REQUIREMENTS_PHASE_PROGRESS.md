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
- Commit: recorded below once made.

### 5. Frontend requirements flow
(pending)

### 6. Tests
(pending)

### 7. Docker and documentation
(pending)
