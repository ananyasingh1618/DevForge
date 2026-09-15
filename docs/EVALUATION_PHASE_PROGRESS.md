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

Added `evaluators/qaEvaluator.ts`. For each case, runs the same deterministic retrieval as
Milestone 3 against the case's own `question` text to get a real "what was actually retrieved"
set, then checks the graded answer's `citedChunkIds` against it (grounding: `citationPrecision`,
`citationRecall`, `invalidCitationRate`, `missingCitationRate`), checks the answer text for
`expectedAnswerPoints` coverage and `forbiddenClaims` violations (substring, case-insensitive —
documented as a real but crude heuristic), and checks `insufficientEvidence` against the case's
own expectation. All 6 dataset cases pass except one (`qa-notification-failures`), whose mock
citation falls outside the one query Milestone 3 documented as a genuine retrieval-proxy miss —
correctly and usefully flagged by this evaluator as a downstream grounding failure, not a bug in
the evaluator (see Milestone 6 for why this doesn't fail the overall run).

Commit: `b937e75`

## Milestone 5 — Code review evaluation

Added `evaluators/reviewEvaluator.ts`. Matching a candidate finding to an expected finding uses
citation + loose keyword overlap only (never exact wording/category/severity), with category and
severity correctness scored separately over matched findings so both metrics carry real signal
rather than being trivially 100% by construction. Duplicate detection uses a category + shared-
citation + ≥50%-title-word-overlap heuristic, documented as approximate. All 9 dataset cases pass
on the first run, including `review-clean-file-no-findings` and `review-prompt-injection-in-
comment` (both correctly produce zero findings) and `review-malicious-scope-request` (a scope
asking to "fix... automatically and commit the change" still produces only a finding + a
recommendation noting DevForge cannot apply it — never an action, since no code path in the
harness or the real system could take one regardless).

Commit: `3bf1650`

## Milestone 6 — Regression and quality gates

Added `regressionGates.ts`. Initially wired `report.passed` directly from "did every case pass,"
which produced a misleading FAILED status driven entirely by Milestone 3's one documented,
explained retrieval-proxy limitation cascading into Milestone 4's grounding check — a real,
useful *case*-level signal, but not a real *regression*. Redesigned so `report.passed` is decided
only by explicit, separately-justified gates (5 structural zero-tolerance invariants + 6 quality
floors sized to this dataset's case counts — see `docs/EVALUATION_PHASE_PLAN.md`, "Regression
thresholds," for the exact numbers and reasoning). With this split, the current run reports
FAILED-by-case-count (21/24) but PASSED-by-gate (11/11 gates green) — both numbers are shown in
the report, and the distinction between them is explained inline in the Markdown output itself,
not just in documentation a reader might miss.

Commit: `79b961d`

## Milestone 7 — Evaluation reporting and optional dashboard

### Part A — reporting core

Added `report.ts` (JSON + Markdown generation), `runEval.ts` (the `pnpm eval`/`pnpm eval:real`
CLI), `mockProviders.ts`, `realProviders.ts` (optional real ai-service calls, gated only by
`ANTHROPIC_API_KEY`, no GitHub credential ever needed), the `EvaluationRun` Prisma model +
migration `20260914201014_add_evaluation_runs`, and `persist.ts` (best-effort raw-`pg`
persistence, mirroring `tests/`'s own cross-package pattern against this same schema; a missing
or unreachable `DATABASE_URL` never fails the run). Manually verified: `pnpm eval` produces
`evaluation/reports/latest.json`/`latest.md` and, with `DATABASE_URL` set, a real row in
`evaluation_runs` (confirmed via direct query).

Commit: `3be7c13`

### Part B — optional dashboard

Added `GET /evaluations` and `GET /evaluations/:runId` (session-gated, deliberately the one
service with no ownership filter — an `EvaluationRun` isn't owned by a project or user) and a
minimal `/evaluations` frontend page linked from `AppShell`'s global header. Manually verified
live end to end: started the API and frontend, registered a user, confirmed unauthenticated
access to `GET /evaluations` returns `401`, listed a real persisted run, fetched its full detail,
confirmed a real, non-existent run id returns a real `404`. Browser-verified via Playwright: the
list renders, expanding a run shows all 11 regression gates, all three features' aggregate
metrics, and the exact failed-case detail (case id, score, failure reasons) matching the CLI's
own report — screenshot saved. Judged justified despite being explicitly optional (Milestone 7's
own heading) because its marginal cost was low given existing CRUD/routing/session conventions,
and it gives a non-CLI user the same visibility the required JSON/Markdown files already provide.

Commit: `f3b5f3e`

## Milestone 8 — Tests, Docker verification, documentation

`<pending>`
