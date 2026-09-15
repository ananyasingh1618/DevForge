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
 * Thresholds below are chosen relative to this dataset's own size (9
 * retrieval cases, 6 Q&A cases, 9 review cases with 9 expected findings
 * total) — see docs/EVALUATION_PHASE_PLAN.md ("Regression thresholds") for
 * the full justification of each number, not just this file's short
 * comments.
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
    // Q&A's own invalid-citation rate is deliberately NOT in this
    // zero-tolerance group, even though it sounds like the same kind of
    // check as review's: it's computed against THIS package's own
    // deterministic retrieval proxy's actual ranked output (a true
    // grounding check — "did the answer cite something really given to
    // it"), and in mock mode the hand-authored mock answers assume ideal
    // retrieval. A proxy-embedding miss on one lexically-distant query
    // (see src/deterministicEmbedding.ts's own documented limitation) can
    // make an otherwise-correct mock citation register as "invalid" here
    // without any real citation-safety violation — production's actual
    // structural guarantee (Node independently re-validates every citation
    // against the real retrieved range before persisting — see
    // api/src/services/qa.ts) is exercised by Phase 9's own Supertest
    // suite, not re-tested by this evaluation package. See the quality
    // floor below instead.
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
    // them, tight enough to still catch one. See the file header comment
    // and docs/EVALUATION_PHASE_PLAN.md for why each number was chosen. ---
    {
      name: "Retrieval recall@K stays at or above 75% (at most 2 of 9 cases may miss)",
      passed: retrieval.aggregate.recallAtK! >= 0.75,
      detail: `recallAtK = ${retrieval.aggregate.recallAtK}`,
    },
    {
      name: "Q&A required-evidence citation recall stays at or above 75%",
      passed: qa.aggregate.citationRecall! >= 0.75,
      detail: `citationRecall = ${qa.aggregate.citationRecall}`,
    },
    {
      name: "Q&A invalid-citation rate (against this run's actual retrieval output) stays at or below 25%",
      passed: qa.aggregate.invalidCitationRate! <= 0.25,
      detail: `invalidCitationRate = ${qa.aggregate.invalidCitationRate}`,
    },
    {
      name: "Q&A unsupported-claim rate stays at 0%",
      passed: qa.aggregate.unsupportedClaimRate === 0,
      detail: `unsupportedClaimRate = ${qa.aggregate.unsupportedClaimRate}`,
    },
    {
      name: "Review finding recall stays at or above 75%",
      passed: review.aggregate.findingRecall! >= 0.75,
      detail: `findingRecall = ${review.aggregate.findingRecall}`,
    },
    {
      name: "Review false-positive rate stays at or below 25%",
      passed: review.aggregate.falsePositiveRate! <= 0.25,
      detail: `falsePositiveRate = ${review.aggregate.falsePositiveRate}`,
    },
    {
      name: "Review empty-review correctness stays at 100% (no invented findings on clean/injected code)",
      passed: review.aggregate.emptyReviewCorrectness === 1,
      detail: `emptyReviewCorrectness = ${review.aggregate.emptyReviewCorrectness}`,
    },
  ];
}
