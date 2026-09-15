# DevForge Phase 11 (Evaluation, Quality Measurement & Review Improvements) — Implementation Plan

## Scope

In scope: a repeatable, deterministic-by-default evaluation system that measures Phase 8
retrieval, Phase 9 Codebase Q&A, and Phase 10 AI Code Review against a small, version-controlled
fixture dataset — recall/precision/MRR for retrieval, grounding/citation quality/answer quality
for Q&A, finding precision/recall/false-positive rate/severity-category accuracy for review — and
reports results as JSON + Markdown (and, optionally, a minimal read-only dashboard). This phase
measures and reports; it does not add new AI capabilities, modify production retrieval/Q&A/
review behavior, or change what those features are allowed to do.

Out of scope (explicitly, per the task): automatic code modification, execution, GitHub actions,
pull-request creation, or autonomous agents — the evaluation harness itself never calls a GitHub
write API, never executes model-suggested code, and never modifies a repository. VoxMind is
untouched.

## Inspection notes (Milestone 1)

Before designing anything, the following were re-read/re-verified against their actual current
implementation (not assumed from memory):

- **Phase 8 retrieval** (`api/src/services/retrieval.ts`): `search(ownerId, projectId, input)`
  is the single retrieval entry point every downstream feature already reuses; its `SearchResult`
  shape (`chunkId, filePath, symbolName, symbolType, content, startLine, endLine, language,
  branch, commitSha, score`) is what this phase's retrieval evaluator's own `RankedChunk` type
  deliberately mirrors.
- **Phase 9 Q&A** (`api/src/services/qa.ts`, `ai-service/app/agents/qa/`): the citation-safety
  design — a model can only *select* a numbered source, never emit a path/symbol/line itself —
  is the exact mechanism this phase's Q&A/review evaluators check for (`invalidCitationRate`,
  `citationValidityRate`).
- **Phase 10 review** (`api/src/services/codeReview.ts`, `ai-service/app/agents/review/`): the
  finding schema (`title, description, severity, category, confidence, recommendation,
  cited_source_numbers`) is what this phase's `MockFinding`/review-evaluator types mirror
  directly, field for field.
- **Shared source-selection** (`api/src/lib/qaSourceSelection.ts`): `MAX_SOURCES = 8`,
  `MAX_CONTEXT_CHARS = 16_000` — reused as this phase's own `contextSizeCompliant` check's
  budget, not re-derived.
- **Existing test fixtures**: `api/src/routes/qa.test.ts` and `codeReview.test.ts`'s
  mocked-`fetch`-in-real-call-order technique (see those files) is the same technique this
  phase's own `realProviders.ts` follows for optional real-provider calls — a real, unmocked
  HTTP call to a real endpoint, never a fabricated success.
- **Docker/environment**: `docker-compose.yml`'s `ANTHROPIC_API_KEY`/`VOYAGE_API_KEY` optional
  pass-through pattern is reused unchanged — this phase adds no new environment variable.
- **Project/branch/commit models**: `Project`, `RepositoryConnection`, `CodebaseIndex` all exist
  to scope a *real, connected* repository. The evaluation dataset deliberately does not use any
  of them (see "Evaluation dataset" below) — evaluation never creates a `Project`, a
  `RepositoryConnection`, or a `CodebaseIndex` row, and never calls the GitHub API at all.
- **API/frontend conventions**: `{ data }`/`{ error: { code, message, details? } }` envelope,
  session-gated routes, `AppShell`-wrapped pages — followed unchanged for the one new,
  deliberately minimal API surface this phase adds (see "Reporting").
- **Logging/error handling**: the centralized Express error handler already strips internal
  detail from client-facing errors; this phase's own report-generation code independently scans
  its own output for secret-shaped strings before it's ever written or persisted (see "Security
  and privacy constraints").

## Evaluation goals

Measure, on a fixed, reproducible fixture dataset, without requiring a paid Voyage AI or
Anthropic credential to run:

1. Retrieval relevance (does the right evidence get surfaced, and how highly ranked is it).
2. Q&A grounding (are answer claims actually supported by retrieved evidence, are citations
   valid and complete).
3. Code review finding accuracy (precision, recall, false-positive rate, severity/category
   correctness, duplicate/empty-review correctness).
4. Regression: a fixed, documented set of pass/fail gates that catch an actual regression in any
   of the above without requiring every fuzzy quality metric to be numerically perfect.

## Evaluation dataset

A small, **fully synthetic, self-contained fixture "repository"** — 9 real, hand-authored
TypeScript files under `evaluation/src/dataset/fixtures/` (never copied from a real project,
never touching VoxMind, no credentials, no personal data) — is used instead of a real connected
GitHub repository. This is a deliberate architectural choice, not a shortcut:

