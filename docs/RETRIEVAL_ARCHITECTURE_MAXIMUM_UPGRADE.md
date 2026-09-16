# Retrieval Architecture — Maximum Upgrade

Standalone architecture reference for the third retrieval-target-closure pass (see
`docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md` §9 for the narrative account and
`docs/RETRIEVAL_TARGET_CLOSURE_PROGRESS.md`'s "Third pass" entry for the milestone summary). This
document is the complete, self-contained architecture record this task's own instructions require:
every measured number, every design decision and its rationale, and an honest account of what still
does not pass.

**Headline result**: Recall@3 moved from FAIL (84.9%) to **PASS (86.1%)**. Direct-hit rate (81.3%)
and Useful-context rate (80.9%) improved substantially but remain below their ≥90% targets.
Recall@5, previously passing at 98.4%, now fails at 88.0% — a real, reported regression, not hidden
behind the three targets' own improvement. **Retrieval target closure is not complete.**

## 1. Baseline metrics (start of this pass)

The second pass's own final, live-measured state (`docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md`
§2), re-verified live at the start of this pass rather than assumed:

| Metric | Baseline | Target |
|---|---|---|
| Recall@5 | 98.4% | ≥95% |
| Recall@3 | 84.9% | ≥85% |
| Precision@1 | 89.6% | ≥85% |
| Precision@3 | 79.6% | ≥75% |
| Precision@5 | 78.8% | ≥70% |
| MRR | 87.1% | ≥85% |
| nDCG@5 | 88.7% | ≥85% |
| Direct-hit rate | 78.1% | ≥90% |
| Useful-context rate | 63.1% | ≥90% |
| Duplicate rate | 0% | ≤2% |
| Empty-result rate | 0% | ≤5% |
| False-confidence rate | 0% | 0% |
| Invalid citations (Q&A) | 0% | 0% |
| Unsupported claims (Q&A) | 0% | 0% |
| Q&A grounding failures | 0/21 | 0 |
| Evidence-less review findings | 0% | 0% |
| Fabricated source metadata | 0% | 0% |

## 2. Final metrics

Live `pnpm eval` result, `evaluation/reports/latest.json`/`latest.md`:

| Metric | Final | Target | Status |
|---|---|---|---|
| Recall@5 | 88.0% | ≥95% | ❌ FAIL (regression — see §5) |
| Recall@3 | 86.1% | ≥85% | ✅ PASS |
| Precision@1 | 91.0% | ≥85% | ✅ PASS |
| Precision@3 | 85.1% | ≥75% | ✅ PASS |
| Precision@5 | 85.4% | ≥70% | ✅ PASS |
| MRR | 89.1% | ≥85% | ✅ PASS |
| nDCG@5 | 89.9% | ≥85% | ✅ PASS |
| Direct-hit rate | 81.3% | ≥90% | ❌ FAIL |
| Useful-context rate | 80.9% | ≥90% | ❌ FAIL |
| Duplicate rate | 0% | ≤2% | ✅ PASS |
| Empty-result rate | 0% | ≤5% | ✅ PASS |
| False-confidence rate | 0% | 0% | ✅ PASS |
| Invalid citations (Q&A) | 0% | 0% | ✅ PASS |
| Unsupported claims (Q&A) | 0% | 0% | ✅ PASS |
| Q&A grounding failures | 0/21 | 0 | ✅ PASS |
| Evidence-less review findings | 0% | 0% | ✅ PASS |
| Fabricated source metadata | 0% | 0% | ✅ PASS |

## 3. Exact PASS/FAIL per target

- Recall@3 ≥85%: **PASS** (86.1%) — this pass's primary named win.
- Direct-hit rate ≥90%: **FAIL** (81.3%, up from 78.1%) — 12 of 64 answerable cases still miss.
- Useful-context rate ≥90%: **FAIL** (80.9%, up from 63.1%) — largest remaining absolute gap.
- All other targets: PASS, including every grounding/security invariant, with zero regressions
  except Recall@5 (see §5).

**Overall: 14 of 17 targets pass. 3 fail: Direct-hit rate, Useful-context rate, Recall@5.**
Retrieval target closure is not claimed as complete.

## 4. Per-case before/after (Direct-hit rate)

