# DevForge Phase 13 (Benchmark Expansion, Relevance Calibration, and Retrieval Validation) — Plan

## Scope

Phase 12 improved retrieval/grounding/review quality against a small benchmark (9 retrieval
cases, 6 Q&A cases, 9 review cases, 16 chunks, 9 TypeScript files). That benchmark was adequate
to diagnose and fix Phase 11's specific defects, but it is too small and too uniform to tell
whether the resulting metrics (precision@K 55.7%, recall@K 100%, MRR 82.1%) reflect real
retrieval quality or an artifact of a benchmark with few chunks, one language, and almost
entirely binary relevance. Phase 13 does not change any production ranking/grounding code — it
inspects the existing evaluator and pipeline, then expands and strengthens the benchmark itself,
so Phase 14 has a real, validated baseline to improve against.

## Existing benchmark limitations (inspection findings)

Read in full before writing this plan: `evaluation/src/dataset/{retrievalCases,qaCases,
reviewCases,fixtureRepo,version}.ts`, `evaluation/src/evaluators/*.ts`,
`evaluation/src/{deterministicEmbedding,hybridScore,diagnostics,regressionGates,report,runEval,
mockProviders,realProviders,persist,types}.ts`, `api/src/services/{retrieval,qa,codeReview,
codebaseIndex}.ts`, `api/src/lib/{hybridScore,chunking,qaSourceSelection,
reviewFindingFiltering,retrievalDiagnostics}.ts`, `api/src/schemas/retrieval.ts`,
`api/prisma/schema.prisma` and all 11 migrations, `ai-service/app/parsing/parser.py`,
`frontend/src/pages/Evaluations.tsx`.

1. **Size**: 9/6/9 cases, 16 chunks. Too small to reliably distinguish a genuine ranking
   improvement from noise, and too small to report meaningful per-category/per-language/
   per-difficulty breakdowns (most categories would have n=1).
2. **Language**: 100% TypeScript. `ai-service/app/parsing/parser.py` already parses Python,
   TypeScript, and JavaScript via three separately-installed tree-sitter grammars
   (`tree-sitter-python`, `tree-sitter-javascript`, `tree-sitter-typescript`) — confirmed by
   reading `EXTENSION_LANGUAGES` and `_tree_sitter_language()` directly, not assumed. The
   benchmark exercises none of this real, already-shipped multi-language support.
3. **Relevance model**: `RetrievalCase` has exactly two buckets — `expectedChunkIds` (must
   appear) and `acceptableAlternativeChunkIds` (must not be penalized). There is no distinction
   between "this chunk directly answers the query" and "this chunk is useful supporting context
   but not itself the answer" — every chunk in a result set is implicitly graded pass/fail
   against the same two sets, which cannot express partial usefulness or measure nDCG.
4. **Query variety**: query categories are ad hoc (each case has a free-text `notes` field, no
   `category` field at all) — there's no way to compute or report per-category metrics today,
   and several categories the task requires (cross-file dependency, imported-function, data-flow,
   parent-symbol, neighboring-symbol, config, tests, auth/authz as its own category distinct from
   the two auth cases already present) have zero dedicated cases.
5. **No benchmark quality checks**: nothing validates that every `expectedChunkIds` entry
   actually exists in `FIXTURE_CHUNKS`, that ids are unique, that an "insufficient evidence" case
   doesn't accidentally have real evidence, etc. `dataset.test.ts` checks some of this today (18
   tests) but not the graded-relevance-consistency or category/language-label checks Phase 13
   requires.
6. **No human-reviewable per-case report**: `retrievalEvaluator.ts`'s `CaseResult.actual` carries
   ranked ids and scores, but nothing renders a readable, side-by-side view of expected-vs-
   returned-vs-score-breakdown a developer could use to tell a ranking bug from a bad label.
