# DevForge Phase 2: Requirements Analysis — Implementation Plan

Builds directly on the Foundation phase (`docs/FOUNDATION_PROGRESS.md`): auth, project
ownership, the Node/Express + Prisma + PostgreSQL API, the React frontend, the inert
Python/FastAPI `ai-service`, and the Docker Compose stack are all already working and are
**preserved, not redesigned**. This phase adds exactly one capability on top of them:
turning a free-text project idea into a structured, versioned requirements document.

## Scope

In scope (per the DevForge spec's Requirements agent, spec doc §9 / blueprint §13.2):

- A `RequirementsVersion` record per analysis, scoped to a project, storing structured JSON
  (not a text blob), with an explicit distinction between what the user stated and what the
  AI inferred.
- Analyze (create a new version from an idea), list versions, get one version, update a
  version's content, mark a version active, and compare two versions.
- A single LLM provider (Anthropic Claude, `claude-opus-5`) behind a provider abstraction in
  `ai-service`, with structured-output validation and a truthful "not configured" error path
  — never a fabricated result.
- A Requirements section on the existing project overview page.

Explicitly out of scope (per the user's instructions and the spec's own phase ordering) —
**not implemented in this phase**:

- PRD generation/versioning, architecture generation, epics/tasks, GitHub integration, AST
  parsing, hybrid retrieval, codebase Q&A, or AI code review.
- Any redesign of auth, sessions, project CRUD, or the existing design system beyond adding
  the Requirements section.
- A multi-provider runtime switcher — the abstraction exists in code so a second provider
  could be added later, but only Anthropic is implemented now.
- Claiming a real end-to-end LLM call succeeded: this environment has no `ANTHROPIC_API_KEY`
  configured (confirmed by checking the shell — see the AI-service section below), so no test
  in this phase claims a real provider call passed. The "provider not configured" path is
  tested for real, since that is genuinely this environment's current state.

## Decision: LLM provider (documented, not previously configured)

No LLM provider was configured anywhere in the Foundation-phase code. This phase adds
**Anthropic's Claude API** (`@anthropic-ai/sdk`-equivalent for Python: the `anthropic` PyPI
package), model `claude-opus-5`, using `client.messages.parse()` with a Pydantic
`output_format` for structured-output validation. Rationale: it's a first-party, officially
documented SDK with strict structured-output support that maps directly onto the
already-Pydantic-shaped FastAPI service, and no other provider was already wired into any
part of this repository to prefer instead. Configured via `ANTHROPIC_API_KEY` in
`ai-service`'s own environment — never logged, never returned in any API response, never
committed. If unset, every analyze request fails with a clear, typed
`PROVIDER_NOT_CONFIGURED` error rather than a fake result.

## Data model

New Prisma model, additive only — `users`, `sessions`, `projects` are untouched:

```prisma
model RequirementsVersion {
  id        String   @id @default(uuid())
  projectId String   @map("project_id")
  version   Int
  ideaText  String   @map("idea_text")
  content   Json
  isActive  Boolean  @default(false) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, version])
  @@index([projectId])
  @@map("requirements_versions")
}
```

`Project` gains `requirementsVersions RequirementsVersion[]`. Cascade delete: removing a
project removes its requirements versions (matches the existing sessions/projects cascade
pattern). Ownership is always reached through `projectId` → `Project.ownerId`, never stored
redundantly on the child row.

`content` JSON shape (validated by Zod on the Node side and the mirrored Pydantic model on
the ai-service side before it's ever persisted — the column is `Json`, but nothing
unvalidated reaches it):

```ts
type RequirementItem = {
  id: string; // "FR-1", "NFR-1", stable within a version
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  source: "stated" | "inferred"; // explicit user-stated vs AI-inferred — the spec's core
  acceptanceCriteria: string[]; // requirements-agent differentiator
};

type RequirementsContent = {
  projectSummary: string;
  users: string[];
  functionalRequirements: RequirementItem[];
  nonFunctionalRequirements: RequirementItem[];
  constraints: string[];
  assumptions: string[];
  openQuestions: string[];
};
```

`ideaText` (the raw free-text input) is stored as a plain string deliberately — it's
provenance for *why* a version exists, not the requirements themselves, so it isn't the
"unstructured blob" the instructions warn against storing as the requirements data.

