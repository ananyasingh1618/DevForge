# DevForge Phase 4 (Architecture Generation) — Implementation Plan

## Scope

Turn a project's currently **active PRD version** into a structured, versioned technical
architecture, using the same AI-service integration and versioning conventions Phase 3 (PRD
Generation) established on top of Phase 2 (Requirements Analysis). This phase is a direct
structural repeat of Phase 3, one link further down the chain:

```
RequirementsVersion (active) --[Phase 3]--> PrdVersion (active) --[Phase 4]--> ArchitectureVersion
```

Everything Phase 3 built for the Requirements → PRD link is reused **by pattern**, not by
sharing code across domains that don't actually share shape — the same deliberate choice
Phase 3 made relative to Phase 2 (see `docs/PRD_PHASE_PLAN.md`'s "Frontend flow" /
"AI-service PRD contract/provider" sections). What *is* genuinely shared: the
`ANTHROPIC_API_KEY` read + `ProviderNotConfiguredError` raise in
`ai-service/app/lib/provider_config.py`, already written generically enough for a third agent
to call it unmodified — confirmed by reading it, not assumed.

## What Phase 3 already established (reused by pattern here)

- **Database**: a versioned artifact model — `id`, `projectId` FK (`onDelete: Cascade`), a
  `sourceXVersionId` FK to the upstream artifact (`onDelete: Restrict`, Prisma's default for
  an unspecified `onDelete` — confirmed empirically in Phase 3, not just read from docs),
  `version: Int`, `content: Json`, `isActive: Boolean @default(false)`, timestamps, unique on
  `(projectId, version)`, indexes on `projectId` and the source FK. `PrdVersion` in
  `api/prisma/schema.prisma` is the template.
- **Node service layer** (`api/src/services/prd.ts`): a private `requireOwnedProject` guard: 404
  for a project that's missing or not owned by the caller, no distinction leaked between the
  two; a `generateXFromActiveY` function that (1) confirms project ownership, (2) looks up the
  active upstream version — "no active Y" is exactly "call `AppError(400, "NO_ACTIVE_Y", ...)`
  " before ever touching the AI service, (3) calls the AI service (nothing persisted if this
  throws), (4) creates the new version inside a `prisma.$transaction` that deactivates every
  other version for the project and activates the new one; `listVersions`/`getVersion`/
  `updateVersion`/`activateVersion` (the last also transactional); a `diffXContent` function
  producing per-field `{added, removed}` for array fields and a `xChanged` boolean for prose
  fields, plus `compareVersions`.
- **Node controller/routes** (`api/src/controllers/prd.ts`, `api/src/routes/prd.ts`): one
  handler per service function, `parseWithSchema` for params/query/body, `requireAuth` applied
  to the whole route group via `router.use(path, requireAuth)`, `/compare` registered **before**
  `/:versionId` (Express would otherwise match "compare" as a version id).
- **Node ↔ ai-service boundary** (`api/src/lib/aiServiceClient.ts`): a shared
  `postToAiService(path, body)` helper — network failure → `502 AI_SERVICE_UNREACHABLE`; a real
  `503 PROVIDER_NOT_CONFIGURED` from ai-service → `503 AI_PROVIDER_UNAVAILABLE` (message passed
  through verbatim); any other non-2xx → `502 AI_SERVICE_ERROR`; a 2xx body that doesn't parse
  against the Zod content schema → `502 AI_RESPONSE_INVALID`. Explicit
  camelCase↔snake_case mapping functions in both directions (Node is camelCase throughout;
  ai-service is Python/Pydantic, snake_case natively).
- **ai-service** (`app/agents/prd/{provider,router}.py`, `app/schemas.py`): one `XProvider` ABC
  + one `AnthropicXProvider` implementation per feature (not a shared generic ABC — the
  input/output shapes genuinely differ between features), the same typed-exception chain
  (`BadRequestError → AuthenticationError → PermissionDeniedError → NotFoundError →
  RateLimitError → APIStatusError → APIConnectionError`, each mapped to `ProviderRequestError`),
  `get_provider()` calling `get_anthropic_api_key(feature)` at call time (not import time, so
  `/health` still works with no key), a `GenerateXRequest`/`GenerateXResponse` Pydantic pair
  registered as a router `include_router`ed into `main.py`.
