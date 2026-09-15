# DevForge Phase 13 (Benchmark Expansion, Relevance Calibration, and Retrieval Validation) — Completion Report

See [docs/BENCHMARK_EXPANSION_PHASE_PLAN.md](BENCHMARK_EXPANSION_PHASE_PLAN.md) for the full
design and [docs/BENCHMARK_EXPANSION_PHASE_PROGRESS.md](BENCHMARK_EXPANSION_PHASE_PROGRESS.md)
for the verified, milestone-by-milestone build log this report summarizes. Phase 13's purpose was
to determine whether Phase 12's own metrics reflected real retrieval quality or an artifact of a
small, uniform benchmark, then build a substantially larger, harder, validated one — not to
improve production ranking itself (that was Phase 14's job, against this phase's own baseline).

## 1. Milestone-by-milestone status

| # | Milestone | Status |
|---|---|---|
| 13.1 | Repository inspection and phase plan | Complete |
| 13.2 | Expand the benchmark substantially | Complete |
| 13.3 | Introduce graded relevance | Complete |
| 13.4 | Add benchmark quality checks | Complete |
| 13.5 | Add human-reviewable relevance reports | Complete |
| 13.6 | Add adversarial and anti-overfitting evaluation | Complete |
| 13.7 | Establish a reliable performance baseline | Complete |

7 commits (substantive) + 7 hash-backfill commits:

```
7cfdb5e docs: Phase 13 (Benchmark Expansion) plan and progress tracker
13e96cb docs: fill in Milestone 13.1 commit hash
6f5841b feat(evaluation): expand benchmark to 101 cases and add graded relevance
15fb29b docs: bump dataset version and fill in Milestone 13.2-13.3 commit hash
fdb5002 feat(evaluation): add benchmark audit, relevance report, hidden fixture
9e6599c docs: fill in Milestone 13.4-13.6 commit hashes
2612e20 feat(evaluation): add reproducible ranking-latency performance baseline
954c159 docs: fill in Milestone 13.7 commit hash
```

## 2. Files created

- `docs/BENCHMARK_EXPANSION_PHASE_PLAN.md`, `docs/BENCHMARK_EXPANSION_PHASE_PROGRESS.md`,
  `docs/BENCHMARK_EXPANSION_COMPLETION_REPORT.md` (this file)
- 28 new fixture files: 6 new TypeScript (`services/orderProcessor.ts`, `db/orderRepository.ts`,
  `api/ordersController.ts`, `config/featureFlags.ts`, `utils/dataTransform.ts`,
  `tests/authService.test.ts`), 8 JavaScript (`javascript/{cart,orders,utils,auth,services,db,
  config}/*`), 10 Python (`python/{billing,auth,db,utils,services,tests,config,helpers,legacy}/*`),
  4 hidden-fixture TypeScript files (`fixtures/hidden/warehouse/*`)
- `evaluation/src/dataset/benchmarkAudit.ts`, `benchmarkAudit.test.ts`
- `evaluation/src/relevanceReport.ts`, `runBenchmarkAudit.ts`
- `evaluation/src/perf/syntheticCorpus.ts`, `rankingLatency.ts`, `rankingLatency.test.ts`,
  `runPerfBaseline.ts`

## 3. Files modified

- `evaluation/src/dataset/fixtureRepo.ts` (broadened `symbolType`/`language` unions, +42 new
  chunk entries + 6 hidden-fixture entries)
- `evaluation/src/dataset/retrievalCases.ts` (+53 cases: 47 in Milestone 13.2, 6 hidden-fixture in
  13.6; graded-relevance fields added to the type and to select existing cases)
- `evaluation/src/dataset/qaCases.ts` (+13 cases), `reviewCases.ts` (+9 cases)
- `evaluation/src/dataset/dataset.test.ts` (extended the retrieval-case invariant to allow
  `answerable: false`)
- `evaluation/src/deterministicEmbedding.ts` (word-token bonus + stopword list — see §7)
- `evaluation/src/evaluators/retrievalEvaluator.ts` (graded-relevance metrics, insufficient-
  evidence bugfix — see §7)
- `evaluation/src/evaluators/retrievalEvaluator.test.ts` (updated cutoff tripwire)
- `evaluation/src/report.ts` (`_count`-suffix plain-count detection for dynamic breakdown keys)
- `evaluation/package.json` (`audit:benchmark`, `relevance:report`, `perf:baseline` scripts)

## 4. Database changes