No secrets or raw provider responses are ever persisted — only the final, schema-validated
`content` on success. A failed analysis persists nothing.

## API contracts

All new routes require an authenticated session and are scoped through project ownership —
a project that doesn't exist or belongs to someone else is a 404 on every one of them, same
as the existing `/projects/:id` behavior. Base path: `/projects/:projectId/requirements`.

| Method | Path | Body / query | Success | Notes |
|---|---|---|---|---|
| POST | `/projects/:projectId/requirements/analyze` | `{ idea: string }` (10–5000 chars) | 201 `{ data: { version } }` | Calls ai-service; creates a new version, auto-activated; 503 `AI_PROVIDER_UNAVAILABLE` if ai-service reports no provider configured; 502 `AI_SERVICE_UNREACHABLE` on network failure |
| GET | `/projects/:projectId/requirements` | — | 200 `{ data: { versions: [...] } }` | Newest version first |
| GET | `/projects/:projectId/requirements/:versionId` | — | 200 `{ data: { version } }` | 404 if missing or belongs to a different project |
| PATCH | `/projects/:projectId/requirements/:versionId` | full `RequirementsContent` | 200 `{ data: { version } }` | In-place edit, does not create a new version |
| POST | `/projects/:projectId/requirements/:versionId/activate` | — | 200 `{ data: { version } }` | Atomically unsets the previous active version |
| GET | `/projects/:projectId/requirements/compare?a=:idA&b=:idB` | — | 200 `{ data: { a, b, diff } }` | 400 if `a === b`; 404 if either id is missing/foreign |

Compare is a **deliberately simple structural diff** (added/removed/changed), not a semantic
one — matched by `id` for requirement items, by set difference for the plain string arrays
(`users`, `constraints`, `assumptions`, `openQuestions`). This is "if the data model supports
it cleanly," per the instructions, not a new diffing subsystem.

Every request body and route param is validated with Zod, reusing the existing
`parseWithSchema` helper and `AppError` envelope — no new error-handling pattern.

## AI-service flow

New FastAPI router (mounted alongside the existing bare `/health`, which is untouched):

- `POST /requirements/analyze` — body `{ idea: str }` (Pydantic-validated: 10–5000 chars).
- Provider abstraction: an abstract `RequirementsProvider.analyze(idea: str) ->
  RequirementsContent`, with one concrete `AnthropicRequirementsProvider` implementation.
  `get_provider()` reads `ANTHROPIC_API_KEY` at request time; if unset, raises
  `ProviderNotConfiguredError`, mapped to HTTP 503 with `{"error": {"code":
  "PROVIDER_NOT_CONFIGURED", "message": "..."}}` — the same envelope shape as the Node API,
  for consistency across the two services.
- `client.messages.parse(model="claude-opus-5", output_format=RequirementsContent, ...)`
  (Pydantic structured output — see `shared/tool-use-concepts.md` / the `claude-api` skill).
  If `response.parsed_output` is `None` (parsing failed) or the SDK raises, the endpoint
  returns a `502 AI_RESPONSE_INVALID` / the appropriate typed-exception-mapped error — it
  never fabricates a fallback result.
- Custom `RequestValidationError` handler normalizes FastAPI's default 422 shape into the
  same `{"error": {...}}` envelope, so every ai-service error looks the same regardless of
  cause.

## Validation strategy

- **Node API**: Zod schemas for the analyze body, the `versionId`/`projectId` route params
  (uuid), the full-content PATCH body (every field of `RequirementsContent` validated, not
  just presence), and the compare query params (two uuids, must differ) — all via the
  existing `parseWithSchema` → `AppError.badRequest` path.
- **Node env**: `AI_SERVICE_URL` added to `api/src/env.ts`'s Zod schema (required, matching
  how `DATABASE_URL`/`SESSION_SECRET` are already handled).
- **ai-service**: Pydantic models double as both the FastAPI request/response schema and the
  Anthropic structured-output schema — one source of truth, not two parallel definitions.
- **ai-service env**: `ANTHROPIC_API_KEY` is read lazily inside `get_provider()`, not at
  import time, so the service still starts and serves `/health` with no key configured (an
  inert-but-running service, not a crash-on-boot one).

## Frontend flow

