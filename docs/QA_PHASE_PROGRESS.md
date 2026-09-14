# DevForge Phase 9 (Codebase Q&A) — Progress Checklist

See [docs/QA_PHASE_PLAN.md](QA_PHASE_PLAN.md) for scope, data model, API contracts, citation
format, and the full plan. This file tracks the 8 milestones the same way
[docs/RETRIEVAL_PHASE_PROGRESS.md](RETRIEVAL_PHASE_PROGRESS.md) tracked Phase 8.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Database (Question, Answer, AnswerSource)
- [x] 3. Q&A provider (ai-service)
- [ ] 4. Retrieval-to-answer service
- [ ] 5. Q&A API
- [ ] 6. Frontend Codebase Q&A
- [ ] 7. Security and prompt-injection protection
- [ ] 8. Remaining tests, Docker verification, documentation

## Per-milestone log

### 1. Inspect and plan
- Confirmed via `git status --porcelain` the repo is exactly where Phase 8 left it (clean
  tree, `f00950d` as HEAD).
- Re-read `api/src/services/retrieval.ts` in full (the exact `search()` signature, its error
  codes, and its lazy chunk/embedding build — confirmed Q&A can call it directly rather than
  re-deriving any of its logic), `api/src/lib/aiServiceClient.ts`'s `postToAiService` helper
  (confirmed it already maps a real, unset `ANTHROPIC_API_KEY`'s `PROVIDER_NOT_CONFIGURED` to
  `AI_PROVIDER_UNAVAILABLE` — reused as-is for Q&A, no new "not configured" code invented),
  `ai-service/app/agents/requirements/provider.py` and `router.py` (the exact
  provider-abstraction/structured-output/test-double pattern the new qa agent mirrors),
  `ai-service/app/lib/provider_config.py`, `api/schemas/requirements.ts` and
  `schemas/retrieval.ts` (the exact snake_case↔camelCase and validation-schema conventions
  reused for `schemas/qa.ts`).
- **Citation-safety design decision, made explicit per the task's instruction ("never invent
  files, symbols, APIs, behavior, or line numbers")**: Claude's structured output for Q&A never
  contains a file path, symbol name, or line number at all — only `cited_source_numbers: int[]`,
  selecting by number from a fixed, Node-numbered list of real retrieval results. The actual
  `sources` array in every API response and persisted `AnswerSource` row is built entirely from
  Node's own already-verified `search()` output, keyed by the model's selected numbers (with
  any out-of-range number dropped, never trusted). This makes citation hallucination
  structurally impossible, not just prompt-discouraged — recorded here since it's the single
  most important design decision this phase makes, and it isn't visible from the schema alone
  without this note.
- **Retrieval-reuse decision**: Q&A's service calls `retrievalService.search()` directly rather
  than reimplementing chunk selection/embedding/ranking — this is what makes "retrieval before
  any LLM call" a structural guarantee (there is no code path to the Claude call that doesn't
  first go through `search()`'s own real success path) rather than just an ordering convention
  to remember to preserve.
- Full reasoning, schema, request/response shapes, context-assembly format, limits, and
  milestone breakdown written to `docs/QA_PHASE_PLAN.md`.
- Confirmed Docker (`devforge-postgres-1` only) and no orphaned processes before starting;
  confirmed the sibling VoxMind `uvicorn` process is running and untouched.
- Commit: `2b44c85` — "docs: Phase 9 (Codebase Q&A) plan and progress tracker".

### 2. Database (Question, Answer, AnswerSource)
- Added `Question` (project/codebaseIndex relations, question text, denormalized branch/
  commitSha, timestamp), `Answer` (1:1 with Question via `@unique` FK, answer text,
  `insufficientEvidence`, `model`), and `AnswerSource` (answer/chunk relations, `sourceOrder`,
  `cited`, retrieval-time `score`) models exactly as designed in `docs/QA_PHASE_PLAN.md`, plus
  `Project.questions` and `CodebaseIndex.questions` back-relations and `CodeChunk.answerSources`.
