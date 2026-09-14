# DevForge Phase 9 (Codebase Q&A) — Progress Checklist

See [docs/QA_PHASE_PLAN.md](QA_PHASE_PLAN.md) for scope, data model, API contracts, citation
format, and the full plan. This file tracks the 8 milestones the same way
[docs/RETRIEVAL_PHASE_PROGRESS.md](RETRIEVAL_PHASE_PROGRESS.md) tracked Phase 8.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Database (Question, Answer, AnswerSource)
- [x] 3. Q&A provider (ai-service)
- [x] 4. Retrieval-to-answer service
- [x] 5. Q&A API
- [x] 6. Frontend Codebase Q&A
- [x] 7. Security and prompt-injection protection
- [~] 8. Remaining tests, Docker verification, documentation

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
- **`api/src/lib/qaSourceSelection.ts`** (new): pure, network/DB-free `selectSources(results)` —
  deduplicates overlapping evidence (same file, intersecting line ranges — e.g. two overlapping
  split-pieces of an oversized symbol, or a class chunk and its already-separately-ranked
  nested method chunk), keeping the higher-scored chunk from each overlapping group; caps at
  `MAX_SOURCES = 8` and a combined `MAX_CONTEXT_CHARS = 16,000` budget, always keeping at least
  one source if any exist even if it alone exceeds budget (mirrors `chunkFile`'s own "always
  emit at least one line whole" precedent).
- **`api/src/lib/aiServiceClient.ts`**: added `answerQuestionViaAiService(question, repository,
  branch, commit, sources)` — reuses the existing `postToAiService` helper as-is (this is a
  genuine `ANTHROPIC_API_KEY`-gated LLM call, exactly like the five generate functions above
  it, so the same `PROVIDER_NOT_CONFIGURED` → `AI_PROVIDER_UNAVAILABLE` mapping applies
  unchanged — no new "not configured" code invented). Validates the response shape (answer is
  a non-empty string, `cited_source_numbers` is a number array, `insufficient_evidence` is a
  boolean) before returning, throwing `AI_RESPONSE_INVALID` otherwise — "Validate the provider
  response" from the task's own Milestone 4 list.
- **`api/src/schemas/qa.ts`** (new): `askQuestionSchema` (`question` 1–2000 chars, matching
  `schemas/retrieval.ts`'s own query cap), `projectIdParamSchema`, `questionParamSchema`.
- **`api/src/services/qa.ts`** (new): `askQuestion(ownerId, projectId, question)` —
  `requireOwnedProject`, then `retrievalService.search()` (Phase 8, unchanged — this is what
  makes "retrieval before any LLM call" a structural guarantee, not just an ordering
  convention: there is no code path here that reaches `answerQuestionViaAiService` without
  `search()` having already succeeded), then `selectSources()`, then either a real local
  "insufficient evidence" answer with **no Claude call at all** (zero selected sources) or a
  real `answerQuestionViaAiService` call followed by independently re-validating
  `citedSourceNumbers` against the real `1..N` range Node itself gave the model (defense in
  depth on top of `ai-service`'s own identical filtering — never trust either layer alone).
  Persists `Question` + `Answer` + `AnswerSource` rows, returning `{ questionId, question,
  answer, insufficientEvidence, sources, branch, commit, createdAt }`. `listQuestions` and
  `getQuestion` share a `serializeQuestion()` helper and the same ownership/ `(id, projectId)`
  scoping pattern every other project-scoped resource in this codebase already uses — enforcing
  question-history authorization and cross-project isolation the same established way, not a
  new mechanism.
- Commands run and results:
  - `npm run typecheck` / `npm run lint`: clean on the first pass.
  - Manual live verification (combined with Milestone 5's endpoints, since the service has no
    caller without them yet) — see Milestone 5's log entry below for the full sequence and
    results.
- Commit: `79d73fd` — "feat(api): add codebase Q&A retrieval-to-answer service".

### 5. Q&A API
- **`api/src/controllers/qa.ts`** / **`api/src/routes/qa.ts`** (new): `POST
  /projects/:projectId/qa` (`ask`), `GET /projects/:projectId/qa` (`list`), `GET
  /projects/:projectId/qa/:questionId` (`getOne`), all under `requireAuth`, registered in
  `api/src/app.ts` alongside every other feature router.
- Commands run and results:
  - `npm run typecheck` / `npm run lint`: clean.
  - Manual live verification, in this order, cleaning up all created data and stopping every
    manually-started process afterward: booted `ai-service` and `api` (unconfigured) against
    the real local Postgres; registered a user, created a project; confirmed `POST .../qa`
    with no index at all returns 400 `NO_COMPLETED_INDEX`; confirmed `GET .../qa` with no
    questions asked yet returns `{ questions: [] }`; confirmed `GET .../qa/:questionId` for a
    nonexistent id returns 404 `NOT_FOUND`. Generated a local, never-committed
    `GITHUB_TOKEN_ENCRYPTION_KEY`, restarted the API with it configured, and directly inserted
    (via the same throwaway-script technique Phase 8's own Milestone 4 used, since no real PAT
    exists) a verified `RepositoryConnection` + a `completed` `CodebaseIndex` pointing at the
    real public repo `octocat/Hello-World`. Asked a question: confirmed it genuinely reaches
    GitHub (via `search()`'s own blob refetch) and fails with a real 401
    `GITHUB_INVALID_CREDENTIALS` — never reaching the (also unconfigured) Claude call, which
    would have surfaced as a distinctly different 503 `AI_PROVIDER_UNAVAILABLE` had the code
    reached it — confirming retrieval-before-provider ordering for real, not just by code
    inspection. Confirmed the raw response contains no `ghp_` substring, and confirmed
    directly against the database that **zero** `Question` rows were persisted from the failed
    attempt (the service creates the `Question` row only after `search()` has already
    succeeded). Deleted the scratch project/user afterward.
  - The full happy path (a real grounded answer with real citations) could not be exercised
    live without both a real GitHub PAT and a real `ANTHROPIC_API_KEY` — neither exists in this
    environment. Deferred to Milestone 8's deterministic, mocked-fetch Supertest tests, matching
    exactly how Phase 7/8's own equivalent milestones handled the same constraint.
  - `npm run test` (full `api/` suite): 204/204 passed, confirming no regression.
  - Confirmed no orphaned `tsx watch`/`uvicorn` processes after stopping the manually-started
    servers; the sibling VoxMind `uvicorn` process was the only one left running, untouched.
- Commit: `cc7f68b` — "feat(api): add codebase Q&A API endpoints".

### 6. Frontend Codebase Q&A
- **`frontend/src/types/qa.ts`** / **`frontend/src/services/qaApi.ts`** (new): types and
  `apiRequest`-based service functions matching every other feature's conventions exactly.
- **`frontend/src/pages/CodebaseQa.tsx`** (new): a dedicated page at `/projects/:id/qa` (not
  another Settings section — same reasoning as `CodeSearch`'s own page vs. section decision),
  gated the same way `CodeSearch` gates on connection + completed index. States: `no-repository`
  / `no-index` (link to Settings), `ready` (question form + `QaPanel`). Within `QaPanel`:
  `loading` (a single honest message — "Searching the indexed codebase, assembling context, and
  generating an answer…" — describing the real steps that really happen sequentially within one
  request, never a fabricated multi-stage progress UI DevForge doesn't actually have), `empty`
  (no questions asked yet, with the task's own three example questions as clickable buttons that
  fill the input), `results` (a history list, newest first, each showing the question, answer,
  an `insufficientEvidence` note when set, sources with a `cited` badge/file path/symbol/line
  range/score, and branch/commit — "ask a follow-up question" is just the same form, submitting
  another independent question, matching the plan's explicit "not a chat thread" design), and
  `error` (the real API error message inline, never a fabricated empty-results state standing
  in for a failure). The page header includes an explicit "Read-only" disclaimer matching the
  task's own documentation requirement, visible on every state, not just in written docs.
- **`frontend/src/App.tsx`**: added the `/projects/:id/qa` route.
- **`frontend/src/pages/ProjectOverview.tsx`**: added a "Q&A" link next to "Search"/"Settings";
  removed "Codebase Q&A" from `upcomingCapabilities` (now implemented) and reworded the
  surrounding comment — only "Reviews" remains genuinely unbuilt. Updated
  **`ProjectOverview.test.tsx`**'s assertion accordingly (the "Not yet implemented" count moved
  from 2 to 1, and added explicit assertions that "Codebase Q&A" no longer appears there while
  "Reviews" still does).
- Commands run and results:
  - `npm run typecheck`, `npm run lint`, `npm run build`: all clean (same pre-existing
    `useAuth.tsx` warning as every prior phase, unrelated to this one).
  - `npm run test` (frontend): 74/74 — unchanged from before this milestone (the
    `ProjectOverview.test.tsx` update kept the suite green rather than adding a new failure).
  - Manual Playwright verification against the real (unconfigured, then locally-configured with
    a never-committed key) dev stack, screenshots read back directly: confirmed the "Q&A" link
    navigates to `/projects/:id/qa` and shows the `no-repository` gate with the read-only
    disclaimer visible; confirmed, after directly inserting a `RepositoryConnection` + a
    `completed` `CodebaseIndex` (same throwaway-script technique as every prior milestone's
    manual check, pointing at `octocat/Hello-World`), the `empty` state renders with all three
    clickable example questions; confirmed clicking an example question and submitting
    genuinely reaches GitHub and shows the real 401 "The GitHub token is invalid or expired."
    message inline, with the empty-history state still correctly shown afterward (no fabricated
    entry was added for the failed attempt, matching the service never persisting a `Question`
    row when `search()` fails).
  - The `results` state (a real answer with real citations) could not be exercised live without
    a real GitHub PAT and a real `ANTHROPIC_API_KEY` — deferred to Milestone 8's deterministic,
    mocked-fetch RTL tests, matching exactly how Phase 8's Milestone 5 handled the same
    constraint for its own results state.
  - Deleted the scratch project/user and confirmed no orphaned `tsx watch`/`vite`/`uvicorn`
    processes remained afterward; the sibling VoxMind `uvicorn` process was the only one left
    running, untouched.
- Commit: `148041e` — "feat(frontend): add Codebase Q&A page".

### 7. Security and prompt-injection protection
- Structural protections were already built into Milestones 3–4 (the citation-safety schema
  design, the untrusted-data/no-tools system prompt, `search()`'s existing ownership/(branch,
  commit) scoping, `askQuestionSchema` accepting no caller-supplied branch/commit at all). This
  milestone adds dedicated, deterministic tests proving each — mapped explicitly to the task's
  own Milestone 7 checklist, since several of those items can only be *structurally* guaranteed,
  not proven against a live model without paid credentials:
  - **Malicious instructions inside source files / prompt injection in comments** →
    `TestFormatContext::test_malicious_source_content_is_included_as_literal_inert_text_not_executed_or_interpolated`
    (`ai-service/tests/test_qa.py`): a source whose content contains
    `"IGNORE ALL PREVIOUS INSTRUCTIONS..."` plus Python-format-string-shaped placeholders
    (`{system_prompt}`, `{os.environ}`) is proven to survive byte-for-byte inside the context
    block — never interpolated, evaluated, or specially parsed. This is the deterministic half
    of "treat repository content as untrusted data": that the pipeline gives injected text no
    execution power. Whether the live model itself actually declines to follow it is a real
    LLM call this environment cannot make without a paid key — the system prompt instructs it
    to (see below), and that instruction is what a real Anthropic key would exercise in
    production, consistent with every other LLM-behavior guarantee in this codebase never
    being proven against a live model in the normal test suite.
  - **Attempts to reveal the system prompt / API keys / GitHub tokens** →
    `TestSystemPrompt`'s four assertions confirm the actual system prompt text instructs
    against both (untrusted-data treatment, never revealing secrets/credentials, never
    inventing citations). Separately, the Q&A service (Milestone 4) never reads
    `RepositoryConnection.encryptedToken` at all — only already-fetched `CodeChunk` content —
    so there is no code path for a token to reach a prompt, log line, or response body; this
    was verified live in Milestone 5's manual check (`grep`-checked the raw response for
    `ghp_`) and gets a dedicated automated assertion in Milestone 8's Supertest suite.
  - **Cross-project / cross-branch / cross-commit retrieval** → `askQuestionSchema`
    structurally accepts no `branch`/`commit` field at all (unlike `/search`'s optional
    validation-only fields) — a question always answers against whatever the project's
    *current* index is, with no way for a caller to even request a different one. Cross-project
    isolation is inherited from `search()`'s own existing ownership scoping (Phase 8) and gets
    its own dedicated Supertest case in Milestone 8's broader suite (two independently indexed
    projects, confirming neither's citations ever reference the other's chunks).
  - **Unauthorized question-history access** → `getQuestion`'s `where: { id: questionId,
    projectId }` scoping (Milestone 4) makes a foreign project's question id 404 regardless of
    whether the id itself is known — a dedicated Supertest case (another project's question id,
    requested through a project the caller *does* own) lives in Milestone 8's suite, alongside
    the standard ownership-403-as-404 cases every other endpoint already has.
  - **Excessively long questions** → `test_answer_rejects_excessively_long_question_with_400`
    (ai-service, a 2001-character question) plus the equivalent already-existing Node-side
    `askQuestionSchema` 2000-char cap (unit-testable at the Node Supertest layer in Milestone 8).
  - **Excessively large retrieved context / duplicate evidence** →
    `api/src/lib/qaSourceSelection.test.ts` (new, 9 cases): overlap-removal keeps only the
    higher-scored of two overlapping-line-range results in the same file (and correctly does
    *not* treat identical line ranges in *different* files as overlapping); `MAX_SOURCES`
    is never exceeded, keeping the highest-scored results when capping; `MAX_CONTEXT_CHARS` is
    never exceeded across combined content once more than one source is available, while still
    always keeping at least one source even if it alone exceeds the budget; determinism
    regardless of input order; empty-input handling.
  - **Empty or malformed provider responses** →
    `test_answer_surfaces_malformed_provider_response_as_502` (ai-service router level) and
    `TestAnthropicQaProviderCitationFiltering::test_drops_out_of_range_and_invalid_cited_source_numbers`
    (direct provider-level test against a monkeypatched Anthropic client, proving
    `cited_source_numbers` values like `99`, `-1`, and `0` — all outside the real, given range —
    are silently dropped rather than trusted, the defense-in-depth half of the citation-safety
    mechanism). The Node-side equivalent (`answerQuestionViaAiService`'s response-shape
    validation) already exists from Milestone 4; a dedicated malformed-response Supertest case
    is added in Milestone 8.
  - Also added: `test_answer_rejects_empty_sources_with_400` and
    `test_answer_rejects_excessively_many_sources_with_400` (ai-service's own `sources` 1–20
    length bound), `TestFormatContext`'s remaining format/determinism/multi-source-numbering
    cases (context formatting was itself one of the task's named "AI-service/provider tests"
    requirements).
- Commands run and results:
  - `python -m pytest -q tests/test_qa.py`: 20/20 passed on the first try.
  - `python -m pytest -q` (full ai-service suite): 86/86 (66 prior + 20 new).
  - `npx vitest run src/lib/qaSourceSelection.test.ts`: 9/9 passed after fixing one test's own
    arithmetic (the assertion, not the implementation — computed the wrong expected minimum
    kept score on the first pass, a mistake in the test itself, corrected before this log entry
    was written).
  - `npm run typecheck` / `npm run lint` (api): clean.
  - `npm run test` (full `api/` suite): 213/213 (204 prior + 9 new).
- Commit: `f175e20` — "test(api,ai-service): add Q&A security and prompt-injection
  protection tests".

### 8. Remaining tests, Docker verification, documentation

**Part A — remaining tests (this entry). Docker verification and documentation follow as
their own log entries below once complete.**

- **`api/src/routes/qa.test.ts`** (new, 18 cases): auth (401 on all three endpoints) and
  ownership (404 for another user's project, on all three); validation (blank question,
  missing field, over-length question, non-string question); prerequisites with no provider
  call when they fail (`NO_COMPLETED_INDEX` with `fetch` never called; `GITHUB_INTEGRATION_NOT_CONFIGURED`
  with `fetch` never called); retrieval-before-provider ordering (a real-shaped GitHub 401
  during chunk-building never reaches the — also effectively unconfigured — Q&A provider, and
  persists no `Question`); the full happy path (connect, index, ask — verifying the returned
  answer, `branch`/`commit`, and a cited source's file/symbol/lines, then independently
  re-fetching the same question via `GET .../qa/:id` and confirming the list via `GET .../qa`);
  a `cited_source_numbers: []` case confirming a source sent as evidence but *not* cited is
  correctly marked `cited: false`, not silently omitted; empty retrieval result (an
  insufficient-evidence answer returned with the Q&A provider endpoint never called — asserted
  via `fetchSpy.toHaveBeenCalledTimes(1)`, that one call being only the query embedding);
  `AI_PROVIDER_UNAVAILABLE` (no `ANTHROPIC_API_KEY`), `EMBEDDING_PROVIDER_UNAVAILABLE` (no
  `VOYAGE_API_KEY`), `AI_SERVICE_ERROR` (a genuine Q&A provider failure), `AI_RESPONSE_INVALID`
  (a malformed provider response) — all four distinguishable, real error codes; no raw GitHub
  token anywhere in a successful Q&A response body; and project isolation (a question id from
  one project 404s both through the other project directly and through a project the second
  user does own).
- **`frontend/src/pages/CodebaseQa.test.tsx`** (new, 13 cases): the `no-repository` gate
  (confirming the index and Q&A endpoints are never called); the `no-index` gate (including an
  index that exists but hasn't reached `completed`), asserting its real "Go to Settings" link
  `href`; the empty state's three example questions, and that clicking one fills the input; the
  page's read-only disclaimer text; the loading state's single honest message, held open via an
  unresolved promise until explicitly resolved, then showing the real result; the results state
  rendering a prior answer's question/answer/file/symbol/lines/`cited` badge/branch+commit; an
  `insufficientEvidence` note rendering distinctly; asking a follow-up question and confirming
  both the original and the new answer remain visible (not a chat thread — literally two
  independent history entries); a real ask-error rendering inline while the empty state remains
  shown (no fabricated answer); a distinct history-*load* error; and a dedicated "no secret
  leakage" test asserting the entire rendered page's text content never matches a
  token/key-shaped pattern (`ghp_...`, `sk-ant-...`).
- **`tests/qa.test.ts`** (new, 1 case): real-HTTP integration test — register, create a
  project, and confirm the honest `NO_COMPLETED_INDEX` response from a genuinely running API
  process, and that nothing is persisted from the blocked attempt. Like `tests/retrieval.test.ts`,
  needs no real credentials for any of GitHub/Anthropic/Voyage and does not need `ai-service`
  running at all.
- Commands run and results:
  - `npx vitest run src/routes/qa.test.ts`: 18/18 passed on the first try.
  - `npm run typecheck` / `npm run lint` (api): clean.
  - `npm run test` (full `api/` suite): 231/231 (213 prior + 18 new).
  - `npx vitest run src/pages/CodebaseQa.test.tsx`: 13/13 passed on the first try.
  - `npm run typecheck` / `npm run lint` (frontend): clean.
  - `npm run test` (full frontend suite): 87/87 (74 prior + 13 new).
  - `npx tsc --noEmit` (`tests/`): clean.
  - `npm run test` (`tests/`, against the real local dev stack — Postgres, `api`, `ai-service`
    all genuinely running): 11/11 (10 prior + 1 new).
  - Combined total across all four suites so far: **415 tests** (231 api + 86 ai-service + 87
    frontend + 11 tests/) — recomputed and double-checked (`231+86+87+11 = 415`) before writing
    this line; this total will be restated in the phase's closing section once Docker
    verification and documentation (parts B and C of this milestone) are also done, in case
    either surfaces anything requiring one more test.
  - Confirmed no orphaned `tsx watch`/`uvicorn` processes after stopping the manually-started
    servers; the sibling VoxMind `uvicorn` process was the only one left running, untouched.
- Commit: `43a807c` — "test(api,frontend,tests): add comprehensive Q&A test coverage".

**Part B — Docker volume-wiped verification.**

- No Docker config changes were needed this phase — confirmed via `git diff` before starting
  that nothing in `docker-compose.yml`/any `Dockerfile` had changed since Phase 8.
- Commands run and results:
  - `docker compose down -v` (full volume wipe, including the standalone dev Postgres left
    running from prior milestones) then `docker compose up -d --build` for a genuinely clean
    rebuild of all four services.
  - All four containers reached `healthy`; confirmed all 9 migrations — including
    `20260914173809_add_qa_questions_answers` — auto-applied from the `api` container's own
    startup logs.
  - Verified `POST /qa/answer` directly against the containerized `ai-service` with no
    `ANTHROPIC_API_KEY` set in the host shell: real 503 `PROVIDER_NOT_CONFIGURED` naming
    "codebase Q&A".
  - Verified `POST /projects/:id/qa` and `GET /projects/:id/qa` through the containerized `api`
    (no `GITHUB_TOKEN_ENCRYPTION_KEY`/`ANTHROPIC_API_KEY`/`VOYAGE_API_KEY` set, deliberately —
    Docker's real, honest unconfigured state): registered a user, created a project, confirmed
    the real 400 `NO_COMPLETED_INDEX` and the real empty `{ questions: [] }` list.
  - **Re-verified all seven prior phases' real dependency-chain behavior through this same
    containerized stack**, not assumed intact: `POST .../repository/connect` still returns 503
    `GITHUB_INTEGRATION_NOT_CONFIGURED`; `POST .../codebase-index/start` still returns 400
    `NO_REPOSITORY_CONNECTED`; `POST .../search` still returns 400 `NO_COMPLETED_INDEX`; `POST
    .../requirements/analyze` still returns 503 `AI_PROVIDER_UNAVAILABLE`; and
    `.../prd/generate`, `.../architecture/generate`, `.../epics/generate`, `.../tasks/generate`
    each still return their real, honest `NO_ACTIVE_*` dependency-chain error — none of Phase
    9's changes altered any of these.
  - `cd tests && pnpm test` against the running Docker stack: 11/11 passed, including the new
    `qa.test.ts`.
  - `docker compose logs api` / `docker compose logs ai-service`, grepped for `ghp_` and
    `sk-ant-`-shaped strings: none found in either service's logs.
  - Playwright against the Dockerized frontend (`http://localhost:4173`): registered, created a
    project, clicked "Q&A", and confirmed the "Codebase Q&A" page renders its "No repository
    connected" gate with the read-only disclaimer visible — screenshot read back directly.
  - Deleted all scratch users/projects created during this verification via the running
    container's Postgres, then `docker compose down` (without `-v`) and restored the local-dev
    baseline: brought the standalone `postgres` service back up, recreated `devforge_test` and
    applied all 9 migrations to it via `scripts/setup-test-db.sh`, confirmed `devforge` itself
    needed no further migration. Re-ran `npm run test` in `api/` against the restored local dev
    database: 231/231 passed. Confirmed no orphaned `tsx watch`/`uvicorn`/`vite` processes and
    that only `devforge-postgres-1` remains running in Docker.
  - `git status --porcelain` after all of the above: clean — this part required no file
    changes.
- Commit: `ac28860` — "chore: verify codebase Q&A phase against a clean-volume Docker
  rebuild".
