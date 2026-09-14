import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "./similarity.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });

  it("returns a value between -1 and 1 for arbitrary vectors", () => {
    const score = cosineSimilarity([0.1, 0.9, 0.4], [0.5, 0.2, 0.8]);
    expect(score).toBeGreaterThan(-1);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 for a zero vector rather than dividing by zero", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("throws for mismatched vector lengths rather than returning a meaningless score", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/different lengths/);
  });
});