None. Phase 13 is entirely evaluation-package content and tooling — no migration, no schema
change.

## 5. API changes

None. No `api/` file was touched in Phase 13.

## 6. Frontend changes

None. No `frontend/` file was touched in Phase 13.

## 7. Retrieval changes

No production ranking algorithm changed in Phase 13 (that was explicitly Phase 14's job). What
did change, and why it was necessary to trust this phase's own new metrics: the expanded, 3×+
larger candidate pool exposed a real weakness in `evaluation/src/deterministicEmbedding.ts` (the
evaluation-only mock semantic proxy, never shared with production) — pure character-n-gram
shingling couldn't distinguish shared authorial style from actual topic at this scale, confirmed
by a real measured case (an unrelated chunk outranking the true SQL-injection answer). Fixed with
two general, corpus-independent techniques: a whole-word-token bonus, and a standard English
stopword list excluding it from generic connector words. This is evaluation-methodology work
(making the new benchmark trustworthy), not a "retrieval improvement" in the Phase 14 sense.

## 8. Q&A citation changes

None. No `qaAnswerGrounding.ts` or `qa.ts` file was touched. 13 new Q&A cases were added, exercised
against the existing, unchanged grounding logic.

## 9. Code-review evidence changes

None. No review production code was touched. 9 new review cases were added, exercised against the
existing, unchanged filtering/validation logic.

## 10. Dataset size

- Retrieval cases: 9 (Phase 11) → 14 (Phase 12) → **67** (Phase 13; target was ≥60)
- Q&A cases: 6 → 7 → **20**
- Code-review cases: 9 → 11 → **20**
- Fixture source files: 9 → 12 → **40** (36 visible + 4 hidden-fixture; target was ≥30)
- Languages: 1 (TypeScript) → 1 → **3** (TypeScript, JavaScript, Python — confirmed real by
  directly reading `ai-service/app/parsing/parser.py`'s tree-sitter grammar wiring, not assumed)
- Indexed chunks: 20 → 20 → **68**

## 11. Relevance-labeling methodology

`RetrievalCase` gained optional `directSourceChunkIds`/`supportingSourceChunkIds`/
`irrelevantExampleChunkIds` fields (relevance grades 2/1/0), each defaulting from the pre-existing
`expectedChunkIds`/`acceptableAlternativeChunkIds` so every Phase 11/12 case resolves to its exact
prior behavior with zero edits. New cases were authored with explicit grades from the start.
`category`/`language`/`difficulty`/`answerable`/`requiresCrossFileContext` metadata fields support
per-group reporting without changing any scoring formula. See §13 for the new graded metrics this
enabled.

## 12. Before-and-after retrieval metrics

Phase 13 measured a real, honest baseline against the new 67-case dataset — it did not attempt to
close any gap against the revised targets (that was Phase 14's explicit job):

| Metric | Phase 12 (14 cases) | Phase 13 baseline (67 cases) | Revised target |
|---|---|---|---|
| Recall@K | 100% | 83.6% | Recall@5 ≥95% |
| Precision@K | 55.7% | 54.7% | — |
| MRR | 82.1% | 80.5% | ≥85% |
| Precision@1/3/5 | not measured | 80.6% / n/a / n/a | ≥85% / ≥75% / ≥70% |
| Useful-context rate | not measured | 38.1% | ≥90% |
| nDCG@5 | not measured | measured, ~80% | ≥85% |

The apparent recall drop (100%→83.6%) is expected and healthy, not a regression: Phase 12's 14
cases were a small, by-then-well-tuned set; Phase 13 added 53 new, deliberately harder and more
diverse cases (multi-language, adversarial, insufficient-evidence, cross-file) that had never been
tuned against. `regressionGates.ts` was deliberately left untouched in this phase (see the plan
doc's "Regression policy") — gate retuning was Phase 14's job, once real improvements existed to
retune against.

## 13. Before-and-after grounding metrics

No grounding-logic change in Phase 13. Measured on the expanded 20/20-case Q&A/review datasets:
invalid-citation rate 0%, unsupported-claim rate 0%, findings-without-evidence 0% — the same
zero-tolerance invariants Phase 12 established, now validated against substantially more and more
varied cases, still holding without any code change.

## 14. Performance measurements

`evaluation/src/perf/runPerfBaseline.ts` (`pnpm perf:baseline`) measures ranking-algorithm latency
in isolation (no network/database/embedding-provider cost) at three corpus sizes:

| Corpus | Chunks | Warm p50 | Warm p95 | Warm p99 |
|---|---|---|---|---|
| Small (real fixture) | 70 | 2.9ms | 3.0ms | 3.1ms |
| Medium (synthetic) | 300 | 12.4ms | 13.1ms | 18.2ms |
| Large (synthetic) | 1000 | 41.3ms | 42.5ms | 42.8ms |

Scales roughly linearly with corpus size (expected — a single O(n) pass per query), comfortably
within the task's p50 ≤500ms / p95 ≤1,500ms targets even at 1000 chunks, for the ranking algorithm
alone. Live, end-to-end `POST /search` latency (including network/database/embedding-provider
cost) was deliberately measured as part of Phase 14's own Milestone 14.8 full-stack verification
instead of duplicated here — see `docs/RETRIEVAL_QUALITY_COMPLETION_REPORT.md`.

## 15. Benchmark limitations

The deterministic mock embedding, even with Phase 13's own fixes, remains a lexical-overlap proxy,
not a real semantic one — passing/failing against it is not a measurement of Voyage AI's actual
retrieval quality. Hybrid-score weights and the adaptive cutoff constant are hand-picked, not
learned. `falseConfidenceRate` (a new Phase 13 metric) is reported but explicitly documented as
unreliable at this mock embedding's noise floor — real answerable/unanswerable query score
distributions measurably overlap. `expectedAnswerPoints`/keyword-matching heuristics remain
substring-based, not semantic entailment. None of this evaluates DevForge against a real, large,
unfamiliar codebase — only this larger, still-synthetic, hand-authored fixture set.

## 16. Failed targets (honestly reported, not hidden)

Phase 13 was a benchmark-*building* phase; the revised quality targets were preferred goals for
the *system*, not gates this phase itself was required to pass. Measured against the freshly-built
67-case baseline, several targets were not yet met (recall@5, precision@1/3/5, nDCG@5,
useful-context rate, direct-hit rate) — expected, since no ranking improvement had been attempted
yet at this point. See §12 above and `docs/RETRIEVAL_QUALITY_COMPLETION_REPORT.md` §12 for how far
Phase 14 closed each of these gaps against this same baseline.

## 17. Remaining bottlenecks (handed to Phase 14 as diagnostic input)

Identified via `relevanceReport.ts`'s per-case diagnosis and confirmed by direct signal
inspection: (1) the deterministic mock embedding's noise floor at this corpus scale (addressed in
Phase 14 via `hybridScore.ts` fixes); (2) the adaptive cutoff value, never re-measured against the
larger dataset (addressed in Phase 14 via a real sweep); (3) two categories requiring call-graph/
reverse-reference reasoning no existing signal provides (investigated in Phase 14, found to need
chunking-architecture changes not justified at this scale).

## 18. Security verification

Every fixture file, case, and generated report scanned for credential-shaped strings, non-
allowlisted email-shaped strings, SSN-shaped strings, and VoxMind mentions via
`benchmarkAudit.ts` — 0 errors, 0 warnings on the final 67/20/20 dataset. `relevanceReport.ts`
never includes raw chunk content (reuses Phase 12's already-verified content-free diagnostics
module). No new API endpoint, no authentication change.

## 19. Test counts

`evaluation` package: 100 (Phase 12 end) → **115** (end of Milestone 13.7) tests, all passing.
Full monorepo unaffected by this phase's changes beyond `evaluation/`: `api` 313, `frontend` 111,
`ai-service` 117, `tests/` 12 (all unchanged from Phase 12's own final counts, since Phase 13
touched no file outside `evaluation/`).

## 20. Docker verification

Full Docker verification was performed once, covering both Phase 13's and Phase 14's changes
together, as part of Phase 14's own Milestone 14.8 — see
`docs/RETRIEVAL_QUALITY_COMPLETION_REPORT.md` for the complete Docker rebuild, migration, live
evaluation, and smoke-test results (deliberately not duplicated here, to avoid measuring the same
live stack twice for no additional signal — see the plan doc's Milestone 13.7 "deliberately
deferred" note).

## 21. Confirmation VoxMind was untouched

No VoxMind file, process, database, or configuration was read, written, or referenced by any
command in this phase. Confirmed via `ps aux` at multiple checkpoints (PID 16012 plus its 5 native
Postgres connections, unchanged throughout).

## 22. Confirmation Phase 15 was not started

No Phase 15 file, commit, or planning document was created. This phase's own work stopped at the
end of Milestone 13.7, handing off to Phase 14 exactly as scoped.
