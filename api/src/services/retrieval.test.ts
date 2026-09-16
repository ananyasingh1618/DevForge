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

describe("selectRankedResults — coherence-aware cutoff (retrieval-target-closure architecture work)", () => {
  // A query whose tokens deliberately appear in none of these candidates'
  // content/symbol/path, so lexical/identifier/file-path scores are all 0
  // and each candidate's combined score reduces to its own semantic
  // `score` alone — making the arithmetic below fully predictable rather
  // than depending on incidental lexical overlap.
  const NEUTRAL_QUERY = "xyzzy plugh wibble";

  it("keeps a same-top-level-directory candidate whose score is between the coherent and incoherent thresholds", () => {
    // threshold (coherent) = 0.9 * 0.78 = 0.702; a same-directory candidate
    // scoring 0.75 clears that, so it must be kept.
    const top = result({ chunkId: "top", score: 0.9, symbolName: "processOrder", content: "processOrder body", filePath: "services/orderProcessor.ts" });
    const sameDir = result({ chunkId: "sameDir", score: 0.75, symbolName: "calculateOrderTotal", content: "different body", filePath: "services/otherFile.ts" });
    const selected = selectRankedResults(NEUTRAL_QUERY, [top, sameDir], 10);
    expect(selected.map((r) => r.chunkId)).toContain("sameDir");
  });

  it(
    "excludes a different-directory candidate with no detected reference link once its score falls between " +
      "the coherent and incoherent thresholds, even though it would have cleared the plain single-tier cutoff",
    () => {
      // Same 0.75 score as the kept "sameDir" candidate above — the only
      // difference is the directory and the absence of a reference link —
      // demonstrating the coherence check, not just a weaker score. This is
      // the exact shape of the qa-password-check-style regression this
      // cutoff must not reintroduce above its currently-verified-safe
      // strictness — see INCOHERENCE_STRICTNESS's own doc comment.
      const top = result({ chunkId: "top", score: 0.9, symbolName: "processOrder", content: "processOrder body", filePath: "services/orderProcessor.ts" });
      const differentDir = result({ chunkId: "differentDir", score: 0.75, symbolName: "unrelatedHelper", content: "no reference to processOrder at all", filePath: "utils/somethingElse.ts" });
      const selected = selectRankedResults(NEUTRAL_QUERY, [top, differentDir], 10);
      expect(selected.map((r) => r.chunkId)).not.toContain("differentDir");
    },
  );

  it("keeps a different-directory candidate that has a detected call/import reference to the top match, at the same score the undetected-reference test excludes", () => {
    const top = result({
      chunkId: "top",
      score: 0.9,
      symbolName: "processOrder",
      filePath: "services/orderProcessor.ts",
      content: "async function processOrder() { findOrdersByUserId(); }",
    });
    const referencedElsewhere = result({ chunkId: "referenced", score: 0.75, symbolName: "findOrdersByUserId", content: "function findOrdersByUserId() {}", filePath: "db/orderRepository.ts" });
    const selected = selectRankedResults(NEUTRAL_QUERY, [top, referencedElsewhere], 10);
    expect(selected.map((r) => r.chunkId)).toContain("referenced");
  });
});