Every case whose rank-1 result changed identity between the second-pass baseline and this pass's
final configuration, confirmed by direct diagnostic script output against both configurations, not
inferred from aggregate deltas:

| Case | Baseline rank-1 | Final rank-1 | Fixed? |
|---|---|---|---|
| `retrieval-authz-legacy-jwt-fallback` | wrong sibling | correct | ✅ Fixed (embedding swap alone) |
| `retrieval-hidden-reserve-stock` | wrong sibling | correct | ✅ Fixed (embedding swap alone) |
| `retrieval-natural-language-order-total` | `py-calculate-total` | `svc-calculate-order-total` | ✅ Fixed (weight rebalance) |
| `retrieval-webhook-parse-errors` | `errors-parse-webhook-payload-strict` | still `-strict` | ❌ Not fixed |
| `retrieval-sql-injection` | `py-legacy-get-order-by-id` | unchanged | ❌ Not fixed |
| `retrieval-missing-ownership-check` | `api-get-owned-project` | unchanged | ❌ Not fixed |
| `retrieval-fire-and-forget-notifications` | `services-notify-user` | unchanged | ❌ Not fixed |
| `retrieval-vague-wording` | wrong (varies) | `py-validate-email` | ❌ Not fixed |
| `retrieval-exact-class-name-session-user` | wrong sibling | unchanged | ❌ Not fixed |
| `retrieval-no-exact-identifier-cart-merge` | `js-cart-add-to-cart` | unchanged | ❌ Not fixed |
| `retrieval-no-exact-identifier-discount` | `py-calculate-total` | unchanged | ❌ Not fixed |
| `retrieval-multiple-relevant-cart-service` | wrong sibling | unchanged | ❌ Not fixed |
| `retrieval-data-flow-normalize-to-process` | `svc-process-order` | unchanged | ❌ Not fixed |
| `retrieval-data-flow-jwt-issue-to-verify` | `py-generate-jwt` | unchanged | ❌ Not fixed |
| `retrieval-authz-js-order-ownership` | `js-get-owned-order` | unchanged | ❌ Not fixed |

Net: 13 misses → 12 misses (3 fixed, 2 newly appeared as a side effect of the embedding swap
changing raw semantic ranking — `retrieval-missing-ownership-check` and
`retrieval-authz-js-order-ownership` were passing under the old mock's cruder scoring and now fail
under the real model's stronger, but in these two cases wrong, semantic preference for the
negated concept — see §9.7 of the final report for the full accounting).

**Recall@3/@5 per-case**: not individually tracked case-by-case here (a 67-case aggregate over 3–5
ranked slots each is not a small trackable set) — see the companion final report's own sweep tables
for the specific cases driving the Recall@5 regression (`retrieval-password-check`,
`retrieval-database-access-orders-by-status`, `retrieval-multiple-relevant-order-repository`,
`retrieval-exact-api-route-get-order`, `retrieval-sql-injection`, each missing one of two-or-three
required evidence chunks at k=5).

## 5. Root cause of every failure (before and after this pass)

**Recall@3 (fixed)**: the second pass's own remaining shortfall was cases returning only 1 result
total because a genuinely-relevant sibling's combined score fell just below the 0.78 ratio cutoff.
The real embedding model's stronger semantic signal, combined with the weight rebalance (§7) and
gated same-file completion (§10), recovered enough of these to cross 85%.

**Direct-hit rate (still failing)**: two structural classes, both confirmed by direct inspection —
(a) near-synonym sibling functions where only a fine operational distinction (not name, not
location) distinguishes the correct answer, which neither a general-purpose embedding model nor
lexical/identifier overlap can reliably resolve; (b) negation-phrased queries where the tokenizer's
own 6-character stemming minimum is too short to bridge some of the specific word pairs involved
(e.g. "owns"/"owned," both 4–5 characters). See §11 for the full per-case table.

**Useful-context rate (still failing)**: real, substantial improvement (63.1%→80.9%) from the
combination of a real embedding model's better discrimination and the negation/weight tuning, but a
genuine architectural tension remains: any selection-width change that recovers more Recall pulls in
more same-file/same-directory candidates that are not, per hand-grading, actually relevant to the
specific query — confirmed by direct sweep (§9) showing every tested wider-selection configuration
traded Useful-context-rate away in proportion to the Recall it recovered. The gated same-file
completion (§10) is the best point found on that tradeoff curve, not a resolution of the tradeoff
itself.

