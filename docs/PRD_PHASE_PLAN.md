# DevForge Phase 3: PRD Generation — Implementation Plan

Builds on the Foundation phase (`docs/FOUNDATION_PROGRESS.md`) and Phase 2
(`docs/REQUIREMENTS_PHASE_PLAN.md` / `docs/REQUIREMENTS_PHASE_PROGRESS.md`): auth, project
ownership, the `RequirementsVersion` model and its API/AI-service/frontend, and the Docker
Compose stack are all already working and are **preserved, not redesigned**. This phase adds
one capability: turning the project's **active requirements version** into a structured,
versioned PRD (Product Requirements Document).

## Scope

In scope, mirroring the requirements-phase pattern exactly (same architecture, same
conventions, new domain):

- A `PrdVersion` record per generation (or manual edit), scoped to a project, storing
  structured JSON, tracking which `RequirementsVersion` it was generated from.
- Generate (from the project's active requirements — no free-text input, unlike requirements
  analysis), list versions, get one, update a version's content, mark a version active,
  compare two versions.
- The same single Anthropic provider, via a PRD-specific provider abstraction that reuses the
  requirements phase's architectural pattern (ABC + `get_provider()` factory + typed error
  chain) and — concretely, not just in spirit — the small piece that's genuinely identical
  between them: reading `ANTHROPIC_API_KEY` and raising `ProviderNotConfiguredError`. That
  duplicated logic is extracted into `ai-service/app/lib/provider_config.py` and both the
  requirements and PRD providers now call it.
- A PRD section on the project overview, directly below Requirements, with dependency
  messaging when there's no active requirements version to generate from.

Explicitly out of scope for this phase (per the user's instructions):

- Architecture generation, epics/stories/tasks, GitHub integration, AST parsing, repository
  ingestion, retrieval, codebase Q&A, code review, evaluation pipeline.
- Any redesign of existing UI (auth pages, project pages, the Requirements section) beyond
  adding the new PRD section in the same place `RequirementsSection` already establishes.
- A frontend compare view — the requirements phase never built one either (only the API), and
  the user's frontend requirements list for this phase doesn't ask for one; the compare
  **API** endpoint is still required and built.
- Claiming a real LLM call succeeded: this environment has no `ANTHROPIC_API_KEY` configured
  (same as Phase 2 — re-confirmed below), so no test in this phase claims a real provider call
  passed.

## Confirming the environment still has no configured provider

```
$ env | grep -i anthropic
(no output)
```

Unchanged since Phase 2. The "provider not configured" path is tested for real; a successful
generation is tested only via a clearly-labeled test double.

## The active-requirements dependency

`RequirementsVersion`'s existing invariant (enforced since Phase 2 in
`analyzeAndCreateVersion` / `activateVersion`, both wrapped in a transaction) guarantees: **if
any requirements version exists for a project, exactly one of them is active.** There is no
way, through the existing API, to end up with requirements versions but no active one, or to
delete a requirements version. Consequently, "no active requirements version" is exactly
equivalent to "the project's requirements list is empty" — a strictly simpler condition to
check than looking for an active flag, and the one the frontend and backend both use.

## Data model

New Prisma model, additive only — every existing model and Phase 2's `RequirementsVersion`
are untouched:

```prisma
model PrdVersion {
  id                         String   @id @default(uuid())
  projectId                  String   @map("project_id")
  version                    Int
  sourceRequirementsVersionId String  @map("source_requirements_version_id")
  content                    Json
  isActive                   Boolean  @default(false) @map("is_active")
  createdAt                  DateTime @default(now()) @map("created_at")
  updatedAt                  DateTime @updatedAt @map("updated_at")

  project                   Project              @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sourceRequirementsVersion RequirementsVersion   @relation(fields: [sourceRequirementsVersionId], references: [id])

  @@unique([projectId, version])
  @@index([projectId])
  @@index([sourceRequirementsVersionId])
  @@map("prd_versions")
}
```

