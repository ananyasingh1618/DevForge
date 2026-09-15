/**
 * Reproducible retrieval-ranking latency benchmark (Phase 13, Milestone
 * 13.7 — see docs/BENCHMARK_EXPANSION_PHASE_PLAN.md). Measures how long
 * the same ranking algorithm production's `search()` and this package's
 * own `rankChunks()` use (semantic cosine + hybrid score + adaptive
 * cutoff) takes as the candidate pool grows, using the real
 * `deterministicEmbedding`/`hybridScore` functions directly against
 * synthetic in-memory content (see syntheticCorpus.ts) so this can run at
 * sizes far beyond the real, hand-authored fixture's 67 chunks without
 * writing thousands of files to disk.
 *
 * This measures ranking-algorithm cost in isolation — it does NOT include
 * network/database/embedding-provider latency, which dominate a real
 * `POST /search` request; see docs/BENCHMARK_EXPANSION_COMPLETION_REPORT.md
 * for the separately-measured, live, end-to-end numbers against a running
 * Docker stack, explicitly labeled as measuring this fixture's own scale,
 * never claimed as a production/at-scale number.
 */

import { deterministicEmbedding, cosineSimilarity } from "../deterministicEmbedding.js";
import { combinedScore, computeScoreSignals } from "../hybridScore.js";
import { generateSyntheticChunks } from "./syntheticCorpus.js";

export type LatencyStats = { p50: number; p95: number; p99: number; mean: number; sampleCount: number };

function percentile(sortedMs: number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx]!;
}

function statsOf(samplesMs: number[]): LatencyStats {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: sorted.reduce((s, v) => s + v, 0) / (sorted.length || 1),
    sampleCount: sorted.length,
  };
}

const QUERIES = [
  "How does DevForge validate a user record before processing it?",
  "fetchOrder7",
  "Where is a payment session token resolved?",
  "something about handling a request and computing a response",
  "createUser42",
];

/** Ranks `corpusSize` synthetic chunks against a fixed query set, once. */
function rankOnce(corpusSize: number): void {
  const corpus = generateSyntheticChunks(corpusSize);
  for (const query of QUERIES) {
    const queryVector = deterministicEmbedding(query);
    const scored = corpus.map(({ chunk, content }) => {
      const semanticScore = cosineSimilarity(queryVector, deterministicEmbedding(content));
      const signals = computeScoreSignals(query, semanticScore, {
        content,
        symbolName: chunk.symbolName,
        filePath: chunk.filePath,
      });
      return combinedScore(signals);
    });
    scored.sort((a, b) => b - a);
  }
}

/** Runs `iterations` full ranking passes at `corpusSize` and returns
 * latency stats per single query (not per full multi-query pass), matching
 * how a real search request ranks against one query at a time. */
export function benchmarkRankingLatency(corpusSize: number, iterations: number, warmupIterations: number): LatencyStats {
  for (let i = 0; i < warmupIterations; i++) rankOnce(corpusSize);

  const samplesMs: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    rankOnce(corpusSize);
    const elapsed = performance.now() - start;
    samplesMs.push(elapsed / QUERIES.length);
  }
  return statsOf(samplesMs);
}
