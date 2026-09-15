# DevForge evaluation

Phase 11: measures Phase 8 retrieval, Phase 9 Codebase Q&A, and Phase 10 AI Code Review against
a small, version-controlled fixture dataset — deterministically, by default, with no paid
credential required. See [docs/EVALUATION_PHASE_PLAN.md](../docs/EVALUATION_PHASE_PLAN.md) for
the full design and [docs/EVALUATION_PHASE_PROGRESS.md](../docs/EVALUATION_PHASE_PROGRESS.md)
for the verified build/verification log. This package **measures and reports** — it never
modifies retrieval/Q&A/review behavior, never calls a GitHub API (read or write), and never
executes model-suggested code.

## Running it

```bash
pnpm install         # once, from the repo root

pnpm eval             # deterministic, no credentials, no network — the default
pnpm eval:real        # optional: calls ai-service's real /qa/answer and /review/analyze
                       # (needs a running ai-service with ANTHROPIC_API_KEY configured;
                       # AI_SERVICE_URL defaults to http://localhost:8001)

pnpm --filter @devforge/evaluation test        # this package's own unit tests
```

Every run writes `evaluation/reports/latest.json` and `evaluation/reports/latest.md` (git-
ignored — regenerated on each run, not committed) and, if `DATABASE_URL` is set and reachable,
best-effort persists a summary row for the optional `/evaluations` dashboard page. Exit code is
`0` when every regression gate passes, `1` otherwise — safe to wire into CI directly.

## What's measured

- **Retrieval** (`src/evaluators/retrievalEvaluator.ts`): recall@K, hit rate, mean reciprocal
  rank, precision@K, empty-result rate, duplicate-source rate, context-size compliance — against
  a deterministic character-n-gram embedding proxy (`src/deterministicEmbedding.ts`), not real
  Voyage AI.
- **Codebase Q&A** (`src/evaluators/qaEvaluator.ts`): citation precision/recall, invalid- and
  missing-citation rates, expected-answer-point coverage, unsupported-claim rate, insufficient-
  evidence accuracy.
- **AI Code Review** (`src/evaluators/reviewEvaluator.ts`): finding precision/recall, false-
  positive rate, duplicate-finding rate, citation validity, category/severity accuracy, a
  (explicitly weak) confidence-calibration proxy, empty-review correctness.

## Dataset

`src/dataset/fixtures/` — 9 real, hand-authored TypeScript files (never copied from a real
project, no credentials, no VoxMind content) forming a small synthetic "repository," chunked by
hand into 16 chunks with verified line ranges (`fixtureRepo.ts`). Ground truth lives in
`retrievalCases.ts`/`qaCases.ts`/`reviewCases.ts`, each case with a stable id. See
`docs/EVALUATION_PHASE_PLAN.md`'s "Evaluation dataset" section for why this is a fixed fixture
rather than a real connected GitHub repository.

## Regression gates vs. golden-dataset cases

`report.passed` (and the CLI's exit code) is decided by `src/regressionGates.ts` — a fixed set
of structural invariants and quality floors — **not** by whether literally every dataset case
matched its exact expectation. A case can legitimately show as failed (with its full reason
printed) without failing the run; see `docs/EVALUATION_PHASE_PLAN.md`'s "Regression thresholds"
for why, and the report's own "Regression gates" section for which checks actually gate pass/
fail.

## Known limitations

The deterministic embedding is a lexical-overlap proxy, not a semantic one — a passing/failing
score against it is not a measurement of Voyage AI's real retrieval quality. `expectedAnswerPoints`/
`forbiddenClaims`/finding-keyword matching are substring/keyword heuristics, not semantic
entailment. `confidenceCalibrationProxy` is explicitly weak. None of this evaluates DevForge
against real, large, unfamiliar codebases — only this small, hand-authored fixture. See
`docs/EVALUATION_PHASE_PLAN.md`'s "What cannot be measured reliably" for the full list.
