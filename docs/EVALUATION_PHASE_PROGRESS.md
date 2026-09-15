# DevForge Phase 11 (Evaluation, Quality Measurement & Review Improvements) — Progress Log

See `docs/EVALUATION_PHASE_PLAN.md` for the full design. This log tracks each milestone's
implementation, verification, and commit hashes as work proceeds.

## Milestone 1 — Evaluation architecture and plan

Inspected before writing the plan: Phase 8's `retrieval.ts` (`search()`, `SearchResult`), Phase
9's `qa.ts`/`ai-service/app/agents/qa/` (citation-safety design), Phase 10's `codeReview.ts`/
`ai-service/app/agents/review/` (finding schema), `lib/qaSourceSelection.ts` (`MAX_SOURCES`,
`MAX_CONTEXT_CHARS`), the mocked-`fetch` testing technique already used in `qa.test.ts`/
`codeReview.test.ts`, `docker-compose.yml`'s optional-credential pass-through pattern, the
`Project`/`RepositoryConnection`/`CodebaseIndex` models, and the existing API/frontend/logging
conventions.

Key design decision: the evaluation dataset is a **fully synthetic, self-contained fixture
"repository"** (real, hand-authored TypeScript files under `evaluation/src/dataset/fixtures/`),
not a real GitHub repository — because `ai-service`'s `/qa/answer` and `/review/analyze`
endpoints already accept a caller-supplied numbered source list directly, this lets both mock
*and* real-provider evaluation exercise the real provider/prompt/schema code with zero GitHub
credentials ever required, and keeps ground truth stable (never silently invalidated by an
upstream repo changing). Retrieval evaluation uses a deterministic, dependency-free character-
n-gram embedding (`deterministicEmbedding.ts`) as a stand-in for Voyage AI, explicitly documented
as a lexical-overlap proxy, not a semantic one. `report.passed` (and the CLI's exit code) is
decided by a fixed set of regression gates (`regressionGates.ts`), deliberately separate from
each dataset case's own pass/fail — a documented, known limitation of the deterministic proxy
(one retrieval case) is allowed to show as a failed *case* without failing the *run*, while
actual structural/quality-floor violations do fail it.

Deliverables: `docs/EVALUATION_PHASE_PLAN.md`, this progress log.

Commit: `<pending>`

## Milestone 2 — Evaluation dataset and ground truth

`<pending>`

## Milestone 3 — Retrieval evaluation harness

`<pending>`

## Milestone 4 — Codebase Q&A evaluation

`<pending>`

## Milestone 5 — Code review evaluation

`<pending>`

## Milestone 6 — Regression and quality gates

`<pending>`

## Milestone 7 — Evaluation reporting and optional dashboard

`<pending>`

## Milestone 8 — Tests, Docker verification, documentation

`<pending>`