7. **No adversarial "hidden" fixture**: the existing adversarial cases (Phase 12, Milestone 6)
   live in the *same* fixture files graded by the *same* evaluator that was just tuned against
   them — a real anti-overfitting check needs a fixture with different names/structure that the
   ranking code has never been tuned against, evaluated the same way.
8. **No performance baseline**: no latency, throughput, or resource measurement exists anywhere
   in `evaluation/`. Phase 12's own completion report explicitly deferred this ("Performance
   impact" section reasoned about it qualitatively, never measured it).

## New benchmark design

- **Retrieval**: ≥60 cases (target: all 25 categories listed in the task, each with at least 2
  cases, drawn across the three languages).
- **Q&A**: ≥20 cases, including the existing insufficient-evidence pattern plus new adversarial
  grounding cases (conflicting evidence, multiple valid sources, overconfident-answer detection).
- **Review**: ≥20 cases, including the existing empty-review/malicious-scope patterns plus new
  cases (multi-source findings, additional suspicious-but-valid code).
- **Files**: ≥30 fixture source files across `typescript/`, `javascript/`, and `python/`
  subdirectories of `evaluation/src/dataset/fixtures/`, each hand-authored for this dataset
  (never copied from a real project, no credentials, no VoxMind content — same rule Phase 11/12
  followed).
- **Chunks**: hand-authored ground truth in `fixtureRepo.ts`, same convention as Phase 11/12 (not
  produced by the real `chunkFile()`/tree-sitter pipeline, for the same stability reason
  documented there — a change to the real chunker must not silently invalidate ground truth).

## Relevance-labeling strategy

`RetrievalCase` gains new **optional** fields (backward compatible — every Phase 11/12 case keeps
working unchanged, since `expectedChunkIds`/`acceptableAlternativeChunkIds` remain and keep their
exact existing meaning):

- `directSourceChunkIds?: string[]` — relevance grade 2 ("directly answers the query"). Defaults
  to `expectedChunkIds` when omitted, so every existing case is automatically graded.
- `supportingSourceChunkIds?: string[]` — relevance grade 1 ("useful context, not itself the
  answer"). Defaults to `acceptableAlternativeChunkIds` when omitted.
- `irrelevantExampleChunkIds?: string[]` — explicit grade-0 examples for a case where it's useful
  to assert a specific chunk must NOT be treated as relevant (defaults to `[]`).
- `category`, `language`, `difficulty` ("easy" | "medium" | "hard"), `answerable: boolean`,
  `requiresCrossFileContext: boolean`, `expectedMinEvidence: number`, `expectedMaxUsefulContext:
  number` — all new, all with safe defaults for legacy cases so `dataset.test.ts`'s existing 18
  tests and every Phase 11/12 case need zero edits.

This graded model lets `evaluateRetrieval()` compute nDCG@5 (using gains 2/1/0), direct-hit rate
(fraction of cases whose *first* returned result is a grade-2 source), and useful-context rate
(fraction of returned results that are grade ≥1, not grade-0 noise) without breaking any existing
consumer of `RetrievalCase`/`CaseResult`.

## Anti-overfitting controls

1. All adversarial-style cases (similar identifiers, same-name-different-file, misleading
   filenames, vague wording, spelling/casing differences, short vs. long queries, irrelevant
   comments containing query terms, tests mentioning but not implementing a symbol) are added to
   `retrievalCases.ts`/`fixtureRepo.ts` in the **same commit as the chunking/ranking code they
   exercise, never as a follow-up tuning pass** — Phase 12's own methodology (write the
   adversarial case after implementation is *finalized*, verify it passes without any new
   dataset-specific branching).
2. A **hidden-style fixture** — `evaluation/src/dataset/fixturesHidden/` — with its own small
   set of files, its own chunk ids, and its own case ids, structurally unrelated to the main
   fixture (different domain: a small inventory/orders system rather than an auth/API backend).
   Graded by the exact same `rankChunks()`/`evaluateRetrieval()` code path, included in the same
   `RETRIEVAL_CASES` array (not a special code path) — its only distinguishing property is that
   it was authored after all Phase 13/14 ranking work was finalized.