- **Frontend** (`frontend/src/components/PrdSection.tsx`,
  `frontend/src/services/prdApi.ts`, `frontend/src/types/prd.ts`): fetches the upstream list
  and its own list independently on mount (no cross-component coupling); derives exactly three
  states — **blocked** (no active upstream version — a dependency message only, *no Generate
  control rendered at all*, never an enabled button that would fail on click), **empty**
  (upstream active, own list empty — a single "Generate X from Y v{N}" button, loading state,
  provider-unavailable/error state with the real server message), **populated** (version list
  with an active badge, a `VersionDetail` sub-component keyed by `version.id` so switching
  versions remounts instead of using an effect+setState — avoids the
  `eslint-plugin-react-hooks` synchronous-setState-in-effect warning hit twice already in this
  repo — per-field editing, "Save changes" (PATCH), "Make active" for non-active versions,
  "Regenerate from v{N}").
- **Tests**: `api/src/routes/prd.test.ts` (Supertest, `vi.stubGlobal("fetch", ...)` mocks only
  the outbound ai-service HTTP call — 401/404/400 `NO_ACTIVE_Y` before any fetch, successful
  generate, real `PROVIDER_NOT_CONFIGURED` → `503 AI_PROVIDER_UNAVAILABLE` with nothing
  persisted, `502` on network failure, list/get/update/activate/compare), `ai-service/tests/
  test_prd.py` (pytest, `FakeXProvider` injected via `monkeypatch.setattr` on the module — never
  via FastAPI `Depends()`, which resolves before body validation, a real bug Phase 2 found and
  documented), `frontend/src/components/PrdSection.test.tsx` (Vitest + RTL, mocks both the
  upstream and own API modules, covers all three states plus edit/activate), `tests/prd.test.ts`
  (real HTTP against the genuinely running stack — since no `ANTHROPIC_API_KEY` exists in this
  environment, the real path exercised is the `NO_ACTIVE_Y` dependency guard, not a successful
  generation).
- **Docker**: no `docker-compose.yml`/`Dockerfile` changes were needed for Phase 3 — PRD reused
  the `AI_SERVICE_URL`/`ANTHROPIC_API_KEY` wiring Phase 2 added, and `api/Dockerfile`'s
  `prisma migrate deploy` on container start picks up new migrations automatically. The same is
  expected to hold for Phase 4; confirmed, not assumed, in Milestone 7 below.

## The active-PRD dependency

Identical reasoning to Phase 3's active-requirements dependency: `generatePrdFromActiveRequirements`
and `activateVersion` together guarantee at most one active `PrdVersion` per project exists
whenever any exist, and there is no PRD-deletion endpoint. So "no active PRD" is exactly "the
project's PRD version list is empty" — one condition, checked once, both server-side (before any
AI call) and client-side (to decide whether to render a Generate control at all).

## Database change (Milestone 2)

New model, following `PrdVersion`'s exact shape:

```prisma
model ArchitectureVersion {
  id                String   @id @default(uuid())
  projectId         String   @map("project_id")
  version           Int
  sourcePrdVersionId String  @map("source_prd_version_id")
  content           Json
  isActive          Boolean  @default(false) @map("is_active")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  project        Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sourcePrdVersion PrdVersion @relation(fields: [sourcePrdVersionId], references: [id])

  @@unique([projectId, version])
  @@index([projectId])
  @@index([sourcePrdVersionId])
  @@map("architecture_versions")
}
```

`Project` gains `architectureVersions ArchitectureVersion[]`; `PrdVersion` gains
`architectureVersions ArchitectureVersion[]`. Same cascade/restrict split as
`PrdVersion → RequirementsVersion`: deleting a project cascades; deleting a PRD version that a
generated architecture still traces back to is blocked (there is no PRD-deletion endpoint today,
so this is a data-integrity guarantee, not a reachable user-facing error — same status Phase 3's
equivalent constraint has). One Prisma migration, applied via `prisma migrate dev` locally and
`prisma migrate deploy` in Docker, exactly like Phase 3's `add_prd_versions` migration.

## Architecture content schema (Milestone 3)

Mirrors `PrdContent`'s shape: two prose fields (paralleling `overview`/`problemStatement`) plus
every other section as a flat `list[str]`/`string[]` — the same "list of prose bullet points per
section" pattern PRD used, not a deeply nested structure. This keeps the schema honest about what
an LLM can reliably produce as structured output, keeps the Zod/Pydantic pair trivial to keep in
sync, and keeps the frontend's editing UI a direct reuse of the one-per-line-textarea pattern
`PrdSection`'s `VersionDetail` already has — no new editing UI concept needed.