`Project` gains `prdVersions PrdVersion[]`; `RequirementsVersion` gains `prdVersions
PrdVersion[]` (the inverse side of the source-tracking relation, so the API can `include` the
source version's `version` number for display without denormalizing it). Deleting a project
cascade-deletes its PRD versions (matching every existing cascade). The
`sourceRequirementsVersionId` relation has no `onDelete` override (Prisma/Postgres default
`NO ACTION`) — there is no endpoint that deletes an individual `RequirementsVersion`, so this
never fires in practice; it exists for correctness, not as a workaround for a real deletion
path.

`content` JSON shape (validated by Zod on the Node side and the mirrored Pydantic model on
the ai-service side, exactly like `RequirementsContent`):

```ts
type PrdContent = {
  overview: string;
  problemStatement: string;
  goals: string[];
  personas: string[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  userWorkflows: string[];
  edgeCases: string[];
  successCriteria: string[];
  constraints: string[];
  assumptions: string[];
  openQuestions: string[];
};
```

Field selection reconciles both source spec documents' PRD field lists (the Final
Full-Completion Specification's "problem, users, goals, functional/non-functional
requirements, constraints, assumptions" and the Master Project Blueprint's "overview, goals,
personas, functional/non-functional requirements, workflows, edge cases, success criteria,
constraints, open questions") — a strict union, nothing dropped from either.

## API contracts

Same shape as the requirements endpoints — authenticated, project-ownership-scoped (404 for
missing/foreign projects on every one), same `{ data }` / `{ error }` envelope. Base path:
`/projects/:projectId/prd`.

| Method | Path | Body / query | Success | Notes |
|---|---|---|---|---|
| POST | `/projects/:projectId/prd/generate` | — (no body; uses the active requirements) | 201 `{ data: { version } }` | 400 `NO_ACTIVE_REQUIREMENTS` if the requirements list is empty; 503 `AI_PROVIDER_UNAVAILABLE` / 502 `AI_SERVICE_UNREACHABLE` / 502 `AI_RESPONSE_INVALID` mirroring requirements/analyze |
| GET | `/projects/:projectId/prd` | — | 200 `{ data: { versions } }` | Newest first |
| GET | `/projects/:projectId/prd/:versionId` | — | 200 `{ data: { version } }` | 404 if missing/foreign |
| PATCH | `/projects/:projectId/prd/:versionId` | full `PrdContent` | 200 `{ data: { version } }` | In-place edit, no new version |
| POST | `/projects/:projectId/prd/:versionId/activate` | — | 200 `{ data: { version } }` | Atomically unsets the previous active version |
| GET | `/projects/:projectId/prd/compare?a=&b=` | — | 200 `{ data: { a, b, diff } }` | 400 if `a === b`; 404 if either id is foreign/missing |

Compare diff: every `PrdContent` field is either a plain string (reported as `{changed:
boolean}`) or a string array (reported via the same added/removed set-difference the
requirements diff already uses) — genuinely "cleanly supported" by the data model, no new
diffing concept needed.

## AI-service flow

New router mounted alongside the existing (untouched) `/health` and `/requirements/analyze`:

- `POST /prd/generate` — body `{ requirements: RequirementsContent }` (reusing the *existing*
  `RequirementsContent` Pydantic model as-is — the input to PRD generation is exactly the
  shape requirements analysis already produces, no new request schema needed for it).
- `PrdProvider` (ABC) + `AnthropicPrdProvider`, structured on the same shape as
  `RequirementsProvider` — `client.messages.parse(model="claude-opus-5",
  output_format=PrdContent, ...)`. The system prompt explicitly instructs the model to
  *synthesize* a PRD narrative from the given requirements, not restate them verbatim.
- `get_provider()` calls the new shared `app/lib/provider_config.get_anthropic_api_key("PRD
  generation")`, raising `ProviderNotConfiguredError("PRD generation")` (the error class is
  generalized to take a `feature` string; the existing requirements call site keeps its
  current default text unchanged).
- Same typed-exception chain, same `AIResponseInvalidError` when `parsed_output` is `None`,
  same error envelope via the existing (untouched) `register_error_handlers`.

## Validation strategy

- **Node API**: Zod schemas for the version/project-id route params (reusing the *pattern*
  from `schemas/requirements.ts`, new file `schemas/prd.ts`), the full-content PATCH body
  (every `PrdContent` field validated), and the compare query params. `analyzeAndCreateVersion`'s
  equivalent (`generatePrdFromActiveRequirements`) takes no body to validate — the only input
  is `projectId`, already uuid-validated by the route param schema.
- **ai-service**: the `GeneratePrdRequest` Pydantic model validates that `requirements` is a
  well-formed `RequirementsContent` (FastAPI/Pydantic does this automatically); `PrdContent`
  validates the LLM's structured output the same way `RequirementsContent` already does.
- **Node → ai-service boundary**: Node's `aiServiceClient.ts` gains the *outbound* mapping
  direction it didn't need before (camelCase → snake_case, to send the active requirements to
  ai-service) alongside a new inbound mapping (snake_case `PrdContent` → camelCase), both
  re-validated with Zod after mapping, exactly like the existing requirements mapping.

## Frontend flow

A `PrdSection` component, structurally parallel to `RequirementsSection`, rendered in
`ProjectOverview` directly below it; "PRD" removed from the "Not yet implemented" grid.

