# DevForge Phase 12 (Retrieval Quality & Grounding Improvements) — Implementation Plan

## Scope

In scope: measurable improvements to Phase 8 retrieval ranking precision/MRR (without sacrificing
recall), reduction of Phase 9 Q&A's 20% invalid-citation rate toward zero (with a safe,
deterministic fallback for whatever remains), and a review of Phase 10 code-review evidence
quality — all grounded in diagnostics measured against the real Phase 11 baseline, not
speculative changes. This phase measures, diagnoses, then improves; it does not add AI
capability, does not replace the embedding architecture, and does not touch VoxMind.

Out of scope (explicitly, per the task): autonomous code modification, automatic execution,
automatic commits/PRs, agentic orchestration, a new vector database, a full embedding-provider
rewrite, broad UI redesign, VoxMind changes.

## Current architecture (re-inspected before any change)

- **Retrieval** (`api/src/services/retrieval.ts`): `search(ownerId, projectId, input)` — lazy
  chunk-build via `buildChunksForIndex()`, lazy embed via `ensureEmbeddings()` (Voyage AI
  `voyage-code-3`, `EMBED_BATCH_SIZE = 32`), then a single, pure `Float[]` cosine-similarity
  ranking (`lib/similarity.ts`) over every chunk with an embedding for the current `(index,
  commit, model)`, sorted descending, sliced to exactly `input.limit` (default 10) — **always
  exactly `limit` results are returned when at least `limit` chunks exist, regardless of how
  weak the tail scores are**. `SearchResult.score` is the raw cosine similarity — returned to
  callers and re-sorted on by `lib/qaSourceSelection.ts`'s `selectSources()` (Q&A/review's own
  downstream dedup+cap, unchanged, already reused across Phases 9/10).
- **Chunking** (`api/src/lib/chunking.ts`): one chunk per Phase 7 symbol span (tree-sitter's own
  `function_declaration`/etc. node range — **does not include a symbol's own leading doc
  comment**), oversized-symbol line-window splitting with overlap, whole-file fallback for
  symbol-less files. No chunk today carries any neighboring/leading-context text.
  `CodeChunk.content` is the only text ever embedded, returned, or cited — Phase 7 deliberately
  never stores a file's full raw content (only `content_hash`), so no cheap way exists today to
  pull "a few lines before this chunk" without a fresh GitHub fetch.
- **Evaluation** (`evaluation/src/evaluators/retrievalEvaluator.ts`,
  `evaluation/src/deterministicEmbedding.ts`): a *separate*, non-production, character-n-gram
  lexical-similarity proxy (see Phase 11's own documented rationale for why — no paid Voyage
  credential needed), ranking the fixture dataset's 16 chunks, sliced to `TOP_K = 5`, same
  always-exactly-K behavior as production `search()`.

## Baseline metrics (Phase 11, unchanged until this phase's own measured after-numbers)

Retrieval: Recall@K 88.9%, MRR 66.1%, Precision@K 28.9%, duplicate/empty-result rate 0%, context
compliance 100%. Q&A: citation precision 100%, citation recall 100%, invalid-citation rate 20%,
unsupported-claim rate 0%, insufficient-evidence accuracy 100%. Code review: finding precision
100%, finding recall 100%, false-positive rate 0%, citation validity 100%, category/severity
accuracy 100%, empty-review correctness 100%.

## Root-cause analysis

### Retrieval precision@K — mechanically bounded by fixed-K padding, not primarily bad ranking

Computed directly (see `docs/RETRIEVAL_QUALITY_PHASE_PROGRESS.md`'s Milestone 1 log for the exact
script and output): with `K = 5` and this dataset's per-case relevant-set sizes (1–2 chunks out
of 16 total), the **maximum possible** `precision@5` averaged across all 9 retrieval cases is
**33.3%** — because `rankChunks()`/`search()` always return exactly `K`/`limit` results, padding
every case with 3–4 chunks that cannot possibly be relevant no matter how good the ranking is.
The measured 28.9% is already **87% of this theoretical ceiling**. This is the dominant,
previously-undiagnosed cause: *the system doesn't stop returning results when it runs out of
actually-relevant ones*. The fix is a score-aware adaptive result count (Milestone 3), not
primarily a ranking-order fix — though ranking order still matters for MRR and for the residual
gap to ceiling.

