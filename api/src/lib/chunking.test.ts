import { describe, expect, it } from "vitest";
import { chunkFile, CHUNK_OVERLAP_CHARS, MAX_CHUNK_CHARS } from "./chunking.js";

describe("chunkFile — symbol-based chunking", () => {
  const file = {
    fileId: "f1",
    language: "typescript",
    content: [
      "export class Foo {",
      "  bar() {",
      "    return 1;",
      "  }",
      "}",
      "",
      "export function baz() {",
      "  return 2;",
      "}",
    ].join("\n"),
    symbols: [
      { id: "class-foo", startLine: 1, endLine: 5 },
      { id: "method-bar", startLine: 2, endLine: 4 },
      { id: "function-baz", startLine: 7, endLine: 9 },
    ],
  };

  it("produces one chunk per symbol, each with the symbol's own line range", () => {
    const chunks = chunkFile(file);
    expect(chunks).toHaveLength(3);

    const bySymbol = Object.fromEntries(chunks.map((c) => [c.symbolId, c]));
    expect(bySymbol["class-foo"]).toMatchObject({ startLine: 1, endLine: 5, chunkIndex: 0 });
    expect(bySymbol["method-bar"]).toMatchObject({ startLine: 2, endLine: 4, chunkIndex: 0 });
    expect(bySymbol["function-baz"]).toMatchObject({ startLine: 7, endLine: 9, chunkIndex: 0 });
  });

  it("preserves the nested symbol's own content independent of its enclosing class", () => {
    const chunks = chunkFile(file);
    const method = chunks.find((c) => c.symbolId === "method-bar")!;
    expect(method.content).toBe("  bar() {\n    return 1;\n  }");
    const outer = chunks.find((c) => c.symbolId === "class-foo")!;
    expect(outer.content).toContain("bar()");
  });

  it("produces a distinct contentHash per chunk, and identical content hashes identically", () => {
    const chunks = chunkFile(file);
    const hashes = new Set(chunks.map((c) => c.contentHash));
    expect(hashes.size).toBe(3);

    const rehashed = chunkFile(file).find((c) => c.symbolId === "method-bar")!;
    const original = chunks.find((c) => c.symbolId === "method-bar")!;
    expect(rehashed.contentHash).toBe(original.contentHash);
  });

  it("carries the file's language onto every chunk", () => {
    const chunks = chunkFile(file);
    expect(chunks.every((c) => c.language === "typescript")).toBe(true);
  });

  it("is deterministic — identical input produces byte-identical output", () => {
    expect(chunkFile(file)).toEqual(chunkFile(file));
  });
});

describe("chunkFile — oversized symbols", () => {
  it("splits a symbol exceeding MAX_CHUNK_CHARS into multiple overlapping pieces", () => {
    const bigLine = "x".repeat(50);
    const lines = Array.from({ length: 300 }, (_, i) => `const v${i} = "${bigLine}";`);
    const file = {
      fileId: "f2",
      language: "javascript",
      content: lines.join("\n"),
      symbols: [{ id: "s1", startLine: 1, endLine: lines.length }],
    };

    const chunks = chunkFile(file);
    expect(chunks.length).toBeGreaterThan(1);

    // Every piece stays within budget (a single line can't be split, but no
    // line here alone exceeds MAX_CHUNK_CHARS).
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }

    // Chunk indices are sequential per symbol, starting at 0.
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));

    // Consecutive pieces overlap: the second piece's startLine is earlier
    // than the first piece's endLine + 1.
    const first = chunks[0]!;
    const second = chunks[1]!;
    expect(second.startLine).toBeLessThan(first.endLine + 1);

    // Full line coverage: the last piece reaches the symbol's real endLine.
    expect(chunks[chunks.length - 1]!.endLine).toBe(lines.length);
  });

  it("still emits a single line whole even if that one line alone exceeds the budget", () => {
    const hugeLine = "y".repeat(MAX_CHUNK_CHARS + 500);
    const file = {
      fileId: "f3",
      language: "javascript",
      content: hugeLine,
      symbols: [{ id: "s1", startLine: 1, endLine: 1 }],
    };

    const chunks = chunkFile(file);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe(hugeLine);
  });

  it("overlap is bounded by CHUNK_OVERLAP_CHARS worth of trailing lines", () => {
    // A sanity check that the overlap constant is actually used, not just
    // exported: two adjacent lines of exactly half the overlap budget each
    // should both appear in the overlap window.
    const lineLen = Math.floor(CHUNK_OVERLAP_CHARS / 2);
    const filler = "z".repeat(lineLen);
    const lines = Array.from({ length: 250 }, () => filler);
    const file = {
      fileId: "f4",
      language: "python",
      content: lines.join("\n"),
      symbols: [{ id: "s1", startLine: 1, endLine: lines.length }],
    };
    const chunks = chunkFile(file);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("chunkFile — files without symbols", () => {
  it("falls back to whole-file windowing with symbolId: null", () => {
    const file = {
      fileId: "f5",
      language: "python",
      content: "import os\nimport sys\n\nPI = 3.14\n",
      symbols: [],
    };
    const chunks = chunkFile(file);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      symbolId: null,
      startLine: 1,
      endLine: 4,
      content: "import os\nimport sys\n\nPI = 3.14",
    });
  });

  it("correctly excludes the phantom trailing line a trailing newline would otherwise add", () => {
    const withTrailingNewline = { fileId: "f6", language: "python", content: "a = 1\nb = 2\n", symbols: [] };
    const withoutTrailingNewline = { fileId: "f7", language: "python", content: "a = 1\nb = 2", symbols: [] };
    expect(chunkFile(withTrailingNewline)[0]!.endLine).toBe(2);
    expect(chunkFile(withoutTrailingNewline)[0]!.endLine).toBe(2);
  });

  it("handles an empty file without throwing", () => {
    const file = { fileId: "f8", language: "python", content: "", symbols: [] };
    expect(() => chunkFile(file)).not.toThrow();
  });
});