| Field (TS camelCase / Python snake_case) | Shape | Content |
|---|---|---|
| `overview` / `overview` | `string` | 2-4 sentence framing of the proposed architecture |
| `systemArchitecture` / `system_architecture` | `string` | The overall architectural pattern/style and how the major pieces fit together, in prose |
| `technologyStack` / `technology_stack` | `string[]` | Technology choices with brief rationale each |
| `components` / `components` | `string[]` | Major components/services and their responsibilities |
| `dataModel` / `data_model` | `string[]` | Key entities and their relationships |
| `apiDesign` / `api_design` | `string[]` | Key API contracts/patterns |
| `dataFlows` / `data_flows` | `string[]` | How data moves through the system for key scenarios |
| `security` / `security` | `string[]` | Security measures and considerations |
| `scalability` / `scalability` | `string[]` | Scalability considerations |
| `deployment` / `deployment` | `string[]` | Deployment/infrastructure approach |
| `tradeoffs` / `tradeoffs` | `string[]` | Key architectural tradeoffs and why they were made |
| `assumptions` / `assumptions` | `string[]` | Assumptions the architecture relies on |
| `openQuestions` / `open_questions` | `string[]` | Unresolved architectural questions |

13 fields (2 prose + 11 lists) vs. `PrdContent`'s 12 (2 prose + 10 lists) — the one extra list
(`tradeoffs`) is the only field with no PRD-schema analogue, matching the prompt's explicit
section list.

`GenerateArchitectureRequest.prd: PrdContent` (reuses `PrdContent` as-is, exactly how
`GeneratePrdRequest.requirements: RequirementsContent` reused `RequirementsContent` — the input
to this generation step is exactly the shape the upstream step already produces).
`GenerateArchitectureResponse.content: ArchitectureContent`.

`AnthropicArchitectureProvider` follows `AnthropicPrdProvider` exactly: same model
(`claude-opus-5`), same `messages.parse(output_format=ArchitectureContent)` call, same
typed-exception chain, same `get_provider()` shape calling
`get_anthropic_api_key("architecture generation")`. System prompt instructs synthesis (not
verbatim restatement of the PRD) and explicit "do not invent technology choices unsupported by
the given PRD's constraints/assumptions" guidance, mirroring the PRD provider's "do not invent
business/domain details" rule.

## API design (Milestone 4)

Same route-group shape as `prd.ts`, `/prd` → `/architecture`, `requirements` → `prd` as the
upstream artifact:

| Method | Path | Purpose |
|---|---|---|
| POST | `/projects/:projectId/architecture/generate` | Generate a new active version from the active PRD (400 `NO_ACTIVE_PRD` if none) |
| GET | `/projects/:projectId/architecture` | List versions, newest first |
| GET | `/projects/:projectId/architecture/compare?a=&b=` | Structural diff (registered before `:versionId`) |
| GET | `/projects/:projectId/architecture/:versionId` | Get one version |
| PATCH | `/projects/:projectId/architecture/:versionId` | Update content in place |
| POST | `/projects/:projectId/architecture/:versionId/activate` | Make a version active |

`requireAuth` on the whole group; ownership via `requireOwnedProject` (404, no leak between
missing/foreign); Zod schemas mirroring `schemas/prd.ts` (`architectureContentSchema`,
`projectIdParamSchema`, `versionParamSchema`, `compareQuerySchema`, the last with the same
`a !== b` refinement). `aiServiceClient.ts` gains `generateArchitectureViaAiService`,
`mapPrdContentToSnakeCase` (new outbound direction — PRD content flowing *out* to ai-service, the
same way `mapRequirementsContentToSnakeCase` was added in Phase 3), and
`mapAiArchitectureContentToCamelCase` (new inbound direction), reusing the existing
`postToAiService` helper — no changes to its error-mapping logic needed.

## Frontend (Milestone 5)

`ArchitectureSection`, structurally identical to `PrdSection`: fetches the PRD list and its own
architecture list independently on mount; three states (blocked/empty/populated) keyed off
"does an active PRD version exist"; populated state edits all 13 content fields with the same
textarea-per-field pattern (2 larger textareas for the prose fields, one-per-line textareas for
every list field); rendered in `ProjectOverview.tsx` below `PrdSection`, "Architecture" removed
from the "Not yet implemented" grid. No new design system, no new component primitives —
`Button`, `Card`, `EmptyState`/`ErrorState`/`LoadingState` are reused exactly as `PrdSection`
uses them.

## Testing strategy (Milestone 6)

Same four-suite split as Phase 3, one-for-one:

- `ai-service/tests/test_architecture.py` — mirrors `test_prd.py`: health; 400 missing/wrong-typed
  body; a minimal-valid-body case (confirms which field, if any, is actually required before
  assuming); real 503 `PROVIDER_NOT_CONFIGURED` (this environment has no key); `FakeArchitectureProvider`
  success/`AIResponseInvalidError`/`ProviderRequestError` cases via `monkeypatch.setattr` on the
  module (not `Depends()`).
