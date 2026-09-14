# DevForge Phase 9 (Codebase Q&A) — Progress Checklist

See [docs/QA_PHASE_PLAN.md](QA_PHASE_PLAN.md) for scope, data model, API contracts, citation
format, and the full plan. This file tracks the 8 milestones the same way
[docs/RETRIEVAL_PHASE_PROGRESS.md](RETRIEVAL_PHASE_PROGRESS.md) tracked Phase 8.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [ ] 2. Database (Question, Answer, AnswerSource)
- [ ] 3. Q&A provider (ai-service)
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
_Not started._

### 3. Q&A provider (ai-service)
_Not started._

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