- Phase 9/10's own `/qa/answer` and `/review/analyze` `ai-service` endpoints already accept an
  arbitrary, caller-supplied numbered source list directly — they do not require a real indexed
  repository. This means Q&A/review evaluation (including the optional real-provider mode) can
  call the real agents directly, exercising the exact same provider/prompt/schema code real
  users hit, **without needing a real GitHub-connected `Project`/`RepositoryConnection`/
  `CodebaseIndex` at all** — no GitHub credential is ever needed for evaluation, not even in
  real-provider mode.
- A fixed fixture, not a real (possibly-changing) public GitHub repo, is what makes ground truth
  actually stable — a case's `expectedChunkIds` never silently goes stale because someone pushed
  a commit to the real repo the dataset pointed at.
- Chunk boundaries in the dataset are **hand-authored ground truth**, deliberately not produced
  by running Phase 7's tree-sitter parser or Phase 8's `chunkFile()` against the fixture files —
  so a future change to either doesn't silently invalidate this dataset's own expectations. (A
  brief authoring note: the dataset's two whole-file chunks originally included each file's
  shared, generic boilerplate header comment; that generic English prose was found to dominate
  lexical-similarity ranking for unrelated queries under the deterministic embedding described
  below, so those two chunks' line ranges were trimmed to exclude it — consistent with how every
  other chunk in the dataset already excludes its own file's header. This is documented here
  because it is exactly the kind of dataset-authoring detail Milestone 2 asks not to silently
  fabricate away.)

The dataset covers, across 16 chunks in 9 files: authentication/session handling, database
access, an API controller, error handling, configuration loading, GitHub-integration-flavored
code, service-to-service communication, and two "no meaningful finding" files (one entirely
clean, one containing an embedded prompt-injection attempt in a comment with otherwise ordinary
code) — directly matching the task's own required category list. Every file that demonstrates a
flaw also contains a second, correct sibling function, so "knows the safe pattern too" is part
of the ground truth, not just "knows the bug."

## Ground-truth format

Three case arrays, each with stable, never-renumbered string ids (`retrieval-password-check`,
`qa-sql-injection`, `review-auth-security`, etc. — see `evaluation/src/dataset/*.ts`):

- **Retrieval cases**: `{ id, query, expectedChunkIds, acceptableAlternativeChunkIds, notes }`.
- **Q&A cases**: `{ id, question, expectedAnswerPoints, requiredEvidenceChunkIds,
  forbiddenClaims, insufficientEvidenceExpected, mockAnswer }`.
- **Review cases**: `{ id, scope, relevantChunkIds, expectedFindings, knownNonFindings, notes,
  mockFindings }`, where each `expectedFindings` entry is `{ id, description, category,
  severityRange, expectedSourceChunkId, keywords }`.

`mockAnswer`/`mockFindings` are the deterministic, credential-free stand-in each case's own
evaluator scores by default — see "Deterministic mock-provider strategy" below.

## Retrieval metrics

