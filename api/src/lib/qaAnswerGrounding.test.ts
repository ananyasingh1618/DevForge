import { describe, expect, it } from "vitest";
import { groundAnswer, UNGROUNDED_FALLBACK_ANSWER, type RawQaAnswer } from "./qaAnswerGrounding.js";

function raw(overrides: Partial<RawQaAnswer> = {}): RawQaAnswer {
  return {
    answer: "The password is compared with ===.",
    citedSourceNumbers: [1],
    insufficientEvidence: false,
    ...overrides,
  };
}

describe("groundAnswer", () => {
  it("keeps a valid, in-range citation unchanged", () => {
    const result = groundAnswer(raw({ citedSourceNumbers: [1] }), 3);
    expect(result.citedOrders).toEqual(new Set([1]));
    expect(result.overridden).toBe(false);
    expect(result.answer).toBe(raw().answer);
  });

  it("drops an out-of-range citation number (too high)", () => {
    const result = groundAnswer(raw({ citedSourceNumbers: [5] }), 3);
    expect(result.citedOrders).toEqual(new Set());
  });

  it("drops a zero/negative citation number", () => {
    const result = groundAnswer(raw({ citedSourceNumbers: [0, -1, -99] }), 3);
    expect(result.citedOrders).toEqual(new Set());
  });

  it("drops a non-integer citation number", () => {
    const result = groundAnswer(raw({ citedSourceNumbers: [1.5] }), 3);
    expect(result.citedOrders).toEqual(new Set());
  });

  it("deduplicates a repeated citation number", () => {
    const result = groundAnswer(raw({ citedSourceNumbers: [1, 1, 1, 2, 2] }), 3);
    expect(result.citedOrders).toEqual(new Set([1, 2]));
  });

  it("keeps only the valid numbers from a mixed valid/invalid list", () => {
    const result = groundAnswer(raw({ citedSourceNumbers: [1, 99, -5, 2, 1.5] }), 3);
    expect(result.citedOrders).toEqual(new Set([1, 2]));
    expect(result.overridden).toBe(false);
  });

  it("falls back to a safe insufficient-evidence answer when zero valid citations remain and the provider claimed sufficiency", () => {
    const result = groundAnswer(raw({ citedSourceNumbers: [99, -1], insufficientEvidence: false }), 3);
    expect(result.overridden).toBe(true);
    expect(result.insufficientEvidence).toBe(true);
    expect(result.answer).toBe(UNGROUNDED_FALLBACK_ANSWER);
    expect(result.citedOrders.size).toBe(0);
  });

  it("does not override an answer that already honestly declares insufficient evidence with zero citations", () => {
    const result = groundAnswer(
      raw({ citedSourceNumbers: [], insufficientEvidence: true, answer: "No relevant code was found." }),
      3,
    );
    expect(result.overridden).toBe(false);
    expect(result.answer).toBe("No relevant code was found.");
    expect(result.insufficientEvidence).toBe(true);
  });

  it("does not override when sourceCount is 0 (the zero-evidence case is handled upstream, not here)", () => {
    const result = groundAnswer(raw({ citedSourceNumbers: [], insufficientEvidence: false }), 0);
    expect(result.overridden).toBe(false);
  });

  it("never converts an invalid citation into a different, valid one — it only drops or falls back", () => {
    const result = groundAnswer(raw({ citedSourceNumbers: [99] }), 3);
    // The only real source is #1, but a dropped invalid citation to #99
    // must never silently become a citation to #1.
    expect(result.citedOrders.has(1)).toBe(false);
  });

  it("is fully deterministic across repeated calls", () => {
    const input = raw({ citedSourceNumbers: [1, 99, 2] });
    const first = groundAnswer(input, 3);
    const second = groundAnswer(input, 3);
    expect(first).toEqual(second);
  });
});
