/**
 * Regression gates (Milestone 6) — the explicit, justified thresholds that
 * actually decide the CLI's exit code / CI pass-fail, kept deliberately
 * separate from each case's own pass/fail in the per-feature reports.
 *
 * Two different things are easy to conflate and this file keeps them
 * apart on purpose:
 *   - A **golden-dataset case failing** means this run's output differs
 *     from this dataset's specific hand-authored expectation — useful,
 *     visible detail, but not automatically a regression. A query's exact
 *     top-ranked chunk can reasonably shift by one position between
 *     evaluator versions, or a deterministic proxy embedding (never a
 *     claim of real semantic understanding — see
 *     src/deterministicEmbedding.ts) can miss one lexically-distant
 *     phrasing without anything in the actual system being broken.
 *   - A **regression gate failing** means a structural safety invariant
 *     that must always hold was violated, or a quality metric dropped
 *     below a floor low enough that only a real regression could cross
 *     it. Only this decides `report.passed`.
 *
 * Thresholds below are chosen relative to this dataset's own size — as of
 * Phase 12, 14 retrieval cases, 7 Q&A cases, 11 review cases (grown from
 * Phase 11's 9/6/9 by Milestone 6's own adversarial additions; see
 * docs/RETRIEVAL_QUALITY_PHASE_PLAN.md, "Regression thresholds", for the
 * full before/after justification of every number below, not just this
 * file's short comments). Re-tightened in Phase 12 as the measured
 * baseline genuinely improved — never loosened to make an implementation
 * pass; see that same doc's own before/after table for the numbers this
 * was tightened from.
 */

import type { EvaluationReport } from "./types.js";

export type GateResult = { name: string; passed: boolean; detail: string };

const SECRET_PATTERNS = [/ghp_[A-Za-z0-9]{10,}/, /sk-ant-[A-Za-z0-9-]{10,}/, /AKIA[0-9A-Z]{16}/];

function scanForSecrets(report: EvaluationReport): string | null {
  const serialized = JSON.stringify(report);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) return pattern.source;
  }
  return null;
}

export function checkRegressionGates(report: EvaluationReport): GateResult[] {
  const { retrieval, qa, review } = report;

  const secretMatch = scanForSecrets(report);

  return [
    // --- Structural safety invariants: must always be exactly met. ---
    //
    // Q&A's invalidCitationRate moved into this zero-tolerance group in
    // Phase 12 (it was a 25%-floor quality gate in Phase 11): Milestone 3's
    // retrieval fix removed the one case that coupled this metric to the
    // deterministic proxy's own lexical limitations (see
    // docs/RETRIEVAL_QUALITY_PHASE_PLAN.md, Milestone 1's root-cause
    // analysis), so a genuine 0% is now achievable and expected on every
    // run, matching the task's own "invalid source references must remain
    // zero after validation" requirement. Production's actual structural
    // guarantee (Node independently re-validates every citation before
    // persisting — see api/src/lib/qaAnswerGrounding.ts) is exercised by
    // its own dedicated unit/Supertest suite, not re-tested by this
    // evaluation package; this gate now tracks it faithfully instead of
    // tolerating a known gap.
    {
      name: "No invalid Q&A citations (against this run's actual retrieval output)",
      passed: qa.aggregate.invalidCitationRate === 0,
      detail: `invalidCitationRate = ${qa.aggregate.invalidCitationRate}`,
    },
    {
      name: "No invalid review citations (every finding cites a real, in-scope source)",
      passed: review.aggregate.citationValidityRate === 1,
      detail: `citationValidityRate = ${review.aggregate.citationValidityRate}`,
    },
    {
      name: "No duplicate sources within one retrieval result",
      passed: retrieval.aggregate.duplicateSourceCaseRate === 0,
      detail: `duplicateSourceCaseRate = ${retrieval.aggregate.duplicateSourceCaseRate}`,
    },
    {
      name: "Every retrieval result stays within the production context-size budget",
      passed: retrieval.aggregate.contextSizeCompliant === 1,
      detail: `contextSizeCompliant = ${retrieval.aggregate.contextSizeCompliant}`,
    },
    {
      name: "No secret- or token-shaped string anywhere in the report",
      passed: secretMatch === null,
      detail: secretMatch ? `matched pattern ${secretMatch}` : "none found",
    },
    // --- Quality floors: loose enough that only a real regression crosses
    // them, tight enough to still catch one. Raised in Phase 12 to reflect
    // the genuinely improved, now-adversarially-tested baseline — see
    // docs/RETRIEVAL_QUALITY_PHASE_PLAN.md's before/after table. ---
    {
      name: "Retrieval recall@K stays at or above 85% (Phase 12 baseline: 100% on 14 cases, incl. 5 new adversarial ones)",
      passed: retrieval.aggregate.recallAtK! >= 0.85,
      detail: `recallAtK = ${retrieval.aggregate.recallAtK}`,
    },
    {
      name: "Retrieval precision@K stays at or above 40% (Phase 12 baseline: 55.7%, up from Phase 11's 28.9%)",
      passed: retrieval.aggregate.precisionAtK! >= 0.4,
      detail: `precisionAtK = ${retrieval.aggregate.precisionAtK}`,
    },
    {
      name: "Retrieval mean reciprocal rank stays at or above 65% (Phase 12 baseline: 82.1%, up from Phase 11's 66.1%)",
      passed: retrieval.aggregate.meanReciprocalRank! >= 0.65,
      detail: `meanReciprocalRank = ${retrieval.aggregate.meanReciprocalRank}`,
    },
    {
      name: "Q&A required-evidence citation recall stays at or above 85%",
      passed: qa.aggregate.citationRecall! >= 0.85,
      detail: `citationRecall = ${qa.aggregate.citationRecall}`,
    },
    {
      name: "Q&A unsupported-claim rate stays at 0%",
      passed: qa.aggregate.unsupportedClaimRate === 0,
      detail: `unsupportedClaimRate = ${qa.aggregate.unsupportedClaimRate}`,
    },
    {
      name: "Review finding recall stays at or above 85%",
      passed: review.aggregate.findingRecall! >= 0.85,
      detail: `findingRecall = ${review.aggregate.findingRecall}`,
    },
    {
      name: "Review false-positive rate stays at or below 25%",
      passed: review.aggregate.falsePositiveRate! <= 0.25,
      detail: `falsePositiveRate = ${review.aggregate.falsePositiveRate}`,
    },
    {
      name: "Review empty-review correctness stays at 100% (no invented findings on clean/injected/suspicious-but-valid code)",
      passed: review.aggregate.emptyReviewCorrectness === 1,
      detail: `emptyReviewCorrectness = ${review.aggregate.emptyReviewCorrectness}`,
    },
  ];
}