`recallAtK`/`hitRate`, `meanReciprocalRank`, `precisionAtK` (over `expectedChunkIds` ∪
`acceptableAlternativeChunkIds`), `emptyResultRate`, `duplicateSourceCaseRate`,
`contextSizeCompliant` (every result's combined content stays within `MAX_CONTEXT_CHARS =
16,000`, Phase 9's own real budget). `K = 5` (see `evaluation/src/evaluators/
retrievalEvaluator.ts`'s own comment for why, relative to this dataset's 16-chunk size).

## Q&A metrics

**Grounding**: `citationRecall` (required evidence actually cited), `invalidCitationRate`
(cited something outside what retrieval actually returned for that question — see "Regression
thresholds" for why this is a quality floor, not a zero-tolerance gate, in mock mode),
`missingCitationRate`. **Answer quality**: `expectedPointCoverage` (loose keyword-presence
check against `expectedAnswerPoints`), `unsupportedClaimRate` (keyword-presence check against
`forbiddenClaims`), `insufficientEvidenceAccuracy`.

## Code-review metrics

`findingPrecision`, `findingRecall`, `falsePositiveRate`, `duplicateFindingRate`,
`citationValidityRate` (every finding's citation is within that case's real evidence set —
zero-tolerance, unlike Q&A's, since review's ground truth for "real evidence" is the case's own
`relevantChunkIds`, not this package's separate retrieval-ranking proxy — see
`evaluation/src/evaluators/reviewEvaluator.ts`), `categoryAccuracy`, `severityAccuracy` (both
computed only over matched findings, not gating the match itself, so a correct finding phrased
differently or with an arguable severity still counts as *found* — see "Scoring rules"),
`confidenceCalibrationProxy` (explicitly documented as weak — see "What cannot be measured
reliably"), `emptyReviewCorrectness`.

## Scoring rules

A candidate finding is matched to an expected finding by **citation + loose keyword overlap in
its title/description** — deliberately never by exact wording, category, or severity, per the
task's "do not penalize the model merely for using different wording" instruction. Category and
severity correctness are scored as separate accuracy dimensions over already-matched findings,
not as match-gating conditions — this is what lets `categoryAccuracy`/`severityAccuracy` carry
real signal instead of being trivially 100% by construction. Two findings are flagged as
duplicates when they share a category, share at least one cited source, and their titles' word
sets overlap by 50% or more (see `findingsAreDuplicates()`) — a real if imperfect heuristic, not
an exact-string check, documented as such.

## Human-review requirements

None of this phase's scoring is blocking-only-on-a-human — every metric is computed
automatically and deterministically in mock mode. A human is expected to read a **failed**
report's per-case detail (case id, failure reasons, expected vs. actual) to judge whether a
regression-gate failure reflects a real product regression or a dataset/evaluator issue — the
same way a failed CI test is triaged, not a formal sign-off gate this phase implements in code.

## Deterministic mock-provider strategy

Two independent deterministic layers, used together by default (`pnpm eval`, no `--real` flag,
no credentials read or required):

1. **Retrieval**: `evaluation/src/deterministicEmbedding.ts` — character-n-gram (n = 3, 4, 5)
   hashing/shingling, a standard lexical-similarity technique (same family as MinHash/SimHash),
   L2-normalized, ranked by cosine similarity. Character n-grams (not word tokens) were chosen
   specifically because they match a natural-language query word like "password" against a
   camelCase source identifier like `passwordHash` as a substring overlap, without needing a
   real tokenizer/stemmer. This is explicitly documented as **not** a claim of approximating
   Voyage AI's real quality — see "What cannot be measured reliably."
2. **Q&A/review answers**: each dataset case's own hand-authored `mockAnswer`/`mockFindings` —
   not generated by any algorithm, but written once per case to represent "what a well-behaved
   deterministic answer looks like," so the full pipeline (retrieval → evaluator scoring →
   report generation) is exercised end to end, deterministically, on every run, including in CI
   and Docker verification.

## Real-provider evaluation strategy, if supported

Supported, and deliberately narrow in scope: `pnpm eval:real` (`evaluation/src/realProviders.ts`)
calls `ai-service`'s real `/qa/answer` and `/review/analyze` endpoints directly over HTTP, using
this package's own deterministic retrieval ranking to build each request's numbered source list
— the same shape Node's real services build. Gated only by `ANTHROPIC_API_KEY` actually being
configured in the `ai-service` process this calls (checked by that real endpoint itself, the
same honest 503 every other real-provider call in this codebase already returns); never required
for the default run, CI, or Docker verification's automated evaluation step. Real Voyage-backed
retrieval ranking is intentionally **not** wired into this phase — retrieval-ranking quality
(Milestone 3) and provider answer/finding quality (Milestones 4/5) are evaluated as separable
concerns, and the deterministic proxy's job is exactly to keep Milestone 3 measurable without a
Voyage key at all, in both modes.

## Regression thresholds

See `evaluation/src/regressionGates.ts` (the actual source of truth `report.passed` is computed
from — not each case's individual pass/fail). Two groups:

- **Structural, zero-tolerance** (must always hold, in either mode): no invalid review
  citations, no duplicate sources within one retrieval result, every retrieval result within the
  production context-size budget, no secret/token-shaped string anywhere in the report.
- **Quality floors** (loose enough that only a real regression crosses them, given this
  dataset's size — 9 retrieval cases, 6 Q&A cases, 9 review cases with 9 expected findings
  total): retrieval `recallAtK ≥ 75%` (at most 2 of 9 may miss), Q&A `citationRecall ≥ 75%`,
  Q&A `invalidCitationRate ≤ 25%` (see the file's own comment for why this one is a floor, not
  zero-tolerance, in mock mode — it's coupled to the deterministic retrieval proxy's own
  accuracy, not a production citation-safety property, which is independently guaranteed and
  tested in `api/src/services/qa.ts`'s own Supertest suite), Q&A `unsupportedClaimRate = 0`,
  review `findingRecall ≥ 75%`, review `falsePositiveRate ≤ 25%`, review
  `emptyReviewCorrectness = 100%`.

These are not arbitrary: each threshold is picked so that this dataset's own known, documented
limitation (one retrieval case whose deterministic-proxy ranking genuinely misses — see
"Evaluation dataset" above) passes, while a threshold-crossing regression (e.g. review starting
to hallucinate findings on the clean file, or Q&A starting to cite unretrieved evidence on most
cases) would not.

## CI behavior

`pnpm eval` exits 0 when every regression gate passes, 1 otherwise — safe to wire into a CI job
directly without any credential. `pnpm test` (root) now also runs `evaluation`'s own Vitest
suite (dataset schema tests + evaluator unit tests — Milestone 8), which needs no network access
and no database.

## Security and privacy constraints

- The dataset contains no real credentials, no private repository content, no personal data, no
  unlicensed source, and never touches VoxMind — every fixture file's header comment says so
  explicitly and is itself checked by a dataset test (Milestone 8).
- `regressionGates.ts`'s secret-pattern scan runs over the **entire serialized report** (not
  just specific fields) before any report is written to disk or persisted to the database — a
  defense-in-depth check, not the only one, since neither the mock nor real provider path ever
  handles a real GitHub token or Anthropic key value in the first place (evaluation never
  connects a repository, and `realProviders.ts` never logs or returns the `ANTHROPIC_API_KEY` it
  implicitly relies on `ai-service` already having).
- The optional `EvaluationRun` database persistence step and its read-only API/frontend page
  (see "Reporting") never expose anything beyond the same aggregate/per-case data already in the
  JSON/Markdown report — no environment variable, no raw provider error, no stack trace.

## What cannot be measured reliably

Documented explicitly, not glossed over:

- The deterministic embedding is a lexical-overlap proxy, not a semantic one — it can rank a
  well-written, more verbose *correct* answer's supporting code below a less-related chunk that
  happens to share more surface vocabulary with the query (this is exactly what happened during
  dataset authoring for one retrieval case — see "Evaluation dataset"). A passing/failing score
  against this proxy is not a measurement of Voyage AI's real retrieval quality.
- `expectedAnswerPoints`/`forbiddenClaims` matching is case-insensitive substring search, not
  real semantic entailment — a correct answer phrased differently can register as missing a
  point, and a forbidden phrase appearing inside an unrelated sentence can register as a false
  violation.
- Review finding matching's keyword-overlap heuristic can both under-match (a correct finding
  phrased with none of the listed keywords) and over-match (an unrelated finding that happens to
  share a keyword and cites the same chunk).
- `confidenceCalibrationProxy` is explicitly weak: it only checks whether a *matched* finding's
  self-reported confidence was at least "medium," which is not a real calibration curve (it
  would need a much larger, human-labeled dataset with many findings per confidence bucket to
  measure true calibration, which this phase's small, hand-authored dataset cannot provide).
- False-negative risk (an issue that exists in real code but this dataset never poses a question
  or review scope about) is not measurable by construction — a fixed dataset can only tell you
  about the cases it contains.
- None of this evaluates DevForge against real, large, unfamiliar codebases — only this small,
  hand-authored fixture. A passing report is evidence of no regression against *this* dataset,
  not a general quality guarantee.

## Reporting

Every run produces `evaluation/reports/latest.json` (full report: aggregate + every per-case
result + regression gate results + dataset/evaluator version + git commit + timestamp) and
`evaluation/reports/latest.md` (the same, rendered for humans) — required, and the only
artifacts CI or a developer strictly needs. A minimal, deliberately small **optional** dashboard
is also added (see Milestone 7's own heading — "Optional Dashboard" — and its hedged "if a
frontend view is added" framing): a new `EvaluationRun` table (not project-scoped — the dataset
is a fixed fixture independent of any user's repository, so scoping it under
`/projects/:id/evaluations` as suggested would misrepresent what's being measured), a
`GET /evaluations` + `GET /evaluations/:id` read-only, session-gated API, and a
`/evaluations` frontend page (linked from `AppShell`'s global header, not a project's own nav,
for the same reason). This was judged justified despite being explicitly optional because its
marginal cost is low given this codebase's existing CRUD/routing/session conventions, and it
gives a non-CLI user visibility into the same data the required JSON/Markdown files already
contain — never a "complex analytics system."

## Milestones

1. Planning (this document) and architecture inspection.
2. Evaluation dataset and ground truth (`evaluation/src/dataset/`).
3. Retrieval evaluation harness (`evaluation/src/evaluators/retrievalEvaluator.ts`,
   `deterministicEmbedding.ts`).
4. Codebase Q&A evaluation (`evaluation/src/evaluators/qaEvaluator.ts`).
5. Code review evaluation (`evaluation/src/evaluators/reviewEvaluator.ts`).
6. Regression and quality gates (`evaluation/src/regressionGates.ts`).
7. Evaluation reporting (`evaluation/src/report.ts`, `runEval.ts`, `persist.ts`,
   `realProviders.ts`, the `EvaluationRun` migration) and the optional dashboard (API + frontend).
8. Tests (dataset/evaluator/integration), Docker verification, documentation.
