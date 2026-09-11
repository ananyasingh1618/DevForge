# DevForge Phase 4 (Architecture Generation) — Progress Checklist

See [docs/ARCHITECTURE_PHASE_PLAN.md](ARCHITECTURE_PHASE_PLAN.md) for scope, data model, API
contracts, and the full plan. This file tracks the 8 milestones the same way
[docs/PRD_PHASE_PROGRESS.md](PRD_PHASE_PROGRESS.md) tracked Phase 3.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Prisma schema and migration
- [x] 3. ai-service architecture contract/provider
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
(pending)

### 5. Frontend architecture flow
(pending)

### 6. Tests
(pending)

### 7. Docker verification
(pending)

### 8. Documentation
(pending)