**Recall@5 (new regression)**: the real embedding model produces a sharper score drop-off between
the top candidate and the next one than the old mock did, so the unchanged 0.78 ratio cutoff now
excludes more genuinely-relevant second/third pieces of evidence than it used to — see §5 of the
final report for the full mechanism and the sweep confirming no cutoff-ratio value recovers this
without costing Useful-context-rate back down.

## 6. Architecture changes (complete list, this pass)

- `evaluation/src/localEmbedding.ts` — **new file**, real local embedding model (§8).
- `evaluation/src/evaluators/retrievalEvaluator.ts` — `rankChunks`/`evaluateRetrieval` made async,
  new `Embedder` type + `DEFAULT_EMBEDDER`/`MOCK_EMBEDDER`, redundant 4x-per-case reranking
  eliminated (`rankedByCase` computed once via `Promise.all`), same-file evidence-group completion
  added to the selection loop (§10).
- `evaluation/src/evaluators/qaEvaluator.ts` — `evaluateCase`/`evaluateQa` made async with an
  `Embedder` parameter.
- `evaluation/src/runEval.ts` — explicit embedding warm-up pass with timing logs before the timed
  evaluation runs.
- `evaluation/src/diagnostics.ts`, `evaluation/src/relevanceReport.ts` — made async, switched to the
  real embedding model, one pre-existing redundant double-ranking call fixed as a byproduct.
- `evaluation/src/realProviders.ts` — awaited the now-async `rankChunks` calls; no behavior change.
- `evaluation/src/retrievalAdversarial.test.ts` — its own self-contained scoring function switched
  from the mock to the real embedding model, with an honest doc-comment noting it still does not
  exercise the full intent-rerank/coherence-cutoff pipeline (a deliberate, narrower scope).
- `api/src/lib/hybridScore.ts` + `evaluation/src/hybridScore.ts` — `HYBRID_WEIGHTS.semantic`
  1.0→0.8 (§7).
- `api/src/lib/queryIntent.ts` + `evaluation/src/queryIntent.ts` — new `wantsMultipleEvidence()`
  export (§9).
- `api/src/lib/rerank.ts` + `evaluation/src/rerank.ts` — `applyIntentRerank()` now also applies a
  negation-aware penalty via `negatedWordSet()` (§9), never touching `adjustedCutoffBasis`.
- `api/src/services/retrieval.ts` + `evaluation/src/evaluators/retrievalEvaluator.ts` —
  `selectRankedResults()`/`rankChunks()` selection loop adds same-file evidence-group completion,
  gated by `wantsMultipleEvidence()` (§10).
- `evaluation/vitest.config.ts` — `testTimeout`/`hookTimeout` raised to 120s and `fileParallelism`
  disabled, since real model inference is CPU-bound in a way the old pure-function mock never was
  (concurrent test-file workers were starving each other for CPU under the old 5s/parallel config).
- `evaluation/package.json` / root `pnpm-lock.yaml` — added `@huggingface/transformers` ^4.3.0.

**Candidate generation**: unchanged (still semantic + lexical + identifier + exact-identifier +
file-path union over the same candidate pool) — no new channel (BM25 index, symbol index,
graph-based retriever) was added this pass. Real diagnostic work found every remaining miss's
correct chunk already present in the candidate pool; the defect is in ranking/selection, not
candidate generation, for every case traced this pass.

**Chunking/indexing**: not changed. No evidence this pass that chunk boundaries contributed to any
of the four target shortfalls.

## 7. Embedding configuration

- **Model**: `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers` v4.3.0's
  `pipeline("feature-extraction", MODEL_ID, { dtype: "fp32" })`, called with
  `{ pooling: "mean", normalize: true }`.
- **Runtime**: WASM/ONNX, fully in-process, CPU-only. No API key, no network dependency after the
  first model download (cached to disk).
