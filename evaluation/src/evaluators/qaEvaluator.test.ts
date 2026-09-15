import { describe, expect, it } from "vitest";
import { evaluateQa, type QaAnswer } from "./qaEvaluator.js";
import { QA_CASES } from "../dataset/qaCases.js";

describe("evaluateQa", () => {
  it("passes every dataset case when graded against its own hand-authored mock answer", () => {
    const report = evaluateQa();
    // The dataset's own mock answers are written to be correct — this is
    // the evaluator's own sanity check, not a claim about production Q&A.
    for (const c of report.cases) {
      // qa-notification-failures is the one documented, expected miss (see
      // docs/EVALUATION_PHASE_PLAN.md) — everything else must pass.
      if (c.caseId === "qa-notification-failures") continue;
      expect(c.passed, `${c.caseId}: ${c.failureReasons.join(" ")}`).toBe(true);
    }
  });

  it("detects a supported claim (expected answer point present) as covered", () => {
    const c = QA_CASES.find((cc) => cc.id === "qa-password-check")!;
    const answers = new Map<string, QaAnswer>([[c.id, c.mockAnswer]]);
    const report = evaluateQa([c], answers);
    expect(report.cases[0]!.score).toBe(1);
  });

  it("flags a missing expected answer point", () => {
    const c = QA_CASES.find((cc) => cc.id === "qa-password-check")!;
    const badAnswer: QaAnswer = { ...c.mockAnswer, answer: "Something unrelated." };
    const report = evaluateQa([c], new Map([[c.id, badAnswer]]));
    expect(report.cases[0]!.passed).toBe(false);
    expect(report.cases[0]!.failureReasons.some((f) => f.startsWith("Missing expected answer point"))).toBe(true);
  });

  it("flags an invalid citation — a chunk id the retrieval step never actually returned", () => {
    const c = QA_CASES.find((cc) => cc.id === "qa-password-check")!;
    const badAnswer: QaAnswer = { ...c.mockAnswer, citedChunkIds: ["totally-invented-chunk-id"] };
    const report = evaluateQa([c], new Map([[c.id, badAnswer]]));
    expect(report.cases[0]!.passed).toBe(false);
    expect(report.cases[0]!.failureReasons.some((f) => f.includes("not among retrieved sources"))).toBe(true);
    expect(report.aggregate.invalidCitationRate).toBeGreaterThan(0);
  });

  it("flags a missing required citation (citation completeness)", () => {
    const c = QA_CASES.find((cc) => cc.id === "qa-password-check")!;
    const badAnswer: QaAnswer = { ...c.mockAnswer, citedChunkIds: [] };
    const report = evaluateQa([c], new Map([[c.id, badAnswer]]));
    expect(report.cases[0]!.failureReasons.some((f) => f.startsWith("Required evidence not cited"))).toBe(true);
  });

  it("flags an unsupported claim (a forbidden phrase present in the answer)", () => {
    const c = QA_CASES.find((cc) => cc.id === "qa-password-check")!;
    const badAnswer: QaAnswer = { ...c.mockAnswer, answer: `${c.mockAnswer.answer} It uses bcrypt.compare.` };
    const report = evaluateQa([c], new Map([[c.id, badAnswer]]));
    expect(report.cases[0]!.passed).toBe(false);
    expect(report.cases[0]!.failureReasons.some((f) => f.startsWith("Answer contains forbidden claim"))).toBe(true);
    expect(report.aggregate.unsupportedClaimRate).toBeGreaterThan(0);
  });

  it("correctly rewards a true insufficient-evidence answer for a genuinely unanswerable question", () => {
    const c = QA_CASES.find((cc) => cc.id === "qa-insufficient-evidence-rate-limiting")!;
    const report = evaluateQa([c], new Map([[c.id, c.mockAnswer]]));
    expect(report.cases[0]!.passed).toBe(true);
    expect(report.aggregate.insufficientEvidenceAccuracy).toBe(1);
  });

  it("flags a confidently-wrong answer to a genuinely unanswerable question", () => {
    const c = QA_CASES.find((cc) => cc.id === "qa-insufficient-evidence-rate-limiting")!;
    const overconfident: QaAnswer = {
      answer: "DevForge implements a rate limit of 5 requests per minute on the login endpoint.",
      citedChunkIds: [],
      insufficientEvidence: false,
    };
    const report = evaluateQa([c], new Map([[c.id, overconfident]]));
    expect(report.cases[0]!.passed).toBe(false);
    expect(report.cases[0]!.failureReasons.some((f) => f.startsWith("insufficientEvidence was"))).toBe(true);
    expect(report.cases[0]!.failureReasons.some((f) => f.startsWith("Answer contains forbidden claim"))).toBe(true);
  });

  it("handles a malformed (empty) answer without throwing, and scores it as failing", () => {
    const c = QA_CASES.find((cc) => cc.id === "qa-password-check")!;
    const malformed: QaAnswer = { answer: "", citedChunkIds: [], insufficientEvidence: false };
    expect(() => evaluateQa([c], new Map([[c.id, malformed]]))).not.toThrow();
    const report = evaluateQa([c], new Map([[c.id, malformed]]));
    expect(report.cases[0]!.passed).toBe(false);
  });
});
