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

Commit: `<pending>`

## Milestone 2 — Retrieval diagnostics

`<pending>`

## Milestone 3 — Retrieval ranking improvements

`<pending>`

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