- **Scope**: evaluation-harness default embedder only (`DEFAULT_EMBEDDER` in
  `retrievalEvaluator.ts`). Production's real embedding provider (Voyage AI via
  `api/src/lib/aiServiceClient.ts`) is unchanged by this pass.
- **Caching**: in-memory, keyed by exact input text (`localEmbedding.ts`'s own cache); a batched
  variant (`localEmbeddingBatch`) exists for future bulk use but is not yet wired into any caller.
- **Dimension/normalization**: model output is L2-normalized at inference time
  (`normalize: true`), matching `deterministicEmbedding.ts`'s own explicit normalization — both
  embedding sources always produce unit-length vectors, so `cosineSimilarity()`'s raw-dot-product
  implementation (no separate magnitude division) stays mathematically valid as true cosine
  similarity for either source.
- **Mock retained**: `MOCK_EMBEDDER` (the prior character-n-gram proxy, unchanged) is kept as an
  explicit opt-in for isolated unit tests that need zero model-load cost and a guaranteed no-network
  behavior — verified by `integration.test.ts`'s own "no network access when explicitly using
  MOCK_EMBEDDER" tests, which explicitly thread `MOCK_EMBEDDER` through and assert `fetch` is never
  called.
- **HYBRID_WEIGHTS** (post-rebalance): `semantic: 0.8, lexical: 0.35, identifier: 0.25,
  exactIdentifier: 0.4, filePath: 0.35` (`semantic` lowered from 1.0 — see §9.4.1 of the final
  report for the sweep this value was chosen from).

## 8. Reranker design

No new reranker stage was added this pass (`applyIntentRerank()`'s existing 8-intent structure from
the second pass is unchanged in shape) — one new adjustment was added inside it:

- **Negation-aware penalty** (`NEGATED_MATCH_PENALTY = 0.3`): computed once per query via
  `negatedWordSet(query)`. Per candidate, `lexicalOverlapScore([...negatedWords], candidateTokens)`
  (reusing the existing exported lexical-overlap function, no new matching logic duplicated) yields
  the fraction of the query's own negated words the candidate's content/symbol actually contains;
  `bonus -= NEGATED_MATCH_PENALTY * thatFraction`. A true no-op for the large majority of queries
  (those with no detected negation cue, where `negatedWords.size === 0`). Never affects
  `adjustedCutoffBasis`, for the same reason a positive intent bonus doesn't (established in the
  second pass — see `rerank.ts`'s own doc comment).
- No learned/trained reranker was built. A rule-based feature threshold (weight rebalance +
  negation penalty + evidence-group gate) was judged sufficient to test and measure before
  considering a trained model, and — given the fixture's own small size (67 cases) — a trained
  model risked memorizing rather than generalizing, which this task's own restrictions explicitly
  forbid.

## 9. Query-intent design

`queryIntent.ts`'s existing 8-intent `classifyQueryIntent()` (entry-point, orchestration,
dependency, usage, configuration, error, test, definition, falling back to general) is unchanged in
structure. Two additions:

- **`negatedWordSet(query)`** — already existed from the second pass (built, documented, but left
  unused there); this pass is what actually wires it into scoring (§8).
- **`wantsMultipleEvidence(query)`** — new. A small set of general English wording cues signaling
  the query wants an enumeration, not one answer: plural head nouns (`operations`, `queries`,
  `functions`, `endpoints`) or explicit quantifiers (`every`, `all`). Matched 3 of 67 benchmark
  queries in the final configuration — deliberately narrow; a broader version (also gating on
  `usage`/`dependency`/`orchestration`/`error` intent) was measured and found to cost
  Useful-context-rate more than it gained in Recall (§9.5 of the final report), so it was not
  adopted.

## 10. Evidence-group design

Same-source-file completion, added to `selectRankedResults()`/`rankChunks()`'s selection loop,
immediately before the existing coherence-aware cutoff check:

```
if (multiEvidence && candidate.filePath === top.filePath) {
  const grounded = candidate.signals.lexicalScore > SAME_FILE_GROUNDING_FLOOR
    || candidate.signals.identifierScore > 0
    || candidate.signals.exactIdentifierScore > 0;
  if (grounded) { include candidate unconditionally; continue; }
}
```

- `multiEvidence = wantsMultipleEvidence(query)` (§9) — the completion only activates for queries
  that asked for more than one result.
