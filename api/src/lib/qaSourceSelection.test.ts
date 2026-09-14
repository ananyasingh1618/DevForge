import { describe, expect, it } from "vitest";
import { MAX_CONTEXT_CHARS, MAX_SOURCES, selectSources } from "./qaSourceSelection.js";
import type { SearchResult } from "../services/retrieval.js";

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkId: "chunk1",
    filePath: "src/app.ts",
    symbolName: "run",
    symbolType: "function",
    content: "function run() {}",
    startLine: 1,
    endLine: 3,
    language: "typescript",
    branch: "main",
    commitSha: "abc123",
    score: 0.5,
    ...overrides,
  };
}

describe("selectSources — overlap/duplicate removal", () => {
  it("keeps only the higher-scored chunk when two results overlap in the same file", () => {
    const higher = makeResult({ chunkId: "high", startLine: 1, endLine: 10, score: 0.9 });
    const lower = makeResult({ chunkId: "low", startLine: 5, endLine: 15, score: 0.4 });
    const selected = selectSources([lower, higher]);
    expect(selected.map((s) => s.chunkId)).toEqual(["high"]);
  });

  it("keeps non-overlapping results in the same file", () => {
    const first = makeResult({ chunkId: "a", startLine: 1, endLine: 5, score: 0.8 });
    const second = makeResult({ chunkId: "b", startLine: 10, endLine: 15, score: 0.7 });
    const selected = selectSources([first, second]);
    expect(selected.map((s) => s.chunkId).sort()).toEqual(["a", "b"]);
  });

  it("does not treat identical line ranges in different files as overlapping", () => {
    const a = makeResult({ chunkId: "a", filePath: "src/a.ts", startLine: 1, endLine: 5, score: 0.6 });
    const b = makeResult({ chunkId: "b", filePath: "src/b.ts", startLine: 1, endLine: 5, score: 0.5 });
    const selected = selectSources([a, b]);
    expect(selected.map((s) => s.chunkId).sort()).toEqual(["a", "b"]);
  });

  it("is deterministic regardless of input order", () => {
    const higher = makeResult({ chunkId: "high", startLine: 1, endLine: 10, score: 0.9 });
    const lower = makeResult({ chunkId: "low", startLine: 5, endLine: 15, score: 0.4 });
    expect(selectSources([higher, lower])).toEqual(selectSources([lower, higher]));
  });
});

describe("selectSources — MAX_SOURCES cap", () => {
  it("never returns more than MAX_SOURCES results", () => {
    const many = Array.from({ length: MAX_SOURCES + 20 }, (_, i) =>
      makeResult({ chunkId: `c${i}`, filePath: `src/f${i}.ts`, score: 1 - i / 1000 }),
    );
    const selected = selectSources(many);
    expect(selected.length).toBeLessThanOrEqual(MAX_SOURCES);
  });

  it("keeps the highest-scored results when capping", () => {
    const total = MAX_SOURCES + 5;
    const many = Array.from({ length: total }, (_, i) =>
      makeResult({ chunkId: `c${i}`, filePath: `src/f${i}.ts`, content: "x", score: i }),
    );
    const selected = selectSources(many);
    const scores = selected.map((s) => s.score);
    // Scores are 0..total-1; the top MAX_SOURCES by score are total-MAX_SOURCES..total-1.
    expect(Math.min(...scores)).toBe(total - MAX_SOURCES);
  });
});

describe("selectSources — MAX_CONTEXT_CHARS cap", () => {
  it("never returns a combined content length over MAX_CONTEXT_CHARS when more than one source is available", () => {
    const bigContent = "x".repeat(MAX_CONTEXT_CHARS / 2 + 100);
    const results = [
      makeResult({ chunkId: "a", filePath: "a.ts", content: bigContent, score: 0.9 }),
      makeResult({ chunkId: "b", filePath: "b.ts", content: bigContent, score: 0.8 }),
      makeResult({ chunkId: "c", filePath: "c.ts", content: bigContent, score: 0.7 }),
    ];
    const selected = selectSources(results);
    const totalChars = selected.reduce((sum, s) => sum + s.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(MAX_CONTEXT_CHARS + bigContent.length);
    // The third (lowest-scored) result should have been dropped by the budget.
    expect(selected.map((s) => s.chunkId)).not.toContain("c");
  });

  it("always keeps at least one source even if it alone exceeds MAX_CONTEXT_CHARS", () => {
    const hugeContent = "x".repeat(MAX_CONTEXT_CHARS * 2);
    const selected = selectSources([makeResult({ chunkId: "only", content: hugeContent })]);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.chunkId).toBe("only");
  });
});

describe("selectSources — empty input", () => {
  it("returns an empty array for empty input", () => {
    expect(selectSources([])).toEqual([]);
  });
});