### MRR losses — per-case rank inspection

Ranking every case's full 16-chunk order (not just top-5) and locating each `expectedChunkIds`
entry's real rank:

| Case | First expected rank | Note |
|---|---|---|
| retrieval-password-check | 1 | — |
| retrieval-find-user-by-email | 1 | — |
| retrieval-sql-injection | 5 | right at the K boundary |
| retrieval-missing-ownership-check | 2 | its own acceptable-alternative chunk ranks 1st |
| retrieval-webhook-parse-errors | 4 | its own acceptable-alternative chunk ranks 1st |
| retrieval-webhook-secret-config | 1 | — |
| retrieval-github-default-branch | 1 | — |
| retrieval-fire-and-forget-notifications | **12** | see below |
| retrieval-round-decimal-places | 1 | — |

Two real, distinct causes:

1. **Acceptable-alternative crowding** (`missing-ownership-check`, `webhook-parse-errors`): a
   valid alternative chunk (e.g. the *safe* sibling function) ranks above the *primary* expected
   one under pure lexical/semantic similarity alone — both are legitimate answers, so this isn't
   a correctness bug, but it costs MRR. General fix: identifier/path signals that distinguish the
   query's own intent (e.g. which specific function it's asking about) from a merely-similar
   sibling.
2. **`retrieval-fire-and-forget-notifications` (rank 12, the one case that misses recall@5
   entirely)**: the query ("without waiting for the response") describes a *behavior*
   ("fire-and-forget", "not awaited") that is stated in the target chunk's **leading doc
   comment** — which, per Phase 7's own tree-sitter symbol-span convention, is **not part of the
   chunk's content at all**. The chunk itself is pure code with no lexical or conceptual overlap
   with the query beyond the word "notify". Its sibling (`notifyUser`) coincidentally shares the
   token "user" and a `res` variable overlapping "response" in char-n-gram terms, outranking the
   true target. **This is a real, structural limitation, not a bug to special-case away**: fixing
   it would require either (a) giving the ranking function access to a chunk's leading comment
   text, which production cannot do cheaply today (see "Chunking" above — no raw file content is
   stored, only `content_hash`; pulling it back in would mean a fresh GitHub fetch per search,
   which is exactly the kind of unjustified architecture change this phase is told to avoid), or
   (b) real semantic (not lexical) embeddings, which is precisely why production defaults to
   Voyage AI rather than a lexical proxy — a real embedding model is far more likely to associate
   "without waiting for the response" with "fire-and-forget" conceptually. **Decision: documented
   as a known, accepted limitation of the deterministic lexical proxy specifically** (consistent
   with Phase 11's own "what cannot be measured reliably" section), not chased with a
   dataset-specific synonym table. Real-provider mode (`pnpm eval:real`, Phase 11) already offers
   the honest way to see this case handled by real embeddings when a Voyage key is available.

### Q&A invalid-citation rate (20%)

Traced directly in `services/qa.ts`/`qaEvaluator.ts` (not guessed): the metric is computed by
checking each case's `mockAnswer.citedChunkIds` against **this evaluation run's own actual
retrieval output** for that question (`rankChunks(question)`), not against the case's
`requiredEvidenceChunkIds` ground truth. The one case that fails
(`qa-notification-failures`) does so **because its required evidence is the same
`retrieval-fire-and-forget-notifications` chunk that misses top-5 retrieval above** — the Q&A
citation is "invalid" only in the sense that the evaluation's own retrieval step didn't surface
it, not because of any flaw in the citation-safety mechanism itself (production's real citation
validation — `ai-service`'s `AnthropicQaProvider` filtering + Node's independent
`citedOrders`/`filterValidFindings`-style re-validation — was exhaustively tested in Phases 9/10
and is unchanged and untouched by this bug). **This means Goal 2's invalid-citation rate is
mechanically coupled to Goal 1's retrieval quality**: improving retrieval recall/ranking for the
`fire-and-forget` case is the only way to reduce this specific measured rate; no citation-layer
change alone can fix it, since the citation layer is already behaving exactly as designed (a
citation is "invalid" here precisely because it points to real evidence retrieval failed to
surface, not because the model fabricated anything). This phase still hardens the citation layer
itself (Milestone 4) — deterministic normalization/validation, explicit fallback behavior,
adversarial tests — both because it's independently valuable and because a genuinely-hardened
layer is what lets us *prove*, via new tests, that no other invalid-citation path exists beyond
this one documented, retrieval-coupled case.

### Code review evidence quality

Phase 10/11 baseline is already at 100% across every review metric on the existing dataset — no
defect was found by re-reading `services/codeReview.ts`, `ai-service/app/agents/review/
provider.py`, and `lib/reviewFindingFiltering.ts`. This phase's Milestone 5 work is therefore
**hardening and adversarial-test coverage**, not a defect fix: confirming (with new tests, not
new production logic beyond what genuinely improves review-time source selection quality — e.g.
reusing Milestone 3's improved ranking for the retrieval `search()` call `codeReview.ts` already
depends on) that the zero-tolerance "no finding without valid evidence" rule holds under
adversarial inputs the Phase 11 dataset didn't cover.

## Proposed changes

1. **Retrieval diagnostics** (Milestone 2): a pure, side-effect-free diagnostics module —
   `api/src/lib/retrievalDiagnostics.ts` (production-safe, opt-in, never logged by default) and
   `evaluation/src/diagnostics.ts` (used by the evaluation report) — producing a per-candidate
   score breakdown (semantic score, lexical score, identifier-match score, file-path-match score,
   combined score, final rank) without ever including full secret-bearing source content or
   credentials.
2. **Hybrid scoring** (Milestone 3): `api/src/lib/hybridScore.ts` (new, pure, unit-tested) adds
   lexical token-overlap, exact/partial identifier-match, and file-path-match signals on top of
   the existing semantic cosine score, combined with fixed, documented weights — mirrored in
   `evaluation/src/hybridScore.ts` so the same measurable improvement shows up in `pnpm eval`.
   `SearchResult.score` (the field returned to every existing caller/test) **stays pure cosine
   similarity, unchanged** — hybrid scoring is used only to decide *which* chunks `search()`
   selects and in what order, never to change the meaning of the `score` field itself, preserving
   every existing consumer/test's contract.
3. **Adaptive result count** (Milestone 3): after hybrid-ranking, `search()` keeps a chunk only
   if its combined score is within a documented relative margin of the top score (always keeping
   at least the top-ranked result) — this is the direct fix for the precision-ceiling problem
   identified above, applied uniformly, never keyed to a specific query or dataset.
4. **Q&A citation hardening** (Milestone 4): audit and, where a real gap is found, harden
   `services/qa.ts`'s citation normalization/validation, with new adversarial tests proving every
   invalid-citation shape (out-of-range, negative, duplicate, missing) is already handled safely
   — and, if the audit finds a genuine gap, fix it. No weakening of the evaluator.
5. **Code review hardening** (Milestone 5): equivalent audit for `services/codeReview.ts` with
   new adversarial tests.
6. **Evaluation extensions** (Milestone 6): rank-distribution and score-breakdown reporting,
   before/after comparison against the recorded Phase 11 baseline, new adversarial dataset cases.
7. **Frontend** (Milestone 7): only if diagnostics/comparison data is genuinely useful to surface
   — a minimal addition to the existing `/evaluations` page, not a new UI surface, behind no new
   route unless justified.

## Expected impact

Precision@K: meaningfully higher than 28.9%, bounded above by the ~33% mechanical ceiling unless
`K`/`limit` itself is revisited (out of scope — `limit` is caller-supplied API surface, not
this phase's to silently change). MRR: improvement on the acceptable-alternative-crowding cases
(2 of 9); `fire-and-forget` remains a documented, accepted miss. Recall@K: preserved or improved,
never regressed (the adaptive cutoff always keeps top-ranked candidates; it only trims the
already-irrelevant tail). Invalid-citation rate: reduced only as far as the coupled retrieval
case allows, honestly documented if not zero — consistent with the task's own "if not achieved,
document the exact remaining failure case" instruction.

## Risks

- Hybrid-score weights are hand-picked, not learned — documented as a heuristic, not a claim of
  optimality, mirroring Phase 11's own honesty standard.
- Any change to `search()`'s selection logic touches every downstream consumer (Q&A, review,
  the search API) — mitigated by keeping `SearchResult.score` semantics unchanged and by running
  the full existing Supertest suite (`retrieval.test.ts`, `qa.test.ts`, `codeReview.test.ts`)
  after every change, not just the evaluation suite.
- Overfitting risk: explicitly mitigated by (a) never referencing a specific case/chunk id in
  production or evaluation ranking code, (b) adding *new*, previously-unseen adversarial cases in
  Milestone 6 specifically to catch overfitting, (c) documenting the one case left unfixed rather
  than hand-tuning around it.

## Non-goals

Matches the task's own "Non-Goals for Phase 12" list verbatim: no autonomous code modification,
execution, commits, PRs, deployment, agentic/multi-agent orchestration, new product features, a
new vector database, a full embedding-provider rewrite, broad UI redesign, or any VoxMind change.
Also not in scope: changing `search()`'s public `limit` semantics, storing raw file content to
enable leading-comment-aware ranking (see the `fire-and-forget` analysis above), and pgvector
(no documented, tested reason found — this dataset's and any realistic single-project scale
doesn't need ANN indexing, matching Phase 8's own original conclusion, re-confirmed not
re-litigated here).

## Test strategy

Every new pure function (`hybridScore.ts`, diagnostics) gets direct unit tests, mirrored in both
`api/` and `evaluation/`. The full existing Supertest suite
(`retrieval.test.ts`/`qa.test.ts`/`codeReview.test.ts`) is re-run after every change, not only at
the end, to catch a regression immediately rather than after a large batch of changes. New
adversarial evaluation cases are added *after* the ranking/citation changes are implemented, so
they measure the shipped behavior rather than being tuned to make an in-progress implementation
pass.

## Regression gates

Extends Phase 11's `evaluation/src/regressionGates.ts` (see Milestone 6): existing gates are
kept, `recallAtK`'s floor stays ≥ 75%, a new `precisionAtK` floor is added once the after-numbers
are measured (set above the Phase 11 baseline, not arbitrarily), `invalidCitationRate`'s existing
floor is tightened if the measured after-number allows it. No existing gate is loosened to make
Phase 12 "pass."

## Anti-overfitting strategy

1. All ranking/citation logic is general-purpose — no `if (caseId === ...)`/chunk-id-keyed
   branching anywhere in production or evaluation code (checked by code review and by the new
   adversarial cases, which the implementation never sees while being written).
2. New adversarial cases (Milestone 6) are designed to stress exactly the *mechanisms* this phase
   adds (identifier boosting, file-path boosting, adaptive cutoff, citation validation) with
   fresh content the implementation code was not shaped around.
3. Hybrid-score weights are documented as hand-picked constants, re-usable and inspectable, not
   hidden inside a per-query special case.
4. The one known-unfixed retrieval case is left as a real, visible, documented failure in the
   report rather than removed or reworded to force a clean run — consistent with Phase 11's own
   established practice.