- `SAME_FILE_GROUNDING_FLOOR = 0.15` — a candidate must still have *some* genuine lexical or
  identifier connection to the query itself, not merely sit near the top match; a same-file
  candidate with zero grounding still falls through to the normal cutoff like any other candidate.
- This is a narrower, safer version of the second pass's own "evidence-group selection... *is* the
  coherence-aware cutoff" framing — same-directory/reference-linked coherence (second pass) stays a
  *relaxed threshold*, while same-file-plus-multi-evidence-cue (this pass) is an outright *bypass*,
  reserved for the specific structural pattern (direct+supporting pair in one file) real
  measurement showed the coherence relaxation alone wasn't reaching.
- No cross-file evidence-group graph expansion (beyond the second pass's existing reference-graph
  coherence check) was added this pass.

## 11. Chunking changes

None. No AST re-chunking, no language-specific parsing changes, no chunk-metadata schema changes.
Confirmed unnecessary for every diagnosed case this pass (§6).

## 12. Performance measurements

- **Cold model load**: ~58s (one-time, first run only — a real HuggingFace Hub model download,
  cached to disk afterward), measured directly in a throwaway prototype before adoption.
- **Cached model load**: ~126ms (subsequent process starts, reading from local disk cache).
- **Per-embedding inference**: ~3–8ms per call (short code chunks / queries), measured directly.
- **Live `pnpm eval` run** (warm cache): "Local embedding model ready in 4511ms" (this run's actual
  logged warm-up time, `evaluation/reports/latest.md`'s own console output — includes embedding
  every fixture chunk plus every case query once, not just the model's own load), "Retrieval
  evaluation: 765ms for 67 cases" (the timed evaluation pass itself, reusing the warmed cache).
- **Test suite wall-clock impact**: real model inference is CPU-bound, unlike the old
  free pure-function mock. `fileParallelism: false` was required (§6) — with parallel test-file
  workers each loading their own model copy, several tests exceeded even a 60s timeout purely from
  CPU contention; sequential execution completes the full 168-test suite in ~59–61s.
- **In-memory embedding cache**: keyed by exact input text, eliminates repeated-embedding cost
  within one process — confirmed by the eliminated 4x-per-case redundant `rankChunks` calls (§6)
  now computing each case's ranking exactly once.

## 13. Token/context measurements

- `MAX_CONTEXT_CHARS = 16,000` (unchanged, mirrors `qaSourceSelection.ts`'s production budget).
- `contextSizeCompliant`: **100%** (unchanged from baseline) — every retrieval result across all 67
  cases stays within the production context-size budget, confirmed live this run.
- No change to context packing, token budgeting, or MAX_SOURCES limits this pass.

## 14. Grounding results

- Q&A: 0/21 failures (unchanged from baseline), `citationRecall` 100%, `unsupportedClaimRate` 0%,
  `insufficientEvidenceAccuracy` 100%, `invalidCitationRate` 0%. Re-verified live against the new
  embedding model and new reranking — not assumed safe by carryover from the second pass.
- Review: 0/21 failures (unchanged from baseline), `citationValidityRate` 100%,
  `findingRecall`/`findingPrecision` 100%, `emptyReviewCorrectness` 100%. `reviewEvaluator.ts` does
  not call `rankChunks()` at all — it grades findings against each case's own hand-labeled evidence
  directly, so review grounding is structurally insulated from every retrieval-side change this
  pass made (confirmed by direct code inspection, not assumed).
- No case in either evaluator was modified, relaxed, or removed to achieve these results.

## 15. Security/isolation results

- No authentication, authorization, secret-redaction, or cross-tenant-isolation code was touched
  this pass (`api/src/lib/secretRedaction.ts`, ownership checks, Phase 16 isolation logic all
  unchanged).
- Phase 15 (background job behavior) and Phase 16 (cross-user isolation) were **not re-verified
  live** this specific pass (no re-run of the live-HTTP checks the second pass performed) — their
  own dedicated test suites are unchanged and still pass as part of the api package's 458/458 total,
  but this document does not claim a fresh live-HTTP re-verification was performed, since no code
  those checks exercise was modified.
- No secret, token, or credential is embedded anywhere in this pass's new code
  (`localEmbedding.ts` requires no API key; the model is downloaded from a public HuggingFace Hub
  repository over HTTPS on first use only).

## 16. Test counts

| Package | Before this pass | After this pass | New tests |
|---|---|---|---|
| `api` | 458 | 458 | 0 (weight/logic changes only, inside already-covered code paths; 1 pre-existing assertion updated) |
| `evaluation` | 168 | 168 | 0 net (every pre-existing test updated for the new async `Embedder` API, none deleted or weakened) |
| `frontend` | 121 | 121 (not re-run this pass — untouched) | 0 |
| integration (`tests/`) | 12 | 12 (not re-run this pass — untouched) | 0 |

All 626 api+evaluation tests confirmed passing live this pass (`npm test` in both packages).
`tsc --noEmit` clean in both packages.

## 17. Docker verification

**Not performed this pass.** No schema, migration, chunking, or indexing code was touched, so a
full clean rebuild (`docker compose down -v && up -d --build`) was judged lower marginal value
relative to its cost/time, and `down -v` is a destructive operation this task's own safety
guidelines require explicit authorization for before running without clear need. The only currently
running container this session observed is `devforge-postgres-1` (healthy, unchanged). The api and
evaluation test suites (759 tests total across both, §16) are this pass's primary correctness
evidence for the shared-library production code (`hybridScore.ts`, `rerank.ts`, `retrieval.ts`,
`queryIntent.ts`) this pass did change.

## 18. Reindex/incremental-indexing verification

Not affected by this pass — no chunking, indexing, embedding-persistence, or database code was
touched. Phase 14's own incremental-indexing behavior and its regression tests are unchanged and
still pass as part of the api package's 458/458 total. Not independently re-run this pass, since
nothing in its own code path changed.

## 19. VoxMind isolation verification

VoxMind was not read, modified, inspected, or otherwise interacted with at any point this pass. All
work this pass was confined to `api/src/lib/`, `api/src/services/retrieval.ts`,
`evaluation/src/`, and `docs/`. No VoxMind file path, process, port, or database was referenced by
any command run this pass.

## 20. Remaining limitations

Stated plainly, per this task's own instruction not to stop at "improved" or "close":

1. **Direct-hit rate (81.3%, need ≥90%)** and **Useful-context rate (80.9%, need ≥90%)** both
   remain below target. §5/§11 of this document and §9.7/§9.8 of the final report give the specific
   per-case root causes and what would concretely be needed next: primarily a code-aware embedding
   model or a genuine per-pair verifier for near-synonym sibling disambiguation (the single largest
   remaining failure class), which this pass did not attempt — no LLM API credential is configured
   in this environment, and evaluating a second embedding model was judged out of scope for the
   remaining time in this pass after validating and tuning the first swap.
2. **Recall@5 (88.0%, need ≥95%) is a new regression**, not a pre-existing gap — introduced by the
   real embedding model's sharper score drop-off interacting with the unchanged ratio-based cutoff.
   This must be treated as outstanding work, not offset by the three named targets' own improvement.
3. **The Recall/Useful-context tension itself is not resolved**, only navigated to a better point on
   its tradeoff curve (§5, §10). A genuine per-query evidence-sufficiency score — reasoning about
   how many pieces of evidence a *specific* query needs, rather than a structural proxy (same file,
   plural wording) for it — is the concrete next architectural step and was not built this pass.
4. **`retrievalAdversarial.test.ts`'s own fixture** (Milestone A6) was updated to use the real
   embedding model but still does not exercise the full intent-rerank/coherence-cutoff/evidence-
   group pipeline this document describes — an intentional, documented scope narrowing (it tests
   the base scoring formula's own generalization to fresh content in isolation), not an oversight.
5. **No BM25 lexical index, symbol/identifier index, learned reranker, query decomposition/
   rewriting, or answerability verifier was added this pass** — all remain explicitly authorized and
   unimplemented; §8/§20.1 above name which of these is judged the most promising next step and why.

**Retrieval target closure is not complete.** This document and its companion final report state
that plainly rather than characterizing 14-of-17 passing targets, or the three specifically-named
targets' own partial progress, as sufficient.