On mount, fetches **both** the requirements list and the PRD list (independently — no new
coupling between `RequirementsSection` and `PrdSection`, consistent with keeping each section
self-contained). Because of the active-requirements invariant above, exactly one of three
states follows:

- **Requirements list empty** → a blocked/dependency message ("Generate requirements first,
  then come back to generate a PRD.") with **no Generate button rendered at all** — never an
  enabled control that would fail on click.
- **Requirements exist, PRD list empty** → an empty state: "Generate PRD from Requirements
  v{N}" button (no text input — generation always uses whatever is currently active), loading
  state, and a provider-unavailable / error state with retry, matching Requirements' error
  handling exactly.
- **PRD versions exist** → version list with an active badge, a "Regenerate" action (always
  uses the *currently* active requirements version, which may have changed since an earlier
  PRD), per-field editing (one-per-line textareas for every array field, larger textareas for
  `overview`/`problemStatement`) with Save → PATCH, and "Make active" for non-active versions
  — the same interaction pattern `RequirementsSection`'s `VersionDetail` already established
  (including the `key={version.id}`-remount technique instead of an effect, to avoid the same
  `eslint-plugin-react-hooks` issue hit twice already in this repository).

## Test plan

- **ai-service (pytest)**: `PROVIDER_NOT_CONFIGURED` tested for real (no key is set here);
  success/validation-error paths use a `FakePrdProvider` injected via monkeypatch, clearly
  named and never the default — mirrors `test_requirements.py` exactly.
- **Node API (Vitest + Supertest)**: 401/404/400 on every endpoint; `NO_ACTIVE_REQUIREMENTS`
  when the requirements list is genuinely empty; successful generate against a mocked
  ai-service response, including the new outbound camelCase→snake_case mapping; a mocked real
  ai-service 503 correctly becoming `AI_PROVIDER_UNAVAILABLE` with nothing persisted; list/
  get/update/activate/compare mirroring the requirements test file's coverage exactly.
- **tests/ (real HTTP integration)**: extends the pattern — register → create project →
  generate requirements is *not* run (no key), so the dependency path is what's exercised for
  real: calling PRD generate on a project with no requirements returns the real
  `NO_ACTIVE_REQUIREMENTS` 400 through the genuinely running stack.
- **Frontend (Vitest + RTL)**: the three states above (blocked/empty/populated), generate
  loading/error/provider-unavailable, edit+save, activate — mocking `prdApi` the same way
  `requirementsApi` already is.

## Non-goals (explicit, restated)

Architecture generation, epics/stories/tasks, GitHub integration, AST parsing, repository
ingestion, retrieval, codebase Q&A, code review, evaluation pipeline, and any redesign of
existing UI are not touched by this phase.

## Files expected to change

**New:** `api/prisma/migrations/<ts>_add_prd_versions/`, `api/src/schemas/prd.ts`,
`api/src/services/prd.ts`, `api/src/controllers/prd.ts`, `api/src/routes/prd.ts` (+ tests),
`ai-service/app/lib/__init__.py`, `ai-service/app/lib/provider_config.py`,
`ai-service/app/agents/prd/` (`__init__.py`, `provider.py`, `router.py`),
`ai-service/tests/test_prd.py`, `frontend/src/types/prd.ts`, `frontend/src/services/prdApi.ts`,
`frontend/src/components/PrdSection.tsx` (+ test), `tests/prd.test.ts`, this file,
`docs/PRD_PHASE_PROGRESS.md`.

**Modified:** `api/prisma/schema.prisma`, `api/src/app.ts`, `api/src/lib/aiServiceClient.ts`
(new PRD functions + mapping), `ai-service/main.py`, `ai-service/app/schemas.py` (add
`PrdContent`/request/response models), `ai-service/app/errors.py`
(`ProviderNotConfiguredError` takes a `feature` param), `ai-service/app/agents/requirements/provider.py`
(uses the new shared `provider_config` helper), `frontend/src/pages/ProjectOverview.tsx`,
root `README.md`, `docs/REQUIREMENTS_PHASE_PROGRESS.md` (pointer only, not further updated).

`docker-compose.yml` and `.env.example` are **not** expected to change — PRD generation reuses
the exact same `AI_SERVICE_URL` / `ANTHROPIC_API_KEY` wiring Phase 2 already established.

## Milestones

1. Inspect and plan (this document).
2. Prisma schema and migration.
3. AI-service PRD contract/provider.
4. API endpoints (Node).
5. Frontend PRD flow.
6. Tests.
7. Docker verification.
8. Documentation.

Each milestone: implement → run tests/typecheck/lint → verify manually where applicable →
report exact commands and results → commit only when runnable.
