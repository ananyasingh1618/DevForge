import { cosineSimilarity, deterministicEmbedding } from "../deterministicEmbedding.js";
import { chunkContent, FIXTURE_CHUNKS, type FixtureChunk } from "../dataset/fixtureRepo.js";
import { RETRIEVAL_CASES, type RetrievalCase } from "../dataset/retrievalCases.js";
import type { AggregateMetrics, CaseResult, FeatureReport } from "../types.js";

/** Mirrors Phase 8's own default search limit (api/src/schemas/retrieval.ts's
 * `limit` default is 10; MAX_SOURCES for Q&A/review is 8) — 5 is used here
 * deliberately smaller, since this fixture dataset only has 16 chunks total
 * and a tighter K makes ranking quality differences actually visible. */
export const TOP_K = 5;

/** Mirrors lib/qaSourceSelection.ts's MAX_CONTEXT_CHARS, so this fixture's
 * compliance check exercises the same real production budget. */
export const MAX_CONTEXT_CHARS = 16_000;

export type RankedChunk = { chunk: FixtureChunk; score: number };

/** Ranks every fixture chunk against a query by deterministic-embedding
 * cosine similarity — the evaluation package's stand-in for Phase 8's
 * search(), used by every evaluator that needs retrieved evidence. */
export function rankChunks(query: string, chunks: FixtureChunk[] = FIXTURE_CHUNKS, k = TOP_K): RankedChunk[] {
  const queryVector = deterministicEmbedding(query);
  return chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryVector, deterministicEmbedding(chunkContent(chunk))) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function evaluateCase(testCase: RetrievalCase, k: number): CaseResult {
  const ranked = rankChunks(testCase.query, FIXTURE_CHUNKS, k);
  const rankedIds = ranked.map((r) => r.chunk.chunkId);
  const acceptable = new Set([...testCase.expectedChunkIds, ...testCase.acceptableAlternativeChunkIds]);

  const hitRank = rankedIds.findIndex((id) => testCase.expectedChunkIds.includes(id));
  const hit = hitRank !== -1;
  const reciprocalRank = hit ? 1 / (hitRank + 1) : 0;
  const relevantInTopK = rankedIds.filter((id) => acceptable.has(id)).length;
  const precisionAtK = rankedIds.length > 0 ? relevantInTopK / rankedIds.length : 0;
  const duplicates = rankedIds.length - new Set(rankedIds).size;
  const totalChars = ranked.reduce((sum, r) => sum + chunkContent(r.chunk).length, 0);

  const failureReasons: string[] = [];
  if (!hit) failureReasons.push(`None of expectedChunkIds ${JSON.stringify(testCase.expectedChunkIds)} appeared in top ${k}.`);
  if (duplicates > 0) failureReasons.push(`${duplicates} duplicate chunk(s) in the ranked result.`);
  if (rankedIds.length === 0) failureReasons.push("Empty result set.");

  return {
    caseId: testCase.id,
    feature: "retrieval",
    passed: hit && duplicates === 0,
    score: reciprocalRank,
    expected: { expectedChunkIds: testCase.expectedChunkIds, acceptableAlternativeChunkIds: testCase.acceptableAlternativeChunkIds },
    actual: { rankedIds, scores: ranked.map((r) => Number(r.score.toFixed(4))) },
    relevantSources: rankedIds,
    failureReasons,
  };
}

export function evaluateRetrieval(cases: RetrievalCase[] = RETRIEVAL_CASES, k = TOP_K): FeatureReport {
  const results = cases.map((c) => evaluateCase(c, k));

  const n = results.length || 1;
  const hits = results.filter((r) => r.score > 0).length;
  const emptyResults = results.filter((r) => (r.actual as { rankedIds: string[] }).rankedIds.length === 0).length;
  const duplicateCases = results.filter((r) => r.failureReasons.some((f) => f.includes("duplicate"))).length;
  const contextCompliant = cases.every((c) => {
    const ranked = rankChunks(c.query, FIXTURE_CHUNKS, k);
    return ranked.reduce((sum, r) => sum + chunkContent(r.chunk).length, 0) <= MAX_CONTEXT_CHARS;
  });
  const precisionValues = results.map((r) => {
    const actual = r.actual as { rankedIds: string[] };
    const c = cases.find((cc) => cc.id === r.caseId)!;
    const acceptable = new Set([...c.expectedChunkIds, ...c.acceptableAlternativeChunkIds]);
    const relevant = actual.rankedIds.filter((id) => acceptable.has(id)).length;
    return actual.rankedIds.length > 0 ? relevant / actual.rankedIds.length : 0;
  });

  const aggregate: AggregateMetrics = {
    recallAtK: hits / n,
    hitRate: hits / n,
    meanReciprocalRank: results.reduce((sum, r) => sum + r.score, 0) / n,
    precisionAtK: precisionValues.reduce((sum, v) => sum + v, 0) / n,
    emptyResultRate: emptyResults / n,
    duplicateSourceCaseRate: duplicateCases / n,
    contextSizeCompliant: contextCompliant ? 1 : 0,
    caseCount: n,
  };

  return { feature: "retrieval", aggregate, cases: results };
}
