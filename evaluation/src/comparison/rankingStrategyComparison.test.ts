import { describe, expect, it } from "vitest";
import { compareStrategies, evaluateCurrentProductionReference, ALL_STRATEGIES, CURRENT_CUTOFF } from "./rankingStrategyComparison.js";

describe("compareStrategies", () => {
  it("returns exactly the six named strategies, in order", () => {
    const results = compareStrategies();
    expect(results.map((r) => r.strategy)).toEqual(ALL_STRATEGIES);
    expect(ALL_STRATEGIES.length).toBe(6);
  });

  it("every metric is a finite fraction in [0, 1] (or a non-negative average count)", () => {
    for (const r of compareStrategies()) {
      expect(r.recallAtK).toBeGreaterThanOrEqual(0);
      expect(r.recallAtK).toBeLessThanOrEqual(1);
      expect(r.meanReciprocalRank).toBeGreaterThanOrEqual(0);
      expect(r.meanReciprocalRank).toBeLessThanOrEqual(1);
      expect(r.precisionAtK).toBeGreaterThanOrEqual(0);
      expect(r.precisionAtK).toBeLessThanOrEqual(1);
      expect(r.usefulContextRate).toBeGreaterThanOrEqual(0);
      expect(r.usefulContextRate).toBeLessThanOrEqual(1);
      expect(r.avgReturnedCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("the cutoff-based strategies return fewer average results than the fixed-K strategies (evidence the cutoff is doing something)", () => {
    const results = compareStrategies();
    const byName = new Map(results.map((r) => [r.strategy, r]));
    const fixedK = byName.get("current-hybrid")!;
    const withCutoff = byName.get("improved-hybrid-plus-cutoff")!;
    expect(withCutoff.avgReturnedCount).toBeLessThan(fixedK.avgReturnedCount);
  });

  it("is fully deterministic across repeated runs", () => {
    expect(compareStrategies()).toEqual(compareStrategies());
  });
});

describe("evaluateCurrentProductionReference", () => {
  it("mirrors the current production RELATIVE_SCORE_CUTOFF value used in api/src/services/retrieval.ts", () => {
    // Not imported (this package has no dependency on `api`) — a
    // deliberate tripwire, same convention as retrievalEvaluator.test.ts's
    // own cutoff-parity check.
    expect(CURRENT_CUTOFF).toBe(0.7);
  });

  it("returns a well-formed result comparable in shape to the six named strategies", () => {
    const ref = evaluateCurrentProductionReference();
    expect(ref.recallAtK).toBeGreaterThan(0);
    expect(ref.avgReturnedCount).toBeGreaterThan(0);
    expect(ref.avgReturnedCount).toBeLessThanOrEqual(5);
  });
});
