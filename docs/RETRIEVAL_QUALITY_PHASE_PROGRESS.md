# DevForge Phase 12 (Retrieval Quality & Grounding Improvements) — Progress Log

See `docs/RETRIEVAL_QUALITY_PHASE_PLAN.md` for the full design. This log tracks each milestone's
implementation, verification, and commit hashes as work proceeds.

## Milestone 1 — Repository inspection and phase plan

Re-inspected before writing the plan: `docs/EVALUATION_PHASE_PLAN.md` and
`docs/EVALUATION_PHASE_PROGRESS.md`; `api/src/services/retrieval.ts` (`search()`,
`buildChunksForIndex()`, `ensureEmbeddings()`); `api/src/lib/similarity.ts`,
`api/src/lib/chunking.ts`, `api/src/lib/qaSourceSelection.ts`; `api/src/routes/retrieval.ts`/
`retrieval.test.ts`; `api/src/services/qa.ts`, `ai-service/app/agents/qa/{schemas,provider}.py`;
`api/src/services/codeReview.ts`, `ai-service/app/agents/review/{schemas,provider}.py`,
`api/src/lib/reviewFindingFiltering.ts`; `evaluation/src/dataset/*`,
`evaluation/src/evaluators/*`, `evaluation/src/regressionGates.ts`; the full existing Supertest
suites for retrieval/Q&A/review.

Root causes identified with real measurements, not guesses (full detail in the plan doc):

1. **Retrieval precision@K (28.9%) is mechanically bounded near a ~33.3% ceiling** by `search()`
   always returning exactly `K`/`limit` results regardless of how few chunks are truly relevant
   — confirmed by computing the exact per-case ceiling from the dataset's own relevant-set sizes.
   The measured baseline is already 87% of that ceiling. Primary fix: an adaptive, score-aware
   result count (Milestone 3), not primarily reordering.
2. **MRR losses (66.1%)** trace to two distinct, real causes: acceptable-alternative chunks
   outranking the primary expected chunk on 2 of 9 cases (fixable via identifier/path signals),
   and one case (`retrieval-fire-and-forget-notifications`, ranked 12th of 16) whose only
   distinguishing signal lives in a leading doc comment that Phase 7's own tree-sitter symbol-span
   convention excludes from the chunk entirely — a structural limitation of the *lexical proxy*
   specifically (real Voyage embeddings would very likely catch this via genuine semantic
   similarity), documented as a known, accepted, unfixed case rather than chased with a
   dataset-specific synonym table.
3. **Q&A's 20% invalid-citation rate is mechanically coupled to root cause #2** — the one
   failing case's required evidence *is* the `fire-and-forget` chunk that misses retrieval;
   the citation-safety mechanism itself (structured-output schema, `ai-service`'s provider-level
   filtering, Node's independent re-validation) was re-read and shows no defect. Improving
   retrieval for that one case is the only lever that moves this specific metric; the citation
   layer is still hardened and adversarially tested in Milestone 4 on its own merits.
4. **Code review evidence quality is already at 100% on every metric** — Milestone 5 is
   hardening/adversarial-test coverage, not a defect fix.

Deliverables: `docs/RETRIEVAL_QUALITY_PHASE_PLAN.md`, this progress log.

Commit: `8074b37`

## Milestone 2 — Retrieval diagnostics

Added `hybridScore.ts` (mirrored identically in `api/src/lib/` and `evaluation/src/`): pure
scoring-signal functions — `tokenize()` (camelCase/snake_case/kebab-case-aware word splitting),
`lexicalOverlapScore()`, `identifierMatchScore()`, `exactIdentifierBoost()`,
`filePathMatchScore()`, and `combinedScore()` (fixed, documented weights, semantic score
dominant). Added `retrievalDiagnostics.ts` (api) / `diagnostics.ts` (evaluation): a pure,
rank-ordered per-candidate breakdown with near-duplicate grouping (same file, overlapping
lines), deliberately excluding raw chunk content from its output (verified by a dedicated
"never leaks content" test scanning the serialized output for source text/credential-shaped
strings). Not wired into any HTTP response or ranking behavior yet — Milestone 3 does the
wiring. 28 new tests in each package (56 total). Full suites green: `api` 286 (258 + 28),
`evaluation` 80 (52 + 28).

Commit: `af01e1a`

## Milestone 3 — Retrieval ranking improvements

Wired Milestone 2's hybrid scoring into `search()` (new exported `selectRankedResults()`) and
`evaluation`'s `rankChunks()`: candidates are re-ranked by the combined score, then kept only
while within `RELATIVE_SCORE_CUTOFF = 0.7` of the top result, capped at the caller's limit,
always keeping at least the top-ranked result. `SearchResult.score`/`RankedChunk.score` stay
pure cosine similarity in both packages — confirmed unchanged by running the full existing
`retrieval.test.ts`/`qa.test.ts`/`codeReview.test.ts` Supertest suites (50 cases) with zero
modifications needed.

**Measured impact on the Phase 11 dataset** (before → after): recall@K 88.9% → **100%**, MRR
66.1% → **80.6%**, precision@K 28.9% → **57.6%**. The previously-failing
`retrieval-fire-and-forget-notifications` case (documented in Milestone 1 as a hard case for the
lexical proxy) unexpectedly now succeeds too — the combination of lexical-overlap and file-path
signals was apparently enough to overcome the sibling-chunk crowding, better than anticipated in
the plan doc's more pessimistic prediction. As a direct downstream consequence, Q&A's
invalid-citation rate — mechanically coupled to this exact retrieval case per Milestone 1's
analysis — dropped from 20% to **0%** with no citation-layer code change at all. Golden-dataset
pass rate reached 24/24 after also fixing one real, pre-existing dataset-wording bug found along
the way: `qa-notification-failures`'s mock answer didn't literally contain its own expected
phrases ("not awaited", "no error handling") — corrected the wording (not the evaluator), the
same class of fix as Phase 11's own `qa-ownership-check` correction.

13 new/updated tests in `evaluation/` (adaptive-cutoff behavior, a cross-package constant-parity
tripwire test), 9 new in `api/` (`retrieval.test.ts`, unit-testing `selectRankedResults()`
directly). Full suites green: `api` 295 (286 + 9), `evaluation` 84 (80 + 4). `tsc`/`eslint` both
clean.

Commit: `ef8277d`

## Milestone 4 — Q&A citation and grounding improvements

`<pending>`

## Milestone 5 — Code review evidence improvements

`<pending>`

## Milestone 6 — Evaluation and regression gates

`<pending>`

## Milestone 7 — Frontend and observability updates

`<pending>`

## Milestone 8 — Full verification, documentation, and completion report

`<pending>`