- `api/src/routes/architecture.test.ts` — mirrors `prd.test.ts`: 401/404; 400 `NO_ACTIVE_PRD`
  without calling `fetch` at all (asserted via mock call count); successful generate from a mocked
  ai-service response with `sourcePrdVersionId` asserted; real `PROVIDER_NOT_CONFIGURED` → 503
  `AI_PROVIDER_UNAVAILABLE` with nothing persisted; 502 on network failure; list/get/update/
  activate/compare. Upstream PRD state is seeded through the real `/prd/generate` endpoint (itself
  behind a mocked `fetch`) which itself needs an active requirements version seeded through the
  real `/requirements/analyze` endpoint — a real three-link chain, not a direct Prisma insert,
  the same principle `prd.test.ts`'s `createProjectWithActiveRequirements` helper already
  established one link up.
- `frontend/src/components/ArchitectureSection.test.tsx` — mirrors `PrdSection.test.tsx`: blocked/
  empty/populated states, generation failure surfacing the real error without fabricating success
  content, version switching/activation, edit+save with server-error handling.
- `tests/architecture.test.ts` — mirrors `tests/prd.test.ts`: real HTTP against the genuinely
  running stack; since no `ANTHROPIC_API_KEY` exists, the project used has no PRD versions for
  real, so this proves the real `NO_ACTIVE_PRD` dependency path end-to-end, plus a direct check
  that ai-service's own `/architecture/generate` still honestly reports
  `PROVIDER_NOT_CONFIGURED`.

Existing 109 tests (60 api + 30 frontend + 4 `tests/` + 15 ai-service) must remain green
throughout — re-run after every milestone, not just at the end.

## Docker verification strategy (Milestone 7)

Identical procedure to Phase 3 Milestone 7: `docker compose down -v` (wipe the volume) →
`docker compose build` → `docker compose up -d` → confirm all four containers healthy → `psql
\dt` confirms `architecture_versions` applied automatically → register/create-project/generate
through the **containerized** API, confirming the real `NO_ACTIVE_PRD` and (after seeding an
active PRD directly via Prisma against the Docker-mapped port) the real
`AI_PROVIDER_UNAVAILABLE` reaching the **containerized** ai-service over the Docker-internal
hostname → a throwaway Playwright script against the Dockerized frontend (port 4173) confirming
the blocked state renders → `tests/` suite run against the Dockerized stack → teardown, restore
local dev Postgres + `devforge_test`. No compose/Dockerfile change is expected to be needed;
confirmed rather than assumed.

## Explicit non-goals (per the user's instructions)

Epics/user stories/tasks, GitHub integration, AST parsing, repository ingestion, retrieval,
codebase Q&A, code review, evaluation pipeline, additional LLM providers, and any refactor not
required to add architecture generation. No later-phase feature will be implemented,
scaffolded, or stubbed with fake behavior.

## Files expected to change

- `api/prisma/schema.prisma`, one new migration under `api/prisma/migrations/`.
- `ai-service/app/schemas.py` (append `ArchitectureContent`/`GenerateArchitectureRequest`/
  `GenerateArchitectureResponse`), new `ai-service/app/agents/architecture/{__init__,provider,
  router}.py`, `ai-service/main.py` (wire the new router), new
  `ai-service/tests/test_architecture.py`.
- New `api/src/schemas/architecture.ts`, `api/src/services/architecture.ts`,
  `api/src/controllers/architecture.ts`, `api/src/routes/architecture.ts`; `api/src/app.ts`
  (wire the new router); `api/src/lib/aiServiceClient.ts` (extend); new
  `api/src/routes/architecture.test.ts`.
- New `frontend/src/types/architecture.ts`, `frontend/src/services/architectureApi.ts`,
  `frontend/src/components/ArchitectureSection.tsx`,
  `frontend/src/components/ArchitectureSection.test.tsx`;
  `frontend/src/pages/ProjectOverview.tsx` (+ its existing test file) wired in.
- New `tests/architecture.test.ts`.
- `README.md`, `ai-service/README.md` updated; this plan file and a new
  `docs/ARCHITECTURE_PHASE_PROGRESS.md` (mirroring `PRD_PHASE_PROGRESS.md`'s per-milestone log
  format) track the work; `docs/PRD_PHASE_PROGRESS.md` gets a pointer comment added, mirroring
  the pointer Phase 3 added to `docs/REQUIREMENTS_PHASE_PROGRESS.md`.
- No changes expected to `docker-compose.yml`, any `Dockerfile`, or any file outside the above.

## Milestones

1. Inspect and plan (this document).
2. Prisma schema and migration.
3. ai-service architecture contract/provider.
4. API endpoints (Node).
5. Frontend architecture flow.
6. Tests.
7. Docker verification.
8. Documentation.

Same per-milestone discipline as Phase 3: run relevant tests, typecheck, and lint after each
milestone; report exact commands and results; commit only runnable milestones.
