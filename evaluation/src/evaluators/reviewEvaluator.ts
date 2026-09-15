import { REVIEW_CASES, type ExpectedFinding, type MockFinding, type ReviewCase } from "../dataset/reviewCases.js";
import type { AggregateMetrics, CaseResult, FeatureReport } from "../types.js";

const SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"];

function severityInRange(severity: string, range: [string, string]): boolean {
  const idx = SEVERITY_ORDER.indexOf(severity);
  const lo = SEVERITY_ORDER.indexOf(range[0]);
  const hi = SEVERITY_ORDER.indexOf(range[1]);
  return idx >= 0 && idx >= lo && idx <= hi;
}

function keywordOverlap(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

/**
 * Whether a finding is "about the same underlying issue" as an expected
 * finding — matched by citation (must reference the expected finding's real
 * source) and loose keyword overlap in its title/description, deliberately
 * NOT by exact wording, category, or severity (those are scored separately
 * below as their own accuracy dimensions, per the task's "do not penalize
 * for different wording" instruction). See reviewEvaluator.test.ts for the
 * documented boundary cases this heuristic gets wrong.
 */
function matchesExpected(finding: MockFinding, expected: ExpectedFinding): boolean {
  if (!finding.citedChunkIds.includes(expected.expectedSourceChunkId)) return false;
  return keywordOverlap(`${finding.title} ${finding.description}`, expected.keywords);
}

function findingsAreDuplicates(a: MockFinding, b: MockFinding): boolean {
  if (a.category !== b.category) return false;
  const sameChunk = a.citedChunkIds.some((id) => b.citedChunkIds.includes(id));
  if (!sameChunk) return false;
  const aWords = new Set(a.title.toLowerCase().split(/\W+/).filter(Boolean));
  const bWords = new Set(b.title.toLowerCase().split(/\W+/).filter(Boolean));
  const overlap = [...aWords].filter((w) => bWords.has(w)).length;
  return overlap >= Math.min(aWords.size, bWords.size) * 0.5 && overlap > 0;
}

type FindingVerdict = {
  finding: MockFinding;
  matchedExpectedId: string | null;
  invalidCitations: string[];
  categoryCorrect: boolean | null;
  severityCorrect: boolean | null;
};

function evaluateCase(testCase: ReviewCase, findings: MockFinding[]): CaseResult {
  const relevant = new Set(testCase.relevantChunkIds);

  const verdicts: FindingVerdict[] = findings.map((finding) => {
    const invalidCitations = finding.citedChunkIds.filter((id) => !relevant.has(id));
    const matched = testCase.expectedFindings.find((e) => matchesExpected(finding, e));
    return {
      finding,
      matchedExpectedId: matched?.id ?? null,
      invalidCitations,
      categoryCorrect: matched ? finding.category === matched.category : null,
      severityCorrect: matched ? severityInRange(finding.severity, matched.severityRange) : null,
    };
  });

  // A duplicate is any finding matching an expected id already claimed by an
  // earlier finding, or any finding that's a near-duplicate of an earlier
  // unmatched one.
  const claimedExpectedIds = new Set<string>();
  const duplicateFindings: MockFinding[] = [];
  const seenUnmatched: MockFinding[] = [];
  for (const v of verdicts) {
    if (v.matchedExpectedId) {
      if (claimedExpectedIds.has(v.matchedExpectedId)) {
        duplicateFindings.push(v.finding);
      } else {
        claimedExpectedIds.add(v.matchedExpectedId);
      }
    } else {
      if (seenUnmatched.some((prior) => findingsAreDuplicates(prior, v.finding))) {
        duplicateFindings.push(v.finding);
      }
      seenUnmatched.push(v.finding);
    }
  }

  const matchedCount = new Set(verdicts.filter((v) => v.matchedExpectedId).map((v) => v.matchedExpectedId)).size;
  const falsePositives = verdicts.filter((v) => !v.matchedExpectedId);
  const missedExpected = testCase.expectedFindings.filter((e) => !claimedExpectedIds.has(e.id));
  const allInvalidCitations = verdicts.flatMap((v) => v.invalidCitations);

  const failureReasons: string[] = [];
  if (missedExpected.length > 0) {
    failureReasons.push(`Missed expected finding(s): ${missedExpected.map((e) => e.id).join(", ")}.`);
  }
  if (falsePositives.length > 0) {
    failureReasons.push(`Unsupported/unmatched finding(s) reported: ${falsePositives.map((v) => v.finding.title).join(", ")}.`);
  }
  if (allInvalidCitations.length > 0) {
    failureReasons.push(`Finding(s) cited a source outside this scope's evidence: ${allInvalidCitations.join(", ")}.`);
  }
  if (duplicateFindings.length > 0) {
    failureReasons.push(`${duplicateFindings.length} duplicate finding(s) reported.`);
  }
  const wrongCategory = verdicts.filter((v) => v.categoryCorrect === false);
  if (wrongCategory.length > 0) {
    failureReasons.push(`Matched finding(s) with wrong category: ${wrongCategory.map((v) => v.finding.title).join(", ")}.`);
  }
  const wrongSeverity = verdicts.filter((v) => v.severityCorrect === false);
  if (wrongSeverity.length > 0) {
    failureReasons.push(`Matched finding(s) with severity outside the expected range: ${wrongSeverity.map((v) => v.finding.title).join(", ")}.`);
  }

  const expectedCount = testCase.expectedFindings.length || 1;
  const score = matchedCount / expectedCount;

  return {
    caseId: testCase.id,
    feature: "review",
    passed: failureReasons.length === 0,
    score: testCase.expectedFindings.length === 0 ? (findings.length === 0 ? 1 : 0) : score,
    expected: { expectedFindings: testCase.expectedFindings.map((e) => e.id), knownNonFindings: testCase.knownNonFindings },
    actual: { findings: findings.map((f) => ({ title: f.title, category: f.category, severity: f.severity, citedChunkIds: f.citedChunkIds })) },
    relevantSources: testCase.relevantChunkIds,
    failureReasons,
  };
}

export function evaluateReview(
  cases: ReviewCase[] = REVIEW_CASES,
  findingsByCase: Map<string, MockFinding[]> = new Map(cases.map((c) => [c.id, c.mockFindings])),
): FeatureReport {
  const results = cases.map((c) => evaluateCase(c, findingsByCase.get(c.id) ?? c.mockFindings));
  const n = results.length || 1;

  let totalFindings = 0;
  let totalMatched = 0;
  let totalExpected = 0;
  let totalFalsePositives = 0;
  let totalInvalidCitations = 0;
  let totalCitations = 0;
  let totalDuplicates = 0;
  let severityCorrectCount = 0;
  let severityGradedCount = 0;
  let categoryCorrectCount = 0;
  let categoryGradedCount = 0;
  let calibratedConfidenceCount = 0;
  let emptyCaseCount = 0;
  let emptyCaseCorrect = 0;

  for (const c of cases) {
    const findings = findingsByCase.get(c.id) ?? c.mockFindings;
    totalFindings += findings.length;
    totalExpected += c.expectedFindings.length;
    for (const f of findings) {
      totalCitations += f.citedChunkIds.length;
      totalInvalidCitations += f.citedChunkIds.filter((id) => !c.relevantChunkIds.includes(id)).length;
      if (f.confidence === "high" || f.confidence === "medium") calibratedConfidenceCount++;
    }
    if (c.expectedFindings.length === 0) {
      emptyCaseCount++;
      if (findings.length === 0) emptyCaseCorrect++;
    }
  }

  for (const c of cases) {
    const findings = findingsByCase.get(c.id) ?? c.mockFindings;
    const claimed = new Set<string>();
    const seenUnmatched: MockFinding[] = [];
    for (const f of findings) {
      const matched = c.expectedFindings.find((e) => matchesExpected(f, e));
      if (matched) {
        if (claimed.has(matched.id)) {
          totalDuplicates++;
        } else {
          claimed.add(matched.id);
          totalMatched++;
          categoryGradedCount++;
          if (f.category === matched.category) categoryCorrectCount++;
          severityGradedCount++;
          if (severityInRange(f.severity, matched.severityRange)) severityCorrectCount++;
        }
      } else {
        if (seenUnmatched.some((prior) => findingsAreDuplicates(prior, f))) {
          totalDuplicates++;
        } else {
          totalFalsePositives++;
        }
        seenUnmatched.push(f);
      }
    }
  }

  const aggregate: AggregateMetrics = {
    findingPrecision: totalFindings > 0 ? totalMatched / totalFindings : 1,
    findingRecall: totalExpected > 0 ? totalMatched / totalExpected : 1,
    falsePositiveRate: totalFindings > 0 ? totalFalsePositives / totalFindings : 0,
    duplicateFindingRate: totalFindings > 0 ? totalDuplicates / totalFindings : 0,
    citationValidityRate: totalCitations > 0 ? (totalCitations - totalInvalidCitations) / totalCitations : 1,
    categoryAccuracy: categoryGradedCount > 0 ? categoryCorrectCount / categoryGradedCount : 1,
    severityAccuracy: severityGradedCount > 0 ? severityCorrectCount / severityGradedCount : 1,
    // Weak, explicitly-documented-as-weak proxy — see docs/EVALUATION_PHASE_PLAN.md
    // ("What cannot be measured reliably"): whether a matched finding's
    // confidence was at least "medium", not a real calibration curve.
    confidenceCalibrationProxy: totalMatched > 0 ? calibratedConfidenceCount / totalFindings : 1,
    emptyReviewCorrectness: emptyCaseCount > 0 ? emptyCaseCorrect / emptyCaseCount : 1,
    caseCount: n,
  };

  return { feature: "review", aggregate, cases: results };
}
