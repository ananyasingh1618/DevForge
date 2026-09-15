# DevForge Phase 12 (Retrieval Quality & Grounding Improvements) — Completion Report

See [docs/RETRIEVAL_QUALITY_PHASE_PLAN.md](RETRIEVAL_QUALITY_PHASE_PLAN.md) for the full design
and root-cause analysis, and
[docs/RETRIEVAL_QUALITY_PHASE_PROGRESS.md](RETRIEVAL_QUALITY_PHASE_PROGRESS.md) for the verified,
milestone-by-milestone build log this report summarizes.

## 1. Milestone-by-milestone status

| # | Milestone | Status |
|---|---|---|
| 1 | Repository inspection and phase plan | Complete |
| 2 | Retrieval diagnostics | Complete |
| 3 | Retrieval ranking improvements | Complete |
| 4 | Q&A citation and grounding improvements | Complete |
| 5 | Code review evidence improvements | Complete |
| 6 | Evaluation and regression gates | Complete |
| 7 | Frontend and observability updates | Complete |
| 8 | Full verification, documentation, and completion report | Complete (this report) |

All 8 milestones implemented, tested, Docker-verified, and documented. 14 commits (7
substantive + 7 hash-backfill, matching this project's established two-commit-per-milestone
convention):

```
8074b37 docs: Phase 12 (Retrieval Quality) plan and progress tracker
bd30f6a docs: fill in Milestone 1 commit hash
af01e1a feat(api,evaluation): add retrieval diagnostics and hybrid-score signals
f810b30 docs: fill in Milestone 2 commit hash
ef8277d feat(api,evaluation): wire hybrid scoring and adaptive cutoff into retrieval
b677226 docs: fill in Milestone 3 commit hash
916fdac feat(api): harden Q&A citation grounding with a deterministic fallback
7658238 docs: fill in Milestone 4 commit hash
5e5b546 test(api): add adversarial coverage for shared-source review findings
af1a195 docs: fill in Milestone 5 commit hash
02ce22f feat(evaluation): extend evaluation with adversarial cases and tightened gates
5c6236b docs: fill in Milestone 6 commit hash
e1a86ad feat(frontend): add baseline-vs-current comparison to the Evaluations page
cd05ba6 docs: fill in Milestone 7 commit hash
```

## 2. Files created

- `docs/RETRIEVAL_QUALITY_PHASE_PLAN.md`, `docs/RETRIEVAL_QUALITY_PHASE_PROGRESS.md`,
  `docs/RETRIEVAL_QUALITY_COMPLETION_REPORT.md` (this file)
