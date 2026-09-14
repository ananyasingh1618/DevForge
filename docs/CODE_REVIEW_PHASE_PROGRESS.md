# DevForge Phase 10 (AI Code Review) — Progress Log

See `docs/CODE_REVIEW_PHASE_PLAN.md` for the full design. This log tracks each milestone's
implementation, verification, and commit hashes as work proceeds.

## Milestone 1 — Architecture inspection and plan

Inspected before writing the plan: Phase 7's `CodebaseIndex`/`IndexedFile`/`Symbol` models and
`runOrReuse()`'s failed-row-persistence pattern; Phase 8's `CodeChunk`/`Embedding` models,
`lib/chunking.ts`, `lib/similarity.ts`, and `services/retrieval.ts`'s `search()`; Phase 9's
`Question`/`Answer`/`AnswerSource` models, `ai-service/app/agents/qa/` (schemas, provider,
router), `lib/aiServiceClient.ts`'s `answerQuestionViaAiService`, `lib/qaSourceSelection.ts`,
`services/qa.ts`, `controllers/qa.ts`, `routes/qa.ts`, `schemas/qa.ts`, and
`frontend/src/pages/CodebaseQa.tsx`; the existing Anthropic provider abstraction pattern (every
agent's own `provider.py` ABC + concrete Anthropic class + `get_provider()`); `app/errors.py`'s
`ProviderNotConfiguredError`/`AIResponseInvalidError`/`ProviderRequestError`; `AppError`'s static
helpers in the Node API; `app.ts`'s router registration order; `main.py`'s router registration;
existing migration/cascade conventions (`onDelete: Cascade` throughout, `AnswerSource` ->
`CodeChunk` as the precedent for referencing evidence without duplicating it); the existing test
structure (Supertest route tests, ai-service pytest with fake-client test doubles, RTL frontend
tests, `tests/` real-HTTP integration tests); and `docker-compose.yml`'s `ANTHROPIC_API_KEY`/
`VOYAGE_API_KEY` passthrough.

Conclusion: AI Code Review is structurally the same shape as Codebase Q&A — retrieval ->
context assembly -> structured-output provider -> citation validation -> persistence — with two
differences that matter for the data model: (1) a review produces *multiple* findings from one
shared evidence set (not one answer per question), so evidence is owned by the review, not by
any one finding, requiring a finding-to-source join table rather than Q&A's simpler one-answer-
to-many-sources shape; (2) a review is deliberately persisted as a durable row *before* the
provider call once evidence exists, so a provider-side failure updates a real "failed" row
instead of leaving an orphaned one (an explicit improvement on a gap in Phase 9's own
`Question`/`Answer` split, documented in the plan). No new autonomous-agent behavior, background
job queue, vector database, or embedding provider is introduced — retrieval, chunking, and
embeddings are reused from Phase 8 completely unchanged.

Deliverables: `docs/CODE_REVIEW_PHASE_PLAN.md`, this progress log.

Commit: `16870a6`

## Milestone 2 — Review data model

Added `CodeReview` (one row per review run, `status` pending/completed/failed,
`branch`/`commitSha` denormalized from the owning `CodebaseIndex`), `CodeReviewSource` (the
review's shared evidence set — every source sent to the provider, not just cited ones, owned by
the review rather than by any one finding), `CodeReviewFinding` (title/description/severity/
category/confidence/recommendation/`actionable`, never a raw path/symbol/line), and
`CodeReviewFindingSource` (the many-to-many join recording which sources each finding actually
cites — the mechanism that keeps a finding from being persisted with zero real evidence). All
cascades verified (`onDelete: Cascade` throughout, matching every table added since Phase 6).
Migration `20260914182740_add_code_review` generated via `prisma migrate dev --create-only`,
reviewed by hand, applied to both `devforge` and `devforge_test` via `prisma migrate deploy`
(proactively applying to the test database immediately, per the lesson recorded in
`docs/CODEBASE_INDEX_PHASE_PROGRESS.md` about not deferring that step). `tsc --noEmit` clean
after `prisma generate`.

Commit: `a5b7dd7`

## Milestone 3 — Review provider

Added `ai-service/app/agents/review/` (`schemas.py`, `provider.py`, `router.py`), mirroring
`app/agents/qa/` exactly: `ReviewProvider` ABC, `AnthropicReviewProvider` (Claude `claude-opus-5`
via `client.messages.parse()`, `MAX_REVIEW_TOKENS = 4000`), a pure `format_context()` producing
the same `Repository:`/`Branch:`/`Commit:`/`Source N:` block Q&A uses, and a 13-rule
`SYSTEM_PROMPT` covering every instruction the task's own Milestone 3 lists (evidence-only
review, "potential issue" language under uncertainty, no style/unfamiliar-pattern nitpicks,
confirmed-vs-potential distinction, numeric-only citation, no invented paths/symbols/lines,
untrusted-data treatment of both repository content and the review scope itself, no secret/
system-prompt exposure, no tool/execution capability, no modify/commit/PR/issue/Actions
capability, empty findings when nothing is supported, no duplicate findings). Findings use
Pydantic enums for severity/category/confidence (`ReviewFindingSeverity`,
`ReviewFindingCategory`, `ReviewFindingConfidence`) — an invalid value is a structured-output
parse failure (`AIResponseInvalidError`), not a free string that could reach the database.
Citation-safety mechanism: `cited_source_numbers` is the only way a finding references evidence;
`AnthropicReviewProvider.review()` filters each finding's citations to the real `1..N` range and
then drops any finding left with zero valid citations — an uncited finding is discarded, not
persisted with an empty evidence list. `main.py` registers `review_router`. Manually verified via
a real, unconfigured `uvicorn` run: `POST /review/analyze` returns a real `503
PROVIDER_NOT_CONFIGURED` naming "AI code review" and `ANTHROPIC_API_KEY`, `/health` unaffected.
28 new tests added (`tests/test_review.py`, mirroring `tests/test_qa.py`'s structure): validation,
provider configuration/failure, deterministic context formatting (including the malicious-content-
is-inert-literal-text test), system-prompt content assertions, and citation-filtering tests
covering both "some invalid numbers dropped from one finding" and "a finding left with zero valid
citations is dropped entirely." Full `ai-service` suite: 114 passed (86 pre-existing + 28 new).

Commit: `c1e18ef`

## Milestone 4 — Retrieval-to-review service

Added `analyzeReviewViaAiService` to `lib/aiServiceClient.ts` (reuses `postToAiService`, the same
`PROVIDER_NOT_CONFIGURED` -> `AI_PROVIDER_UNAVAILABLE` mapping every generate/Q&A call already
uses; independently re-validates every finding's shape and enum membership before returning),
`schemas/codeReview.ts` (`createReviewSchema` with an optional, 1–2000-char `scope`), and
`services/codeReview.ts`'s `createReview()`/`listReviews()`/`getReview()`. `createReview()`
calls `retrievalService.search()` directly (retrieval-before-any-LLM-call is structurally
guaranteed the same way it is for Q&A) with the scope (or a fixed default when omitted) as the
query, reuses `qaSourceSelection.ts`'s `selectSources()` unchanged for dedup/capping, and — once
evidence exists — persists a `CodeReview` row (`status: "pending"`) and its `CodeReviewSource`
rows *before* calling the review provider, so a provider-side failure updates that same row to
`status: "failed"` with a safe error message rather than leaving an orphaned row (the deliberate
improvement over Phase 9's `Question`/`Answer` split documented in the plan). A genuinely empty
evidence set skips the provider call entirely, returning a real, local "no relevant code found"
review (`model: "none"`, zero findings) instead. Every finding's `cited_source_numbers` is
independently re-validated against the real `1..N` range and any finding left with zero valid
citations after filtering is dropped before persistence — defense in depth on top of
`ai-service`'s own identical filtering, mirroring Phase 9's citation re-validation exactly.
`tsc --noEmit` and `eslint .` both clean; full `api` Vitest suite unchanged at 231 passed.

Commit: `7db8bf1`

## Milestone 5 — Code Review API

`<pending>`

## Milestone 6 — Frontend Code Review

`<pending>`

## Milestone 7 — Security, quality, and false-positive controls

`<pending>`

## Milestone 8 — Tests, Docker, documentation

`<pending>`