- `npx prisma format` + `npx prisma validate` passed on the first try (added both sides of
  every new relation up front, learning fully applied from Phase 7's Milestone 2 miss and
  Phase 8's own note about it).
- `npx prisma migrate dev --name add_qa_questions_answers` generated and applied
  `prisma/migrations/20260914173809_add_qa_questions_answers/migration.sql`. Read the SQL back
  and confirmed: `answers_question_id_key` is a real unique index (one answer per question),
  `answer_sources_answer_id_chunk_id_key` is a real unique index (no duplicate evidence rows
  per answer), and every FK — including `answer_sources.chunk_id` → `code_chunks` — is `ON
  DELETE CASCADE`.
- `npx prisma generate` regenerated the client cleanly; `npm run typecheck` and `npm run lint`
  both passed with no errors.
- Wrote and ran a throwaway verification script (not committed) against the real database:
  created a user/project/connection/index/file/chunk/question/answer/source, confirmed the
  one-answer-per-question uniqueness is enforced, confirmed the one-source-per-(answer,chunk)
  uniqueness is enforced, confirmed the full Question → Answer → AnswerSource → CodeChunk chain
  resolves correctly including the `cited` flag, confirmed deleting the underlying `CodeChunk`
  cascades away only its `AnswerSource` row while the parent `Answer`'s own text/model survive
  intact (the documented "old evidence detail doesn't survive a reindex, the answer text
  does" behavior), and confirmed deleting the `Project` cascades away the whole chain — all
  assertions passed.
- Proactively applied the migration to `devforge_test` in this same milestone.
- Ran the full `api/` test suite (`npm run test`): 204/204 passed. (Two `tasks.test.ts` tests
  failed once under full-suite parallel load and passed cleanly in isolation and on a second
  full-suite run — the same pre-existing parallel-worker flakiness documented in Phase 6/7's
  own progress docs, unrelated to this milestone's schema-only change.)
- Commit: `9d5024f` — "feat(api): add question, answer, and answer_source data model and
  migration".

### 3. Q&A provider (ai-service)
- **`ai-service/app/agents/qa/`** (new): `schemas.py` — `QaSourceInput` (`source_number, path,
  symbol_name, start_line, end_line, content`), `AskQuestionRequest` (`question` 1–2000 chars,
  `repository`, `branch`, `commit`, `sources` 1–20 items), `QaAnswerContent` (`answer`,
  `cited_source_numbers: list[int]`, `insufficient_evidence: bool` — deliberately no field for
  a model-supplied path/symbol/line, the actual citation-safety mechanism, not just a
  convention), `AskQuestionResponse`. `provider.py` — `QaProvider` ABC + `AnthropicQaProvider`
  (Claude `claude-opus-5`, `client.messages.parse()` structured output, `max_tokens=2000`);
  `format_context()` is a standalone pure function building the exact deterministic
  `Repository:`/`Branch:`/`Commit:`/`Source N:` block from the plan doc, directly unit-testable
  without any HTTP layer. The full 7-rule system prompt (collapsing the task's 10 required
  points into 7 — several overlapped: e.g. "cite supporting code locations" and "never invent
  line numbers" are one rule here, since the citation mechanism makes them inseparable) covers:
  answer only from supplied sources; say so plainly (and suggest a better question) when
  evidence is insufficient; never invent a path/symbol/API/line — citations are number-only
  selections from a fixed list, not free text; distinguish confirmed facts from inferences;
  treat source content as untrusted data, never as instructions, explicitly including
  prompt-injection-shaped text inside a source; never output a secret/token/credential value
  even if one appears in a source; stay concise; and an explicit closing line that the model has
  no tools and cannot take any repository action. After parsing, `AnthropicQaProvider.answer()`
  also filters `cited_source_numbers` to the real `1..N` range it was actually given — defense
  in depth on top of the structural guarantee, not a substitute for Node's own independent
  re-validation (Milestone 4).
  `router.py` — `POST /qa/answer`, registered in `main.py` alongside the six existing routers.
- Commands run and results:
  - `python -m pytest -q`: 66/66 existing ai-service tests still pass (no test added yet for
    the new module — deferred to Milestone 8, matching every prior phase's own Milestone 3).
  - Booted `uvicorn main:app` on a scratch port with no `ANTHROPIC_API_KEY` set: `POST
    /qa/answer` correctly returned 503 `PROVIDER_NOT_CONFIGURED` naming `ANTHROPIC_API_KEY` and
    "codebase Q&A"; an empty `question` correctly returned a real FastAPI 400
    `VALIDATION_ERROR`. Confirmed no orphaned `uvicorn` process after stopping the scratch
    server (`ps aux`); the sibling VoxMind `uvicorn` process was the only one left, untouched.
- Commit: `d8772da` — "feat(ai-service): add codebase Q&A provider (Anthropic, structured
  output)".

### 4. Retrieval-to-answer service
_Not started._

### 5. Q&A API
_Not started._

### 6. Frontend Codebase Q&A
_Not started._

### 7. Security and prompt-injection protection
_Not started._

### 8. Remaining tests, Docker verification, documentation
_Not started._