3. `evaluation/src/dataset/benchmarkAudit.ts` (Milestone 13.4) programmatically checks for the
   forms of accidental overfitting a manual review could miss: an expected chunk id that doesn't
   exist, a duplicate case id, an unanswerable case with real evidence, relevance-label
   inconsistency (a chunk listed as both direct and irrelevant).
4. Production/evaluation ranking code is grep-audited (Milestone 13.6) to confirm it contains no
   case id, chunk id, or fixture file path as a literal string anywhere in `api/src/lib/
   hybridScore.ts`, `api/src/services/retrieval.ts`, or their `evaluation/` mirrors — this was
   already true after Phase 12 and Phase 13 keeps it true by construction (new cases are added to
   the dataset, never to the ranking code).

## Target metrics (Phase 13/14 preferred goals — see the task's own "Revised quality targets")

Recall@5 ≥95%, Recall@3 ≥85%, MRR ≥85%, nDCG@5 ≥85%, Precision@1 ≥85%, Precision@3 ≥75%,
Precision@5 ≥70%, direct-hit rate ≥90%, useful-context rate ≥90%, duplicate-result rate ≤2%,
empty-result rate for answerable queries ≤5%, false-confidence rate 0%. Grounding: invalid
citations 0%, unsupported claims 0%, Q&A grounding failure rate 0%, review findings without valid
evidence 0%, fabricated source metadata 0%. These are **engineering targets**, not permission to
adjust the benchmark until they pass — if the expanded, harder benchmark shows a target is not
met, Phase 13's own reports say so plainly (case id, metric, expected, actual, root cause) and
Phase 14 addresses only the changes the diagnostic evidence actually justifies.

## Latency methodology

A reproducible, labeled benchmark (`evaluation/src/perf/`) measuring: (1) in-process ranking
latency (`rankChunks()`/`selectRankedResults()` equivalent) over the expanded fixture at p50/p95/
p99, run cold (first call) and warm (after JIT warmup) — cheap, deterministic, CI-safe; (2) where
a running Docker stack is available, live end-to-end `POST /search` latency against the real API
+ Postgres, at small/medium fixture sizes, explicitly labeled as measuring *this fixture's* scale,
never claimed as a production/at-scale number. Indexing throughput (files/sec, chunks/sec) is
measured against `chunkFile()` directly (pure, no network) with synthetic generated file content
at several sizes, plus a live indexing run against the Docker stack for one real measurement.

## Regression policy

Phase 13 adds cases and metrics; it does not relax `regressionGates.ts`. Any new gate added must
be tightenable evidence, never loosened. Because the expanded, harder, more adversarial dataset
will likely show *lower* raw percentages than Phase 12's small, now-somewhat-easy dataset (more
categories, more languages, more deliberately hard cases), Phase 13's benchmark-expansion commits
do **not** by themselves change `regressionGates.ts` — gate thresholds are only revisited in Phase
14 once real, diagnosed improvements are implemented against the new baseline, exactly as Phase
12 only tightened gates in its own Milestone 6, after Milestone 3's fix was measured.

## Expected implementation order

13.1 (this plan) → 13.2 (expand fixtures/cases) → 13.3 (graded relevance + new metrics) → 13.4
(benchmark audit) → 13.5 (human-reviewable report) → 13.6 (adversarial + hidden fixture) → 13.7
(performance baseline) → Phase 14 (diagnose → hybrid ranking → chunk/context → incremental
indexing → observability → Q&A/review grounding validation → full regression).

## Non-goals (unchanged from Phase 12, reaffirmed)

No vector database, no pgvector without a documented/tested reason, no autonomous code
modification/execution/commits/PRs, no dataset-specific hardcoding in production code, no
weakening of the evaluator or its thresholds, no change to VoxMind, no work beyond Phase 14.
