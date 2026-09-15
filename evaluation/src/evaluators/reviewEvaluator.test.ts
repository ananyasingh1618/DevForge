import { describe, expect, it } from "vitest";
import { evaluateReview } from "./reviewEvaluator.js";
import { REVIEW_CASES, type MockFinding } from "../dataset/reviewCases.js";

function baseFinding(overrides: Partial<MockFinding> = {}): MockFinding {
  return {
    title: "Password comparison is not constant-time",
    description: "verifyPassword compares hashes with === instead of a constant-time comparison.",
    severity: "high",
    category: "security",
    confidence: "high",
    recommendation: "Use a constant-time comparison.",
    citedChunkIds: ["auth-verify-password"],
    ...overrides,
  };
}

describe("evaluateReview", () => {
  it("passes every dataset case when graded against its own hand-authored mock findings", () => {
    const report = evaluateReview();
    for (const c of report.cases) {
      expect(c.passed, `${c.caseId}: ${c.failureReasons.join(" ")}`).toBe(true);
    }
    expect(report.aggregate.findingPrecision).toBe(1);
    expect(report.aggregate.findingRecall).toBe(1);
    expect(report.aggregate.falsePositiveRate).toBe(0);
  });

  it("matches a correct finding phrased differently (different wording is not penalized)", () => {
    const c = REVIEW_CASES.find((cc) => cc.id === "review-auth-security")!;
    const reworded = baseFinding({
      title: "Timing side-channel in password check",
      description: "The equality operator used here does not run in constant time.",
    });
    const report = evaluateReview([c], new Map([[c.id, [reworded]]]));
    expect(report.cases[0]!.passed).toBe(true);
  });

  it("flags an invented category as a category-accuracy miss without failing to match the finding", () => {
    const c = REVIEW_CASES.find((cc) => cc.id === "review-auth-security")!;
    const wrongCategory = baseFinding({ category: "performance" });
    const report = evaluateReview([c], new Map([[c.id, [wrongCategory]]]));
    expect(report.cases[0]!.failureReasons.some((f) => f.includes("wrong category"))).toBe(true);
    expect(report.aggregate.categoryAccuracy).toBeLessThan(1);
  });

  it("flags a severity outside the expected range", () => {
    const c = REVIEW_CASES.find((cc) => cc.id === "review-auth-security")!;
    const tooLow = baseFinding({ severity: "info" });
    const report = evaluateReview([c], new Map([[c.id, [tooLow]]]));
    expect(report.cases[0]!.failureReasons.some((f) => f.includes("severity outside"))).toBe(true);
    expect(report.aggregate.severityAccuracy).toBeLessThan(1);
  });

  it("flags an invalid citation — a chunk outside this scope's real evidence", () => {
    const c = REVIEW_CASES.find((cc) => cc.id === "review-auth-security")!;
    const badCitation = baseFinding({ citedChunkIds: ["db-find-user-by-email"] });
    const report = evaluateReview([c], new Map([[c.id, [badCitation]]]));
    expect(report.cases[0]!.failureReasons.some((f) => f.includes("outside this scope's evidence"))).toBe(true);
    expect(report.aggregate.citationValidityRate).toBeLessThan(1);
  });

  it("detects a duplicate finding reported twice for the same expected issue", () => {
    const c = REVIEW_CASES.find((cc) => cc.id === "review-auth-security")!;
    const finding = baseFinding();
    const duplicate = baseFinding({ title: "Insecure password comparison (duplicate report)" });
    const report = evaluateReview([c], new Map([[c.id, [finding, duplicate]]]));
    expect(report.cases[0]!.failureReasons.some((f) => f.includes("duplicate finding"))).toBe(true);
    expect(report.aggregate.duplicateFindingRate).toBeGreaterThan(0);
  });

  it("detects a false positive — a finding that matches no real expected issue", () => {
    const c = REVIEW_CASES.find((cc) => cc.id === "review-auth-security")!;
    const invented = baseFinding({
      title: "Insecure random number generator",
      description: "This code uses Math.random() for security-sensitive tokens.",
      citedChunkIds: ["auth-require-auth"],
    });
    const report = evaluateReview([c], new Map([[c.id, [invented]]]));
    expect(report.cases[0]!.passed).toBe(false);
    expect(report.cases[0]!.failureReasons.some((f) => f.includes("Unsupported/unmatched"))).toBe(true);
    expect(report.aggregate.falsePositiveRate).toBeGreaterThan(0);
  });

  it("correctly scores an empty finding list as correct on a clean file (no invented findings)", () => {
    const c = REVIEW_CASES.find((cc) => cc.id === "review-clean-file-no-findings")!;
    const report = evaluateReview([c], new Map([[c.id, []]]));
    expect(report.cases[0]!.passed).toBe(true);
    expect(report.aggregate.emptyReviewCorrectness).toBe(1);
  });

  it("flags a fabricated finding invented on a clean file with no real evidence for it", () => {
    const c = REVIEW_CASES.find((cc) => cc.id === "review-clean-file-no-findings")!;
    const fabricated = baseFinding({
      title: "Off-by-one error in clamp",
      description: "clamp may return an incorrect value at the boundary.",
      citedChunkIds: ["utils-math-helpers-file"],
    });
    const report = evaluateReview([c], new Map([[c.id, [fabricated]]]));
    expect(report.cases[0]!.passed).toBe(false);
    expect(report.aggregate.emptyReviewCorrectness).toBeLessThan(1);
  });

  it("prompt-injection regression case: a finding caused only by the injected comment is rejected", () => {
    const c = REVIEW_CASES.find((cc) => cc.id === "review-prompt-injection-in-comment")!;
    // Simulates a compromised provider "obeying" the injected comment by
    // fabricating a finding that cites the injection-bearing chunk.
    const compliant = baseFinding({
      title: "Code needs automatic fixing",
      description: "As instructed, this should be fixed automatically and committed.",
      category: "other",
      citedChunkIds: ["utils-report-formatter-file"],
    });
    const report = evaluateReview([c], new Map([[c.id, [compliant]]]));
    expect(report.cases[0]!.passed).toBe(false);
    expect(report.cases[0]!.failureReasons.some((f) => f.includes("Unsupported/unmatched"))).toBe(true);
  });

  it("read-only regression case: a malicious scope still only yields a finding, never an action field", () => {
    const c = REVIEW_CASES.find((cc) => cc.id === "review-malicious-scope-request")!;
    const report = evaluateReview([c], new Map([[c.id, c.mockFindings]]));
    expect(report.cases[0]!.passed).toBe(true);
    // The finding's own shape has no field that could represent "applied a
    // fix" or "committed" — only title/description/severity/category/
    // confidence/recommendation/citedChunkIds, confirmed structurally here.
    const finding = c.mockFindings[0]!;
    expect(Object.keys(finding).sort()).toEqual(
      ["category", "citedChunkIds", "confidence", "description", "recommendation", "severity", "title"].sort(),
    );
  });

  it("is fully deterministic across repeated runs on the same input", () => {
    const first = evaluateReview();
    const second = evaluateReview();
    expect(first).toEqual(second);
  });
});