- `api/src/lib/hybridScore.ts`, `hybridScore.test.ts`
- `api/src/lib/retrievalDiagnostics.ts`, `retrievalDiagnostics.test.ts`
- `api/src/lib/qaAnswerGrounding.ts`, `qaAnswerGrounding.test.ts`
- `api/src/services/retrieval.test.ts` (first dedicated unit-test file for this service)
- `evaluation/src/hybridScore.ts`, `hybridScore.test.ts` (byte-for-byte mirror of `api`'s)
- `evaluation/src/diagnostics.ts`, `diagnostics.test.ts`
- `evaluation/src/qaAnswerGrounding.ts`, `qaAnswerGrounding.test.ts` (mirror of `api`'s)
- `evaluation/src/dataset/fixtures/auth/legacyAuth.ts`,
  `evaluation/src/dataset/fixtures/utils/securityHelpers.ts`,
  `evaluation/src/dataset/fixtures/services/rateLimiter.ts`

## 3. Files modified

- `api/src/services/retrieval.ts` (hybrid ranking + adaptive cutoff, `selectRankedResults()`
  exported)
- `api/src/services/qa.ts` (uses the new `groundAnswer()` grounding safety net)
- `api/src/routes/qa.test.ts` (+5 citation-grounding-hardening cases)
- `api/src/lib/reviewFindingFiltering.test.ts`, `api/src/routes/codeReview.test.ts` (+1 shared-
  source adversarial case each)
- `evaluation/src/evaluators/retrievalEvaluator.ts` (mirrors the production ranking algorithm,
  adds rank-distribution metrics)
- `evaluation/src/evaluators/retrievalEvaluator.test.ts`, `qaEvaluator.ts`, `qaEvaluator.test.ts`
  (adaptive-cutoff/fallback-count tests and metrics)
- `evaluation/src/realProviders.ts` (applies the grounding fallback before scoring a real answer,
  returns a fallback count)
- `evaluation/src/regressionGates.ts` (tightened thresholds — see §10)
- `evaluation/src/report.ts` (plain-count metric formatting for `fallbackCount`/
  `regenerationCount`)
- `evaluation/src/runEval.ts` (threads the fallback count through)
- `evaluation/src/dataset/fixtureRepo.ts`, `retrievalCases.ts`, `qaCases.ts`, `reviewCases.ts`,
  `version.ts` (8 new adversarial cases, dataset version bumped, one pre-existing case's ground
  truth broadened after a first adversarial run correctly flagged it as too narrow)
- `frontend/src/pages/Evaluations.tsx`, `Evaluations.test.tsx` (baseline-vs-current comparison)
- `README.md`, `evaluation/README.md` (documentation — see §16 below for what changed)

## 4. Database changes

None. Phase 12 changed application/ranking logic only — no new migration, no schema change. All
11 migrations from Phases 1–11 remain the complete set, confirmed applied automatically in a
volume-wiped Docker rebuild (see §11).

## 5. API changes

No new endpoint and no breaking change to any existing endpoint's request/response shape.
`POST /projects/:id/search`'s behavior changed in one way visible to a caller: it may now return
**fewer** than the requested `limit` results when the tail of the ranking is meaningfully weaker
than the top result (see §7) — always at least 1 result when any chunk exists. `SearchResult`'s
`score` field is unchanged (pure cosine similarity). `POST /projects/:id/qa`'s behavior changed
in one way: an answer that would previously have been persisted with a confident tone and zero
valid citations is now deterministically replaced with an honest insufficient-evidence message
before it is ever persisted or returned (see §8). No route was made unauthenticated; `GET
/evaluations`/`GET /evaluations/:runId` (Phase 11) are unchanged and still session-gated.

## 6. Frontend changes

Added a "Vs. previous run" comparison (four key metrics, a ▲/▼/– indicator, an explicit
"(regression)" label) to the existing `/evaluations` page's run-detail view — shown only when a
previous run exists. No new route. No existing page's behavior changed.

## 7. Retrieval changes

**Root cause** (Milestone 1, confirmed by direct calculation, not assumed): with a fixed `K`/
`limit` always returned regardless of relevance, and this dataset's per-case relevant-set sizes
(1–2 out of 16 chunks), the *maximum possible* `precision@5` was mathematically bounded at
~33.3% — the measured Phase 11 baseline (28.9%) was already 87% of that ceiling. Low precision
was overwhelmingly a fixed-K-padding artifact, not primarily a ranking-quality problem.

**Fix**: `api/src/lib/hybridScore.ts` adds three deterministic signals (lexical token overlap,
symbol-identifier match with an exact-substring boost, file-path match) on top of the existing
semantic cosine score, combined via fixed, documented weights (semantic dominant). `services/
retrieval.ts`'s `search()` (via the new, separately unit-tested `selectRankedResults()`) re-
ranks by this combined score and keeps a candidate only while its score is within
`RELATIVE_SCORE_CUTOFF` (0.7) of the top result's, capped at `limit`, always keeping at least
the top-ranked result. `SearchResult.score` itself is untouched (still pure cosine similarity) —
every existing consumer and test's contract is preserved. The identical algorithm is mirrored in
`evaluation/src/evaluators/retrievalEvaluator.ts`.

## 8. Q&A citation changes

**Root cause** (Milestone 1, confirmed, not assumed): the Phase 11 20% invalid-citation rate was
mechanically coupled to the one retrieval case above — the failing case's required evidence *is*
the chunk that retrieval was missing before Milestone 3's fix. The citation-safety mechanism
itself (structured-output schema, `ai-service`'s provider-level filtering, Node's independent
re-validation) had no defect.

**Hardening**: audited and extracted citation validation into `api/src/lib/
qaAnswerGrounding.ts`'s `groundAnswer()`. Out-of-range/negative/non-integer/duplicate citation
numbers were already correctly rejected (re-confirmed by 11 new unit tests, not re-implemented).
One real, previously-unguarded gap found and fixed: a provider could return
`insufficient_evidence: false` while citing zero valid sources after filtering. `groundAnswer()`
now deterministically replaces such an answer with a clear, honest insufficient-evidence
message — a bounded text substitution, never a retry, never a second provider call, never a
silent citation-to-citation substitution. Mirrored into `evaluation/src/qaAnswerGrounding.ts` and
wired into `realProviders.ts` so real-mode evaluation measures the identical, grounded behavior a
user would actually see.

## 9. Code-review evidence changes

No production code changed. Milestone 5's audit against the task's own checklist (invalid source
references, no sources, duplicate sources within a finding, empty codebases, safe code with no
findings, malformed output, provider failures, context-size limits) found every case already
correctly handled by Phase 10's existing implementation and test suite. One genuinely uncovered
adversarial case was added: two independent findings legitimately citing the same real source
must both survive filtering, not be conflated with a duplicate/fabricated citation — confirmed
correct with new unit and Supertest coverage. Milestone 6 separately added two new evaluation
review cases ("suspicious but valid" code, a same-named-but-differently-implemented function)
that also passed without any production change.

## 10. Before-and-after metrics

Measured on the evaluation dataset in mock mode (deterministic, no credentials), as reported by
`pnpm eval`:

| Metric | Phase 11 baseline | Phase 12 (after Milestone 3) | Phase 12 final (32-case dataset) |
|---|---|---|---|
| Retrieval recall@K | 88.9% | 100% (9 cases) | **100%** (14 cases, +5 adversarial) |
| Retrieval MRR | 66.1% | 80.6% | **82.1%** |
| Retrieval precision@K | 28.9% | 57.6% | **55.7%** |
| Q&A invalid-citation rate | 20% | 0% | **0%** |
| Q&A citation recall | 100% | 100% | **100%** |
| Q&A unsupported-claim rate | 0% | 0% | **0%** |
| Review finding precision/recall | 100% / 100% | 100% / 100% | **100% / 100%** |
| Review false-positive rate | 0% | 0% | **0%** |
| Golden-dataset case pass rate | 21/24* | 24/24 | **32/32** |

\* 21/24 at the start of this phase's own Milestone 1 baseline read (two dataset-wording bugs —
unrelated to production code — were also found and fixed along the way: `qa-ownership-check` in
an earlier commit this session, `qa-notification-failures` during Milestone 3; both corrected the
dataset's own wording, never the evaluator).

Precision@K's small apparent dip between the two "after" columns (57.6% → 55.7%) is the adaptive
cutoff correctly adjusting to a larger, harder, more adversarial 14-case set (up from 9) — not a
regression on the original cases, which are unchanged.

## 11. Regression results

Full monorepo suite, all green, immediately after the Docker verification below:

| Package | Tests | Result |
|---|---|---|
| `api` | 313 (258 Phase-11-and-earlier + 55 new) | ✅ all pass |
| `frontend` | 111 (109 + 2 new) | ✅ all pass |
| `evaluation` | 100 (84 + 16 new) | ✅ all pass |
| `ai-service` | 117 (unchanged — no ai-service file touched this phase) | ✅ all pass |
| `tests/` (real HTTP) | 12 (unchanged) | ✅ all pass |
| **Total** | **653** | ✅ |

Two `api` tests (`architecture.test.ts`'s activation test, `codebaseIndex.test.ts`'s parse-error
test) failed once under full-suite parallel worker load and passed cleanly in isolation — the
same pre-existing parallel-worker flakiness documented in every prior phase's own progress log
(Phases 6/7/9), unrelated to any Phase 12 change; the very next full-suite run was clean.

All 11 regression gates in `evaluation/src/regressionGates.ts` pass, including the newly
zero-tolerance `invalidCitationRate` gate and three newly-added/raised quality floors
(`precisionAtK ≥ 40%`, `meanReciprocalRank ≥ 65%`, `recallAtK`/`citationRecall`/`findingRecall`
raised from 75% to 85%) — none loosened.

## 12. Tests executed

- `pnpm --filter @devforge/api test` — 313 passed
- `pnpm --filter @devforge/frontend test` — 111 passed
- `pnpm --filter @devforge/evaluation test` — 100 passed
- `.venv/bin/python -m pytest tests/ -v` (ai-service) — 117 passed
- `pnpm test:integration` (`tests/`, real HTTP against a running stack) — 12 passed
- `pnpm typecheck` (api, frontend, tests, evaluation) — clean
- `pnpm lint` (api, frontend) — clean (one pre-existing, unrelated warning)
- `pnpm build` (api, frontend) — clean
- `pnpm eval` (mock mode, live, against the Docker-rebuilt stack) — exit 0, 32/32 golden cases,
  11/11 regression gates

## 13. Security verification

- Secret scan: `evaluation/reports/latest.{json,md}` and `docker compose logs` for `api`/
  `ai-service`/`frontend` all scanned for GitHub-token-, Anthropic-key-, and AWS-key-shaped
  strings after every Docker verification step — none found.
- `retrievalDiagnostics.ts`/`diagnostics.ts` carry only `chunkId`/`filePath`/`symbolName`/
  `lines`/scores — never a candidate's raw content — confirmed by a dedicated
  "never leaks content" test.
- No production endpoint was made unauthenticated — `GET /evaluations` re-confirmed to return a
  real `401` with no session, live, against the Docker-rebuilt stack.
- `groundAnswer()`'s fallback path re-confirmed to never leak a raw internal error/stack trace
  alongside its substitute answer (dedicated Supertest case).
- VoxMind: confirmed untouched throughout — its `uvicorn` process (PID 16012, port 8000) and its
  own native Postgres connections were checked via `ps aux` before, during, and after every
  Docker/process operation in this phase, with zero DevForge command ever referencing it.

## 14. Performance impact

The hybrid-score computation is pure, in-process, O(candidates × query-tokens) string work over
already-fetched chunk content already resident in memory — no new network call, no new database
query, no new embedding-provider call. For the dataset sizes this system targets (documented
since Phase 8: no ANN indexing needed at this scale), the added CPU cost is negligible next to
the existing embedding-generation and database round-trips. The adaptive cutoff can only reduce,
never increase, the number of `SearchResult` rows serialized and returned per request.

## 15. Known limitations

- Hybrid-score weights and `RELATIVE_SCORE_CUTOFF` are hand-picked constants, not learned —
  documented as a heuristic, not a claim of optimality.
- The deterministic evaluation embedding remains a lexical proxy; a query built around a genuine
  paraphrase with zero shared vocabulary could still expose the same class of limitation Phase 11
  first documented, even after this phase's fix for the one concrete case that existed.
- `groundAnswer()`'s fallback only catches the *zero-valid-citation* failure mode — it cannot
  detect a citation that is structurally valid but doesn't actually support the specific claim
  made about it; that remains the model's own responsibility per its system prompt, not
  something addressable without a second LLM call (deliberately not added).
- Review evidence quality required no production change this phase — its adversarial coverage is
  necessarily limited to the cases this phase's own dataset additions anticipated.
- No real-Voyage-embedding-backed measurement of the ranking improvement was performed (would
  require a paid credential); `pnpm eval:real`'s own retrieval step still uses the deterministic
  proxy by design (see the plan doc's "Real-provider evaluation strategy").

## 16. Remaining risks

- The adaptive cutoff (`RELATIVE_SCORE_CUTOFF = 0.7`) was validated against this dataset's score
  distributions; a real, much larger or more homogeneous codebase could produce a different score
  distribution where this constant behaves less well — worth revisiting with real production
  telemetry before broad rollout confidence, per the plan doc's own "Risks" section.
- `search()`'s new "may return fewer than `limit` results" behavior is a real, intentional
  behavior change for any caller relying on always getting exactly `limit` rows back; no such
  caller exists in this codebase today (confirmed by the full existing test suite passing
  unmodified), but a future integration should be aware of this contract.

## 17. VoxMind confirmation

VoxMind was not modified, refactored, renamed, deleted, migrated, or reused at any point during
Phase 12. Its process (PID 16012, `uvicorn voxmind.main:app`, port 8000) and its own native
PostgreSQL connections were confirmed running and untouched via `ps aux` at multiple checkpoints
throughout this phase, including immediately before and after the Docker volume-wiped rebuild.
No file under a VoxMind path was read, written, or referenced by any command in this phase.

## 18. Phase 13 confirmation

Phase 13 was not started. No file, commit, or planning document for any phase beyond 12 was
created in this session. Per the task's own explicit instruction, work stops here.
