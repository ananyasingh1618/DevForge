import { rankChunks, TOP_K } from "./retrievalEvaluator.js";
import { QA_CASES, type QaCase } from "../dataset/qaCases.js";
import type { AggregateMetrics, CaseResult, FeatureReport } from "../types.js";

/**
 * Scores one Q&A case's answer (mock or real) against its ground truth.
 *
 * Known heuristic limitations (see docs/EVALUATION_PHASE_PLAN.md, "What
 * cannot be measured reliably"): `expectedAnswerPoints`/`forbiddenClaims`
 * matching is plain case-insensitive substring search, not real semantic
 * entailment — an answer can phrase a correct point in different words and
 * be scored as missing it, and a forbidden phrase can appear inside an
 * unrelated sentence and be scored as a false violation. This is a
 * deliberate, documented tradeoff for determinism (see
 * qaEvaluator.test.ts for its known false-negative/false-positive
 * boundary cases) — it is not a claim of real natural-language
 * understanding.
 */
export type QaAnswer = {
  answer: string;
  citedChunkIds: string[];
  insufficientEvidence: boolean;
};

function includesPhrase(haystack: string, phrase: string): boolean {
  return haystack.toLowerCase().includes(phrase.toLowerCase());
}

function evaluateCase(testCase: QaCase, answer: QaAnswer, k: number): CaseResult {
  const retrieved = rankChunks(testCase.question, undefined, k).map((r) => r.chunk.chunkId);

  const requiredEvidencePresent = testCase.requiredEvidenceChunkIds.filter((id) => retrieved.includes(id));
  const requiredEvidenceMissingFromRetrieval = testCase.requiredEvidenceChunkIds.filter((id) => !retrieved.includes(id));

  const validCitations = answer.citedChunkIds.filter((id) => retrieved.includes(id));
  const invalidCitations = answer.citedChunkIds.filter((id) => !retrieved.includes(id));
  const supportedCitations = answer.citedChunkIds.filter((id) => testCase.requiredEvidenceChunkIds.includes(id));
  const missingCitations = testCase.requiredEvidenceChunkIds.filter((id) => !answer.citedChunkIds.includes(id));

  const coveredPoints = testCase.expectedAnswerPoints.filter((p) => includesPhrase(answer.answer, p));
  const violatedClaims = testCase.forbiddenClaims.filter((p) => includesPhrase(answer.answer, p));

  const insufficientEvidenceCorrect = answer.insufficientEvidence === testCase.insufficientEvidenceExpected;

  const failureReasons: string[] = [];
  if (invalidCitations.length > 0) failureReasons.push(`Cited chunk(s) not among retrieved sources: ${invalidCitations.join(", ")}.`);
  if (missingCitations.length > 0) failureReasons.push(`Required evidence not cited: ${missingCitations.join(", ")}.`);
  if (violatedClaims.length > 0) failureReasons.push(`Answer contains forbidden claim(s): ${violatedClaims.join(", ")}.`);
  if (!insufficientEvidenceCorrect) {
    failureReasons.push(
      `insufficientEvidence was ${answer.insufficientEvidence}, expected ${testCase.insufficientEvidenceExpected}.`,
    );
  }
  if (requiredEvidenceMissingFromRetrieval.length > 0) {
    failureReasons.push(`Required evidence not surfaced by retrieval: ${requiredEvidenceMissingFromRetrieval.join(", ")}.`);
  }
  const pointCoverage = testCase.expectedAnswerPoints.length === 0 ? 1 : coveredPoints.length / testCase.expectedAnswerPoints.length;
  if (pointCoverage < 1) {
    failureReasons.push(
      `Missing expected answer point(s): ${testCase.expectedAnswerPoints.filter((p) => !coveredPoints.includes(p)).join(", ")}.`,
    );
  }

  const passed = failureReasons.length === 0;

  return {
    caseId: testCase.id,
    feature: "qa",
    passed,
    score: pointCoverage,
    expected: {
      expectedAnswerPoints: testCase.expectedAnswerPoints,
      requiredEvidenceChunkIds: testCase.requiredEvidenceChunkIds,
      insufficientEvidenceExpected: testCase.insufficientEvidenceExpected,
    },
    actual: { answer: answer.answer, citedChunkIds: answer.citedChunkIds, insufficientEvidence: answer.insufficientEvidence, retrieved },
    relevantSources: retrieved,
    failureReasons,
  };
}

export function evaluateQa(
  cases: QaCase[] = QA_CASES,
  answers: Map<string, QaAnswer> = new Map(cases.map((c) => [c.id, c.mockAnswer])),
  k = TOP_K,
): FeatureReport {
  const results = cases.map((c) => evaluateCase(c, answers.get(c.id) ?? c.mockAnswer, k));
  const n = results.length || 1;

  const allCited = results.flatMap((r) => (r.actual as { citedChunkIds: string[] }).citedChunkIds);
  const allInvalidCited = results.flatMap((r) =>
    (r.actual as { citedChunkIds: string[] }).citedChunkIds.filter((id) => !r.relevantSources.includes(id)),
  );
  const totalRequired = cases.reduce((sum, c) => sum + c.requiredEvidenceChunkIds.length, 0);
  const totalCitedRequired = results.reduce((sum, r) => {
    const c = cases.find((cc) => cc.id === r.caseId)!;
    const actual = r.actual as { citedChunkIds: string[] };
    return sum + c.requiredEvidenceChunkIds.filter((id) => actual.citedChunkIds.includes(id)).length;
  }, 0);
  const supportedCitedCount = results.reduce((sum, r) => {
    const c = cases.find((cc) => cc.id === r.caseId)!;
    const actual = r.actual as { citedChunkIds: string[] };
    return sum + actual.citedChunkIds.filter((id) => c.requiredEvidenceChunkIds.includes(id)).length;
  }, 0);
  const unsupportedClaimCases = results.filter((r) => r.failureReasons.some((f) => f.startsWith("Answer contains forbidden"))).length;
  const insufficientEvidenceCorrectCount = results.filter(
    (r) => !r.failureReasons.some((f) => f.startsWith("insufficientEvidence was")),
  ).length;

  const aggregate: AggregateMetrics = {
    citationPrecision: allCited.length > 0 ? supportedCitedCount / allCited.length : 1,
    citationRecall: totalRequired > 0 ? totalCitedRequired / totalRequired : 1,
    invalidCitationRate: allCited.length > 0 ? allInvalidCited.length / allCited.length : 0,
    missingCitationRate: totalRequired > 0 ? (totalRequired - totalCitedRequired) / totalRequired : 0,
    unsupportedClaimRate: unsupportedClaimCases / n,
    insufficientEvidenceAccuracy: insufficientEvidenceCorrectCount / n,
    expectedPointCoverage: results.reduce((sum, r) => sum + r.score, 0) / n,
    caseCount: n,
  };

  return { feature: "qa", aggregate, cases: results };
}
