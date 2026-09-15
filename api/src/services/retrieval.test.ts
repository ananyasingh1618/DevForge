import { describe, expect, it } from "vitest";
import { selectRankedResults, RELATIVE_SCORE_CUTOFF, type SearchResult } from "./retrieval.js";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkId: "c1",
    filePath: "auth/session.ts",
    symbolName: "verifyPassword",
    symbolType: "function",
    content: "export function verifyPassword() {}",
    startLine: 1,
    endLine: 3,
    language: "typescript",
    branch: "main",
    commitSha: "abc123",
    score: 0.5,
    ...overrides,
  };
}

describe("selectRankedResults", () => {
  it("returns an empty array for no candidates", () => {
    expect(selectRankedResults("anything", [], 10)).toEqual([]);
  });

  it("never drops the single top-ranked result, even with a weak score", () => {
    const weak = result({ chunkId: "weak", score: 0.01, symbolName: "unrelated", content: "x", filePath: "z.ts" });
    expect(selectRankedResults("verifyPassword", [weak], 10)).toHaveLength(1);
  });

  it("keeps every candidate whose combined score is within the relative cutoff of the top score", () => {
    // Both candidates share the same exact-match symbol name (e.g. two
    // genuinely equivalent implementations, like Phase 12's own
    // github-get-default-branch / github-get-default-branch-safe case) so
    // both legitimately score close to the top — a realistic scenario for
    // "should both be kept", distinct from the "clearly weaker" test below.
    const strong = result({ chunkId: "strong", score: 0.9, symbolName: "verifyPassword" });
    const alsoStrong = result({ chunkId: "alsoStrong", score: 0.85, symbolName: "verifyPassword" });
    const selected = selectRankedResults("verifyPassword", [strong, alsoStrong], 10);
    expect(selected.map((r) => r.chunkId)).toEqual(expect.arrayContaining(["strong", "alsoStrong"]));
  });

  it("drops a candidate far below the top score's relative cutoff", () => {
    const strong = result({ chunkId: "strong", score: 0.9, symbolName: "verifyPassword" });
    const weak = result({ chunkId: "weak", score: 0.05, symbolName: "unrelated", content: "totally different code", filePath: "z.ts" });
    const selected = selectRankedResults("verifyPassword", [strong, weak], 10);
    expect(selected.map((r) => r.chunkId)).toEqual(["strong"]);
  });

  it("never returns more than the requested limit", () => {
    const candidates = Array.from({ length: 5 }, (_, i) => result({ chunkId: `c${i}`, score: 0.9 - i * 0.01 }));
    const selected = selectRankedResults("verifyPassword", candidates, 2);
    expect(selected).toHaveLength(2);
  });

  it("preserves SearchResult's own score field as the original cosine similarity, not the combined score", () => {
    const strong = result({ chunkId: "strong", score: 0.42, symbolName: "verifyPassword" });
    const [selected] = selectRankedResults("verifyPassword", [strong], 10);
    expect(selected!.score).toBe(0.42);
  });

  it("boosts an exact identifier match to the top even when its cosine score is slightly lower", () => {
    const exactMatch = result({ chunkId: "exact", score: 0.5, symbolName: "verifyPassword", content: "export function verifyPassword() {}" });
    const higherCosine = result({
      chunkId: "higherCosine",
      score: 0.55,
      symbolName: "unrelatedThing",
      content: "export function unrelatedThing() {}",
      filePath: "other.ts",
    });
    const selected = selectRankedResults("what does verifyPassword do?", [higherCosine, exactMatch], 10);
    expect(selected[0]!.chunkId).toBe("exact");
  });

  it("is fully deterministic across repeated calls", () => {
    const candidates = [result({ chunkId: "a", score: 0.5 }), result({ chunkId: "b", score: 0.3, symbolName: "other" })];
    const first = selectRankedResults("verifyPassword", candidates, 10);
    const second = selectRankedResults("verifyPassword", candidates, 10);
    expect(first).toEqual(second);
  });

  it("documents the cutoff constant as a fraction between 0 and 1", () => {
    expect(RELATIVE_SCORE_CUTOFF).toBeGreaterThan(0);
    expect(RELATIVE_SCORE_CUTOFF).toBeLessThanOrEqual(1);
  });
});