A `RequirementsSection` component embedded in the existing `ProjectOverview` page — removed
from the `upcomingCapabilities` "Not yet implemented" grid there, since it's now real. No
other part of that page or any other page changes.

States (matching the existing `LoadingState`/`EmptyState`/`ErrorState` components, not new
ones):

- **Empty** (no versions yet): a textarea for the idea + an "Analyze" button.
- **Loading**: spinner, button disabled, while the analyze request is in flight (this can
  take tens of seconds for a real LLM call — the UI says so).
- **Error**: the server's actual message (e.g. "AI provider is not configured. Set
  ANTHROPIC_API_KEY in the ai-service environment.") with a retry button — never a silent
  failure or a fake success.
- **Success**: the active version's structured content (summary, users, functional/
  non-functional requirements with priority + source badges, constraints, assumptions, open
  questions), editable per-field with a Save button (PATCH), a version list with an active
  badge and a "Make active" action per non-active version.

## Test plan

- **ai-service (pytest)**: `PROVIDER_NOT_CONFIGURED` is tested for real (no key is set in
  this environment); the success path and validation-error path use a `FakeRequirementsProvider`
  injected via FastAPI `dependency_overrides` — clearly named and never the default.
- **Node API (Vitest + Supertest)**: 401 unauthenticated, 404 cross-owner, 400 validation, for
  every endpoint; successful analyze/list/get/update/activate/compare against a mocked
  ai-service HTTP call (the mock boundary is the outbound `fetch`, clearly a test double, not
  a claim that an LLM ran); a real, unmocked check that the Node API correctly surfaces a real
  ai-service 503 when ai-service itself has no key configured (both processes genuinely
  running, nothing mocked at that layer).
- **tests/ (real HTTP integration)**: extends the existing pattern — register → create
  project → POST `.../requirements/analyze` against the actually-running stack. Since this
  environment has no `ANTHROPIC_API_KEY`, the asserted outcome is the real 503
  `AI_PROVIDER_UNAVAILABLE`, not a fabricated success — this is itself a meaningful proof that
  "no fake AI responses" holds even through the full real stack.
- **Frontend (Vitest + RTL)**: empty/loading/error(+retry)/success states, editing a field and
  saving, activating a version — `requirementsApi` module mocked the same way `authApi` /
  `projectsApi` already are in existing tests.

## Non-goals (explicit)

PRD, architecture, tasks, GitHub integration, AST parsing, retrieval, codebase Q&A, code
review — none of these are touched. No changes to authentication, session handling, or
project CRUD beyond adding the new sub-resource. No new frontend design-system components
beyond what `RequirementsSection` needs (reuses `Button`/`Input`/`Card`/state-view
components). No claim of a passing real-LLM test without a configured provider.

## Files expected to change

**New:**
`api/prisma/migrations/<ts>_add_requirements_versions/`, `api/src/schemas/requirements.ts`,
`api/src/services/requirements.ts`, `api/src/controllers/requirements.ts`,
`api/src/routes/requirements.ts` (+ test files), `api/src/lib/aiServiceClient.ts`,
`ai-service/app/schemas.py`, `ai-service/app/agents/requirements/` (provider + router),
`ai-service/app/errors.py`, `ai-service/tests/` (+ `conftest.py`),
`frontend/src/types/requirements.ts`, `frontend/src/services/requirementsApi.ts`,
`frontend/src/components/RequirementsSection.tsx` (+ test), `tests/requirements.test.ts`,
this file, `docs/REQUIREMENTS_PHASE_PROGRESS.md`.

**Modified:**
`api/prisma/schema.prisma`, `api/src/env.ts`, `api/src/app.ts`, `ai-service/main.py`,
`ai-service/requirements.txt` (add `pydantic` pin, `pytest`, `httpx` for `TestClient`),
`frontend/src/pages/ProjectOverview.tsx`, `docker-compose.yml` (api gets `AI_SERVICE_URL`;
ai-service optionally gets `ANTHROPIC_API_KEY` passed through), `.env.example`, root
`README.md`.

## Milestones

1. Inspect and plan (this document).
2. Data model and migration.
3. AI-service contract and provider abstraction.
4. API endpoints (Node).
5. Frontend requirements flow.
6. Tests.
7. Docker and documentation.

Each milestone: implement → run tests/typecheck/lint → verify manually where applicable →
report exact commands and results → commit only when runnable.
