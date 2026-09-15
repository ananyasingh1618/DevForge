/**
 * Deterministic synthetic chunk generator for performance benchmarking
 * only (Phase 13, Milestone 13.7 — see docs/BENCHMARK_EXPANSION_PHASE_PLAN.md).
 * These chunks are NEVER added to the graded dataset (RETRIEVAL_CASES never
 * references any id this module produces) — they exist purely to measure
 * how ranking latency scales with candidate-pool size beyond the real,
 * hand-authored fixture's 67 chunks, using content shaped like the real
 * fixture's own code (function declarations with short doc comments)
 * rather than random bytes, so the benchmark exercises realistic string
 * lengths and tokenization behavior.
 */

import type { FixtureChunk } from "../dataset/fixtureRepo.js";

const WORDS = [
  "validate",
  "process",
  "fetch",
  "compute",
  "resolve",
  "handle",
  "normalize",
  "update",
  "delete",
  "create",
  "order",
  "user",
  "payment",
  "session",
  "token",
  "request",
  "response",
  "record",
  "status",
  "result",
];

function pseudoRandomWord(seed: number): string {
  return WORDS[seed % WORDS.length]!;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Generates `count` synthetic in-memory chunks (never written to disk —
 * chunkContent() is bypassed via a synthetic-content lookup passed
 * alongside). Deterministic: the same `count` always produces the same
 * chunks. */
export function generateSyntheticChunks(count: number): { chunk: FixtureChunk; content: string }[] {
  const results: { chunk: FixtureChunk; content: string }[] = [];
  for (let i = 0; i < count; i++) {
    const verb = pseudoRandomWord(i);
    const noun = pseudoRandomWord(i * 7 + 3);
    const symbolName = `${verb}${capitalize(noun)}${i}`;
    const content =
      `/**\n * ${capitalize(verb)}s the given ${noun} and returns the outcome.\n */\n` +
      `export function ${symbolName}(${noun}: unknown): unknown {\n` +
      `  const ${verb}ed = ${noun};\n` +
      `  return ${verb}ed;\n` +
      `}\n`;
    results.push({
      chunk: {
        chunkId: `synthetic-${i}`,
        filePath: `synthetic/perf/file${Math.floor(i / 10)}.ts`,
        symbolName,
        symbolType: "function",
        startLine: 1,
        endLine: content.split("\n").length,
        language: "typescript",
      },
      content,
    });
  }
  return results;
}
