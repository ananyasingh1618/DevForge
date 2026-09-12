# DevForge Phase 5 (Epics & Tasks Generation) — Implementation Plan

## Scope

Extend the artifact chain one (two) more links: a project's active **architecture** version
becomes a versioned set of **epics**, and a project's active **epics** version becomes a
versioned set of **tasks**:

```
RequirementsVersion (active) → PrdVersion (active) → ArchitectureVersion (active)
  → EpicVersion (active) → TaskVersion (active)
```

Every mechanical pattern Phase 4 established for Architecture (itself inherited from Phase 3's
PRD, inherited from Phase 2's Requirements) is reused **by pattern**, not by sharing code
across domains that don't actually share shape — the same deliberate, repeated choice every
prior phase's plan documented. What's genuinely shared: the `ANTHROPIC_API_KEY` read +
`ProviderNotConfiguredError` raise in `ai-service/app/lib/provider_config.py`, already generic
enough to call unmodified for two more agents.

## The central design decision: two separate versioned artifacts, not one hierarchical artifact

The prompt asks this to be decided explicitly, so the reasoning is recorded here rather than
just the conclusion.

**Decision: `EpicVersion` and `TaskVersion` are two independent versioned artifacts**, each
following the exact `PrdVersion`/`ArchitectureVersion` shape (own version numbering, own
`isActive` invariant, own `sourceXVersionId` pointing at exactly the upstream artifact used to
generate it) — not a single "work plan" artifact that embeds tasks inside epics inside one row.

Reasoning:

1. **Every required capability is listed once per entity, not once for a combined concept.**
   The objective lists "Generate epics... Generate tasks..." as two separate actions, and
   Milestone 4's endpoint list repeats the full CRUD+activate+compare set once for epics and
   once for tasks — six operations, twice. A single hierarchical artifact would only support
   one "list versions" / "activate a version" per project, not one per entity, contradicting
   the spec's own shape.
2. **Tasks are generated *from* epics as a distinct second AI call**, exactly the way PRD is
   generated from requirements and architecture from PRD. That's a new link in the existing
   source-tracking chain (`sourceEpicVersionId → EpicVersion`, mirroring
   `sourcePrdVersionId → PrdVersion`), not a nested substructure of one artifact.
3. **Independent regeneration/editing/activation.** A hierarchical artifact would force
   editing or activating epics to also touch whatever tasks happen to be nested under them
   (or vice versa) — every prior phase's `updateVersion`/`activateVersion` operates on exactly
   one artifact's content, and there's no precedent in this codebase for a write to one
   resource silently affecting another's version history.
4. **Existing convention.** Three phases in a row (Requirements, PRD, Architecture) used one
   table per generation step, JSON `content`, a `sourceXVersionId` FK to the upstream artifact,
   and `isActive` with a transactional single-active-version invariant. Introducing a
   different shape for Epics/Tasks — the first time two *sibling* generation steps exist in
   the same phase — would be the inconsistent choice, not the consistent one.

## What's reused by pattern from Phase 4 (Architecture)

- **Database**: one table per artifact, `id`/`projectId` (FK `onDelete: Cascade`)/`version:
  Int`/`sourceXVersionId` (FK `onDelete: Restrict`, Prisma's default)/`content: Json`/
  `isActive: Boolean @default(false)`/timestamps, unique on `(projectId, version)`, indexes on
  `projectId` and the source FK.
- **Node service layer**: `requireOwnedProject` guard (404, no leak); `generateXFromActiveY`
  that (1) confirms ownership, (2) looks up the active upstream version — missing means a
  `400` *before* the AI service is ever called, (3) calls the AI service (nothing persisted on
  throw), (4) creates the new version inside a `prisma.$transaction` that deactivates every
  other version and activates the new one; `listVersions`/`getVersion`/`updateVersion`/
  `activateVersion`; a diff function; `compareVersions`.
- **Node controller/routes**: one handler per service function, `parseWithSchema`,
  `requireAuth` on the whole route group, `/compare` registered before `/:versionId`.
- **Node ↔ ai-service boundary**: extends the existing `postToAiService` helper in
  `aiServiceClient.ts` — no changes to its error-mapping logic. New outbound
  (camelCase→snake_case) and inbound (snake_case→camelCase) mapping function pairs.
- **ai-service**: one `XProvider` ABC + one `AnthropicXProvider` per agent (not shared —
  input/output shapes genuinely differ between epics and tasks, same reasoning Phase 3/4 used
  for PRD vs. architecture), the same typed-exception chain, `get_provider()` calling
  `get_anthropic_api_key(feature)` at call time, a `GenerateXRequest`/`GenerateXResponse`
  Pydantic pair, `include_router`ed into `main.py`.
- **Frontend**: fetches the upstream list and its own list independently on mount; three
  states (blocked/empty/populated) keyed off "does an active upstream version exist"; a
  `VersionDetail` sub-component keyed by `version.id` (remount instead of effect+setState, the
  same `eslint-plugin-react-hooks` workaround used three times already).
- **Tests**: the same four-suite split (ai-service pytest, Node Supertest with a mocked
  `fetch`, frontend RTL, real-HTTP integration) each phase has used.
- **Docker**: no compose/Dockerfile changes are expected — confirmed, not assumed, in
  Milestone 7.

## What's genuinely new (not just "one more of the same")

Requirements/PRD/Architecture content is each **one document** — a handful of prose fields
plus flat string-list sections. Epics and Tasks are each **a list of discrete, id-bearing
items** — structurally identical to `RequirementItem[]` inside `RequirementsContent`
(`functionalRequirements`/`nonFunctionalRequirements`), not to `PrdContent`/
`ArchitectureContent`'s flat-sections shape. This precedent already exists in this codebase
and is followed here rather than inventing a new shape:

```ts
// requirementItemSchema, for comparison — the shape this phase's items mirror:
{ id, title, description, priority: "high"|"medium"|"low", source: "stated"|"inferred",
  acceptanceCriteria: string[] }
```

Two consequences that follow directly from reusing this precedent instead of PRD/Architecture's:

- **Diffing** reuses `diffRequirementItems`'s exact logic (added/removed matched by `id`,
  reported as `{id, title}`; `changed` is a list of ids whose `JSON.stringify` differs) instead
  of the flat-field `diffStringArray`-per-section approach PRD/Architecture use. `EpicDiff`/
  `TaskDiff` are each a single `{ items: { added, removed, changed } }`-shaped diff, not a
  diff-per-section.
- **Frontend editing** cannot reuse `PrdSection`/`ArchitectureSection`'s
  one-textarea-per-flat-field pattern, because there are no flat fields — the entire content
  is the item list. It also does not follow `RequirementsSection`'s choice to leave
  `functionalRequirements`/`nonFunctionalRequirements` **read-only** in the UI (documented as
  a deliberate frontend-scope limitation in the README) — Milestone 5 of this phase
  (unprompted this time — "Edit epics and tasks" is an explicit, numbered required capability)
  requires real per-item editing. So `EpicSection`/`TaskSection` render one editable card per
  item (every field editable, no add/remove-item control — see "Explicit limitations" below)
  instead of the read-only `RequirementItemCard` pattern.

## Database (Milestone 2)

```prisma
model EpicVersion {
  id                          String   @id @default(uuid())
  projectId                   String   @map("project_id")
  version                     Int
  sourceArchitectureVersionId String   @map("source_architecture_version_id")
  content                     Json
  isActive                    Boolean  @default(false) @map("is_active")
  createdAt                   DateTime @default(now()) @map("created_at")
  updatedAt                   DateTime @updatedAt @map("updated_at")

  project                   Project             @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sourceArchitectureVersion ArchitectureVersion @relation(fields: [sourceArchitectureVersionId], references: [id])
  taskVersions              TaskVersion[]

  @@unique([projectId, version])
  @@index([projectId])
  @@index([sourceArchitectureVersionId])
  @@map("epic_versions")
}

model TaskVersion {
  id                  String   @id @default(uuid())
  projectId           String   @map("project_id")
  version             Int
  sourceEpicVersionId String   @map("source_epic_version_id")
  content             Json
  isActive            Boolean  @default(false) @map("is_active")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  project           Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sourceEpicVersion EpicVersion @relation(fields: [sourceEpicVersionId], references: [id])

  @@unique([projectId, version])
  @@index([projectId])
  @@index([sourceEpicVersionId])
  @@map("task_versions")
}
```

`Project` gains `epicVersions EpicVersion[]` and `taskVersions TaskVersion[]`;
`ArchitectureVersion` gains `epicVersions EpicVersion[]`. Same cascade/restrict split as every
prior link: deleting a project cascades; deleting an architecture or epic version that a
downstream generated version still traces back to is blocked (not user-reachable today — there
is no deletion endpoint anywhere in this codebase — but a real data-integrity guarantee,
verified directly the same way every prior phase verified it). "Parent-child" *within* a
version (which task belongs to which epic) is **not** a foreign key — it's an `epicId` string
field inside each `TaskItem` in `TaskVersion.content`, referencing an `EpicItem.id` inside the
source `EpicVersion.content`. This mirrors how `PrdContent` never has a DB-level reference to
individual `RequirementItem` rows — content is JSON, and cross-item references inside JSON are
carried as plain ids, not FKs. Two Prisma migrations (or one, containing both tables — decided
in Milestone 2 based on whether they cleanly land as a single migration).

## Content schemas (Milestone 3)

Both reuse the `RequirementItem`-list shape, not the PRD/Architecture flat-sections shape.

**`EpicItem`** (TS camelCase / Python snake_case): `id` (stable short id, e.g. `"EP-1"`),
`title`, `description`, `objective`, `businessValue`/`business_value`, `scope`,
`acceptanceCriteria`/`acceptance_criteria: string[]`, `dependencies: string[]` (other epic ids
this depends on, freeform — not FK-validated, the same way `RequirementItem`'s own fields
aren't cross-validated), `relatedComponents`/`related_components: string[]` (names of
architecture components this epic touches, freeform text, not resolved against
`ArchitectureContent.components` — grounding is the AI provider's job via the system prompt,
not a runtime constraint).

**`EpicContent`**: `{ epics: EpicItem[] }`.

**`TaskItem`**: `id` (e.g. `"T-1"`), `title`, `description`, `type: "feature" | "bug" |
"chore"`, `priority: "high" | "medium" | "low"` (reuses `RequirementItem`'s exact priority
enum), `acceptanceCriteria: string[]`, `dependencies: string[]` (other task ids), `epicId`
(the `EpicItem.id` this task belongs to), `relatedComponent` (a single architecture component
name, freeform text), `estimatedComplexity: "small" | "medium" | "large"` (a coarse,
reliably-generatable enum — not story points or hours, which an LLM cannot estimate
meaningfully), `suggestedOrder: number` (an integer sequence position, not an enum — order is
inherently ordinal).

**`TaskContent`**: `{ tasks: TaskItem[] }`.

Enums are used only for `type`, `priority`, and `estimatedComplexity` — each a small, closed,
clearly-validatable set (matching `RequirementItem.priority`/`.source`'s precedent). Nothing
else is enum-constrained, per the instruction not to overcomplicate the schema.

**`GenerateEpicsRequest.architecture: ArchitectureContent`** (reuses `ArchitectureContent` as
-is — the input to epic generation is exactly what architecture generation already produces).
**`GenerateEpicsResponse.content: EpicContent`**.

**`GenerateTasksRequest.epics: EpicContent`** (reuses `EpicContent` as-is).
**`GenerateTasksResponse.content: TaskContent`**.

`AnthropicEpicsProvider`/`AnthropicTasksProvider` follow `AnthropicArchitectureProvider`
exactly: `claude-opus-5`, `messages.parse(output_format=...)`, the same typed-exception chain,
`get_provider()` calling `get_anthropic_api_key("epic generation")` /
`get_anthropic_api_key("task generation")`. System prompts instruct: epics must be grounded in
the given architecture's components (not invented integrations); tasks must reference only
`epicId`s present in the given epics list and stay within each epic's stated scope.

## API design (Milestone 4)

Two route groups, mirroring `prd.ts`/`architecture.ts` exactly:

| Method | Path | Purpose |
|---|---|---|
| POST | `/projects/:projectId/epics/generate` | Generate a new active epic version from the active architecture (400 `NO_ACTIVE_ARCHITECTURE` if none) |
| GET | `/projects/:projectId/epics` | List epic versions, newest first |
| GET | `/projects/:projectId/epics/compare?a=&b=` | Structural diff (registered before `:versionId`) |
| GET | `/projects/:projectId/epics/:versionId` | Get one epic version |
| PATCH | `/projects/:projectId/epics/:versionId` | Update content in place |
| POST | `/projects/:projectId/epics/:versionId/activate` | Make an epic version active |
| POST | `/projects/:projectId/tasks/generate` | Generate a new active task version from the active epic version (400 `NO_ACTIVE_EPICS` if none) |
| GET | `/projects/:projectId/tasks` | List task versions, newest first |
| GET | `/projects/:projectId/tasks/compare?a=&b=` | Structural diff |
| GET | `/projects/:projectId/tasks/:versionId` | Get one task version |
| PATCH | `/projects/:projectId/tasks/:versionId` | Update content in place |
| POST | `/projects/:projectId/tasks/:versionId/activate` | Make a task version active |

`NO_ACTIVE_ARCHITECTURE` is the error code the prompt specifies explicitly for epic
generation. The prompt doesn't name a code for task generation's missing-active-epics case;
`NO_ACTIVE_EPICS` is chosen here as the direct analogue of `NO_ACTIVE_REQUIREMENTS`/
`NO_ACTIVE_PRD`/`NO_ACTIVE_ARCHITECTURE` — same naming convention, documented here explicitly
since it wasn't given verbatim. `requireAuth` on both whole groups; ownership via
`requireOwnedProject` (404, no leak); Zod schemas mirroring `schemas/architecture.ts`'s shape
but with `epicItemSchema`/`taskItemSchema` arrays instead of flat fields.
`aiServiceClient.ts` gains `generateEpicsViaAiService`/`generateTasksViaAiService`,
`mapArchitectureContentToSnakeCase` (new outbound direction) and
`mapAiEpicContentToCamelCase` (new inbound direction) for epics; `mapEpicContentToSnakeCase`
(outbound) and `mapAiTaskContentToCamelCase` (inbound) for tasks — reusing the existing
`postToAiService` helper unchanged.

## Frontend (Milestone 5)

`EpicSection` and `TaskSection`, structurally parallel to `ArchitectureSection`/`PrdSection`:
fetch the upstream list and their own list independently on mount; three states
(blocked/empty/populated) keyed off "does an active upstream version exist" — `EpicSection`
blocks on no active architecture, `TaskSection` blocks on no active epic version, preserving
the full cascade Requirements → PRD → Architecture → Epics → Tasks (each section only ever
shows a Generate control when its own upstream dependency is active; a downstream section can
never race ahead of an upstream one that's still blocked, because its own fetch will show zero
versions in that case too). Populated state renders one editable card per item (not
per-flat-field textareas, since there are no flat fields — see "What's genuinely new" above):
`EpicSection`'s cards edit title/description/objective/businessValue/scope (text/textarea) and
acceptanceCriteria/dependencies/relatedComponents (one-per-line textareas, reusing the existing
`linesToList`/`listToLines` helpers); `TaskSection`'s cards edit title/description (text/
textarea), type/priority/estimatedComplexity (`<select>`s over the fixed enum), epicId/
relatedComponent/suggestedOrder (plain inputs), and acceptanceCriteria/dependencies
(one-per-line textareas). A single "Save changes" button PATCHes the whole content array at
once, matching every prior phase's full-content-replace pattern. No add/remove-item control in
either card list (see "Explicit limitations"). Version list, active badge, "Make active",
"Regenerate from {upstream} v{N}" all reused unchanged from the established pattern. Rendered
in `ProjectOverview.tsx` below `ArchitectureSection`; "Tasks" removed from the "Not yet
implemented" grid (nothing named "Epics" was ever in that grid — the existing entry is called
"Tasks" and covers this whole phase's UI-facing name).

## Testing strategy (Milestone 6)

Same four-suite split as every prior phase, doubled (epics + tasks):

- `ai-service/tests/test_epics.py` / `test_tasks.py` — mirror `test_architecture.py`: health;
  400 missing/wrong-typed body; a minimal-valid-body boundary case (verified by curling before
  assuming, not assumed); real 503 `PROVIDER_NOT_CONFIGURED`; a `FakeXProvider`
  success/`AIResponseInvalidError`/`ProviderRequestError` case via `monkeypatch.setattr`.
- `api/src/routes/epics.test.ts` / `tasks.test.ts` — mirror `architecture.test.ts`: 401/404;
  400 `NO_ACTIVE_ARCHITECTURE`/`NO_ACTIVE_EPICS` without calling `fetch`; successful generate
  with `sourceArchitectureVersionId`/`sourceEpicVersionId` asserted; real
  `PROVIDER_NOT_CONFIGURED` → 503 with nothing persisted; 502 on network failure; list/get/
  update/activate/compare, including the item-list diff shape (`added`/`removed`/`changed` by
  id). The full upstream chain (requirements → PRD → architecture → epics) is seeded through
  the real, mocked-at-the-fetch-boundary endpoints for `tasks.test.ts` — a genuine four-link
  chain, extending `architecture.test.ts`'s `createProjectWithActivePrd` helper one link
  further with a new `createProjectWithActiveArchitecture`/`createProjectWithActiveEpics`
  helper pair.
- `frontend/src/components/EpicSection.test.tsx` / `TaskSection.test.tsx` — mirror
  `ArchitectureSection.test.tsx`: blocked/empty/populated states, generation failure surfacing
  the real error without fabricating success content, version switching/activation, per-item
  field editing + save with server-error handling.
- `tests/epics.test.ts` / `tasks.test.ts` — real HTTP integration; since no
  `ANTHROPIC_API_KEY` exists, the real path exercised is each `NO_ACTIVE_*` dependency guard,
  plus a direct check that ai-service's own endpoints still honestly report
  `PROVIDER_NOT_CONFIGURED`.

Existing 142 tests (77 api + 37 frontend + 5 `tests/` + 23 ai-service) must remain green
throughout — re-run after every milestone.

## Docker verification strategy (Milestone 7)

Identical procedure to Phases 3/4's Milestone 7: volume-wiped rebuild, confirm all migrations
(now six) auto-apply, confirm both new generation calls reach the containerized ai-service
with real `NO_ACTIVE_*` and `AI_PROVIDER_UNAVAILABLE` responses, a throwaway Playwright check
against the Dockerized frontend, the `tests/` suite against the Dockerized stack, teardown and
local-dev restoration. No compose/Dockerfile change expected; confirmed rather than assumed.

## Explicit limitations (documented up front, not discovered after the fact)

- No "add item" or "remove item" control in the Epic/Task card editors — editing changes
  existing items' fields; adding/removing epics or tasks happens by regenerating a new version.
  The API itself accepts any array via PATCH (including a shorter or longer one), so this is a
  frontend scope choice, exactly the shape of the existing, documented
  functional/non-functional-requirements editing limitation from Phase 2.
- `dependencies`, `epicId`, and `relatedComponent`/`relatedComponents` are plain strings, not
  validated against the actual ids/components that exist elsewhere — the AI provider is
  prompted to stay grounded, but nothing at the schema or API layer enforces it. Consistent
  with every prior phase's content validation (structural, not semantic/cross-referential).
- Both new compare endpoints reuse the id-matched item-diff shape (`added`/`removed`/
  `changed`), the same deliberately simple structural diff every prior phase uses — not
  semantic.

## Explicit non-goals (per the user's instructions)

GitHub integration, repository cloning, AST parsing, retrieval, codebase Q&A, code review,
evaluation, additional LLM providers, automatic task execution, automatic code generation, and
any refactor not required to add epics/tasks generation. No later-phase feature will be
implemented, scaffolded, or stubbed with fake behavior.

## Milestones

1. Inspect and plan (this document).
2. Prisma schema and migration(s).
3. ai-service epics/tasks contracts and providers.
4. API endpoints (Node) — epics and tasks.
5. Frontend epics/tasks flow.
6. Tests.
7. Docker verification.
8. Documentation.

Same per-milestone discipline as every prior phase: run relevant tests, typecheck, and lint
after each milestone; report exact commands and results; commit only runnable milestones.
