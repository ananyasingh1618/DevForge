# DevForge Phase 11 (Evaluation, Quality Measurement & Review Improvements) — Progress Log

See `docs/EVALUATION_PHASE_PLAN.md` for the full design. This log tracks each milestone's
implementation, verification, and commit hashes as work proceeds.

## Milestone 1 — Evaluation architecture and plan

Inspected before writing the plan: Phase 8's `retrieval.ts` (`search()`, `SearchResult`), Phase
9's `qa.ts`/`ai-service/app/agents/qa/` (citation-safety design), Phase 10's `codeReview.ts`/
`ai-service/app/agents/review/` (finding schema), `lib/qaSourceSelection.ts` (`MAX_SOURCES`,
`MAX_CONTEXT_CHARS`), the mocked-`fetch` testing technique already used in `qa.test.ts`/
`codeReview.test.ts`, `docker-compose.yml`'s optional-credential pass-through pattern, the
`Project`/`RepositoryConnection`/`CodebaseIndex` models, and the existing API/frontend/logging
conventions.

Key design decision: the evaluation dataset is a **fully synthetic, self-contained fixture
"repository"** (real, hand-authored TypeScript files under `evaluation/src/dataset/fixtures/`),
not a real GitHub repository — because `ai-service`'s `/qa/answer` and `/review/analyze`
endpoints already accept a caller-supplied numbered source list directly, this lets both mock
*and* real-provider evaluation exercise the real provider/prompt/schema code with zero GitHub
credentials ever required, and keeps ground truth stable (never silently invalidated by an
upstream repo changing). Retrieval evaluation uses a deterministic, dependency-free character-
n-gram embedding (`deterministicEmbedding.ts`) as a stand-in for Voyage AI, explicitly documented
as a lexical-overlap proxy, not a semantic one. `report.passed` (and the CLI's exit code) is
decided by a fixed set of regression gates (`regressionGates.ts`), deliberately separate from
each dataset case's own pass/fail — a documented, known limitation of the deterministic proxy
(one retrieval case) is allowed to show as a failed *case* without failing the *run*, while
actual structural/quality-floor violations do fail it.

Deliverables: `docs/EVALUATION_PHASE_PLAN.md`, this progress log.

Commit: `fd64a78`

## Milestone 2 — Evaluation dataset and ground truth

Added the `evaluation/` pnpm workspace package and its dataset: 9 real, hand-authored TypeScript
fixture files (`src/dataset/fixtures/`) covering authentication/session handling, database
access, an API controller, error handling, configuration loading, GitHub-integration-flavored
code, service-to-service communication, a clean file with no meaningful findings, and a file
whose comment contains an embedded prompt-injection attempt — 16 chunks total
(`fixtureRepo.ts`), each with a stable id and hand-verified `startLine`/`endLine` (confirmed by
reading each fixture file back with line numbers before writing the manifest, not estimated).
Ground truth: 9 retrieval cases, 6 Q&A cases, 9 review cases (`retrievalCases.ts`/`qaCases.ts`/
`reviewCases.ts`), each with a stable, never-renumbered string id and a hand-authored
`mockAnswer`/`mockFindings` for the deterministic default run. No real credentials, private
repository content, personal data, unlicensed source, or VoxMind files anywhere in the dataset —
every fixture file's own header comment says so explicitly (and Milestone 8's dataset tests
check this programmatically).

Commit: `571c7d9`

## Milestone 3 — Retrieval evaluation harness

Added `deterministicEmbedding.ts` (character-n-gram hashing/shingling, n = 3/4/5, L2-normalized,
cosine similarity) and `evaluators/retrievalEvaluator.ts` (`recallAtK`, `hitRate`,
`meanReciprocalRank`, `precisionAtK`, `emptyResultRate`, `duplicateSourceCaseRate`,
`contextSizeCompliant`). Initial word-token-based embedding scored only 44% recall against the
dataset — debugged directly (`rankChunks()` printed per-case) and traced to two causes, both
fixed: (1) word-level tokenization couldn't match a natural-language query word ("password")
against a camelCase identifier ("passwordHash") as a substring, fixed by switching to character
n-grams; (2) the two whole-file chunks included their file's shared, generic boilerplate header
comment, whose ordinary English prose dominated lexical-similarity scoring against unrelated
queries — fixed by trimming those two chunks' line ranges (see Milestone 2's dataset note).
Final recall@K after both fixes: 88.9% (8/9), with the one remaining, documented miss being a
genuine, explained limitation of the lexical proxy (see `docs/EVALUATION_PHASE_PLAN.md`, "What
cannot be measured reliably") rather than an evaluator bug. `pnpm eval` requires no Voyage AI
credential and completes in well under a second.

Commit: `b6cbb21`

## Milestone 4 — Codebase Q&A evaluation

`<pending>`

## Milestone 5 — Code review evaluation

`<pending>`

## Milestone 6 — Regression and quality gates

`<pending>`

## Milestone 7 — Evaluation reporting and optional dashboard

`<pending>`

## Milestone 8 — Tests, Docker verification, documentation

`<pending>`
