# DevForge evaluation

Phase 11 built this package: measures Phase 8 retrieval, Phase 9 Codebase Q&A, and Phase 10 AI
Code Review against a small, version-controlled fixture dataset — deterministically, by default,
with no paid credential required. Phase 12 used it to diagnose and fix a real retrieval-quality
gap (see `src/hybridScore.ts`/`src/regressionGates.ts` and
[docs/RETRIEVAL_QUALITY_COMPLETION_REPORT.md](../docs/RETRIEVAL_QUALITY_COMPLETION_REPORT.md)
for the full before/after story) and extended the dataset with adversarial cases specifically to
prevent that fix from being overfit to the original fixture. See
[docs/EVALUATION_PHASE_PLAN.md](../docs/EVALUATION_PHASE_PLAN.md) and
[docs/RETRIEVAL_QUALITY_PHASE_PLAN.md](../docs/RETRIEVAL_QUALITY_PHASE_PLAN.md) for the full
design, and [docs/EVALUATION_PHASE_PROGRESS.md](../docs/EVALUATION_PHASE_PROGRESS.md) /
[docs/RETRIEVAL_QUALITY_PHASE_PROGRESS.md](../docs/RETRIEVAL_QUALITY_PHASE_PROGRESS.md) for the
verified build/verification logs. This package **measures and reports** — it never modifies
retrieval/Q&A/review behavior on its own, never calls a GitHub API (read or write), and never
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
  rank, precision@K, empty-result rate, duplicate-source rate, context-size compliance, rank
  distribution (top-1 / top-2-3 / 4-plus-or-missed) — ranked by a deterministic character-n-gram
  embedding proxy (`src/deterministicEmbedding.ts`) re-ranked by the same hybrid semantic+
  lexical+identifier+file-path score and adaptive relative-score cutoff production's
  `api/src/services/retrieval.ts` uses (`src/hybridScore.ts`, mirroring `api/src/lib/
  hybridScore.ts` byte-for-byte) — not real Voyage AI.
- **Codebase Q&A** (`src/evaluators/qaEvaluator.ts`): citation precision/recall, invalid- and
  missing-citation rates, expected-answer-point coverage, unsupported-claim rate, insufficient-
  evidence accuracy, fallback count (how many answers needed the deterministic grounding
  fallback — `src/qaAnswerGrounding.ts`, mirroring production's own), regeneration count
  (always 0 — no regeneration is implemented, by design).
- **AI Code Review** (`src/evaluators/reviewEvaluator.ts`): finding precision/recall, false-
  positive rate, duplicate-finding rate, citation validity, category/severity accuracy, a
  (explicitly weak) confidence-calibration proxy, empty-review correctness.

## Dataset

`src/dataset/fixtures/` — 12 real, hand-authored TypeScript files (never copied from a real
project, no credentials, no VoxMind content) forming a small synthetic "repository," chunked by
hand into 20 chunks with verified line ranges (`fixtureRepo.ts`). Ground truth lives in
`retrievalCases.ts`/`qaCases.ts`/`reviewCases.ts`, each case with a stable id — 32 cases total.
Phase 12 added 8 adversarial cases (similar-symbol disambiguation, the same identifier in two
files, a misleading filename, vague wording, a raw-identifier query, an unanswerable question,
"suspicious but valid" code, and a same-named-but-differently-implemented function) specifically
*after* implementing its own ranking/grounding changes, to check they generalize rather than
being overfit to the original 24 cases. See `docs/EVALUATION_PHASE_PLAN.md`'s "Evaluation
dataset" section for why this is a fixed fixture rather than a real connected GitHub repository,
and `docs/RETRIEVAL_QUALITY_PHASE_PLAN.md`'s "Anti-overfitting strategy" for the adversarial-case
methodology.

## Regression gates vs. golden-dataset cases

`report.passed` (and the CLI's exit code) is decided by `src/regressionGates.ts` — a fixed set
of structural invariants and quality floors — **not** by whether literally every dataset case
matched its exact expectation. A case can legitimately show as failed (with its full reason
printed) without failing the run; see `docs/EVALUATION_PHASE_PLAN.md`'s "Regression thresholds"
for why, and the report's own "Regression gates" section for which checks actually gate pass/
fail.

## Known limitations

The deterministic embedding (even re-ranked by the Phase 12 hybrid score) is a lexical-overlap
proxy, not a semantic one — a passing/failing score against it is not a measurement of Voyage
AI's real retrieval quality. The hybrid-score weights and the adaptive cutoff constant
(`RELATIVE_SCORE_CUTOFF = 0.7`) are hand-picked, not learned. `expectedAnswerPoints`/
`forbiddenClaims`/finding-keyword matching are substring/keyword heuristics, not semantic
entailment. `confidenceCalibrationProxy` is explicitly weak. The Q&A grounding fallback only
catches zero-valid-citation cases — it cannot detect a structurally-valid citation that doesn't
actually support its claim. None of this evaluates DevForge against real, large, unfamiliar
codebases — only this small, hand-authored fixture. See `docs/EVALUATION_PHASE_PLAN.md`'s "What
cannot be measured reliably" and `docs/RETRIEVAL_QUALITY_PHASE_PLAN.md`'s "Risks" for the full
list.
