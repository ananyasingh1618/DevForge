import { describe, expect, it } from "vitest";
import { filterValidFindings } from "./reviewFindingFiltering.js";
import type { ReviewFindingFromAi } from "./aiServiceClient.js";

function finding(overrides: Partial<ReviewFindingFromAi> = {}): ReviewFindingFromAi {
  return {
    title: "t",
    description: "d",
    severity: "medium",
    category: "other",
    confidence: "medium",
    recommendation: "r",
    citedSourceNumbers: [1],
    ...overrides,
  };
}

describe("filterValidFindings", () => {
  it("keeps a finding whose citations are all within range", () => {
    const result = filterValidFindings([finding({ citedSourceNumbers: [1, 2] })], 3);
    expect(result).toHaveLength(1);
    expect(result[0]!.citedSourceNumbers).toEqual([1, 2]);
  });

  it("drops out-of-range and non-integer source numbers from a finding, keeping the finding", () => {
    const result = filterValidFindings([finding({ citedSourceNumbers: [1, 99, -1, 0, 2] })], 2);
    expect(result).toHaveLength(1);
    expect(result[0]!.citedSourceNumbers).toEqual([1, 2]);
  });

  it("drops an entire finding left with zero valid citations", () => {
    const result = filterValidFindings(
      [finding({ title: "fabricated", citedSourceNumbers: [42, -5] })],
      2,
    );
    expect(result).toHaveLength(0);
  });

  it("keeps only the findings with real evidence when some are fabricated and some are real", () => {
    const result = filterValidFindings(
      [
        finding({ title: "fabricated", citedSourceNumbers: [99] }),
        finding({ title: "real", citedSourceNumbers: [1] }),
      ],
      2,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("real");
  });

  it("deduplicates repeated citations to the same source within one finding", () => {
    const result = filterValidFindings([finding({ citedSourceNumbers: [1, 1, 1] })], 2);
    expect(result[0]!.citedSourceNumbers).toEqual([1]);
  });

  it("returns an empty array for an empty input", () => {
    expect(filterValidFindings([], 5)).toEqual([]);
  });

  it("drops a finding that cited nothing at all", () => {
    const result = filterValidFindings([finding({ citedSourceNumbers: [] })], 5);
    expect(result).toHaveLength(0);
  });

  it("is deterministic for the same input", () => {
    const findings = [finding({ citedSourceNumbers: [2, 1] })];
    expect(filterValidFindings(findings, 3)).toEqual(filterValidFindings(findings, 3));
  });

  it("keeps multiple distinct findings that legitimately cite the same real source", () => {
    // Phase 12, Milestone 5: one source (e.g. a function with both a
    // security issue and a separate reliability issue) can genuinely
    // support more than one independent finding — this must not be
    // conflated with a duplicate/fabricated citation.
    const findings = [
      finding({ title: "Security issue", citedSourceNumbers: [1] }),
      finding({ title: "Reliability issue", citedSourceNumbers: [1] }),
    ];
    const result = filterValidFindings(findings, 3);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.title)).toEqual(["Security issue", "Reliability issue"]);
    expect(result.every((f) => f.citedSourceNumbers.includes(1))).toBe(true);
  });
});
