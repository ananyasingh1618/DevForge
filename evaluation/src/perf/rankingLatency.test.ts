import { describe, expect, it } from "vitest";
import { benchmarkRankingLatency } from "./rankingLatency.js";
import { generateSyntheticChunks } from "./syntheticCorpus.js";

describe("generateSyntheticChunks", () => {
  it("is deterministic — the same count always produces identical chunks", () => {
    const a = generateSyntheticChunks(20);
    const b = generateSyntheticChunks(20);
    expect(a).toEqual(b);
  });

  it("produces the requested number of chunks with unique ids", () => {
    const chunks = generateSyntheticChunks(50);
    expect(chunks.length).toBe(50);
    expect(new Set(chunks.map((c) => c.chunk.chunkId)).size).toBe(50);
  });

  it("never collides with any real fixture chunk id (synthetic-* prefix is reserved)", () => {
    const chunks = generateSyntheticChunks(10);
    for (const { chunk } of chunks) {
      expect(chunk.chunkId.startsWith("synthetic-")).toBe(true);
    }
  });
});

describe("benchmarkRankingLatency", () => {
  it("returns positive, finite latency stats", () => {
    const stats = benchmarkRankingLatency(20, 3, 1);
    expect(stats.p50).toBeGreaterThan(0);
    expect(stats.p95).toBeGreaterThanOrEqual(stats.p50);
    expect(stats.p99).toBeGreaterThanOrEqual(stats.p95);
    expect(stats.sampleCount).toBe(3);
  });

  it("latency grows with corpus size (not flat/constant regardless of input)", () => {
    const small = benchmarkRankingLatency(10, 5, 2);
    const large = benchmarkRankingLatency(500, 5, 2);
    expect(large.mean).toBeGreaterThan(small.mean);
  });
});
