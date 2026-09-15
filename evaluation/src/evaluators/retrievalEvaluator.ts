import { cosineSimilarity, deterministicEmbedding } from "../deterministicEmbedding.js";
import { chunkContent, FIXTURE_CHUNKS, type FixtureChunk } from "../dataset/fixtureRepo.js";
import { RETRIEVAL_CASES, type RetrievalCase } from "../dataset/retrievalCases.js";
import { combinedScore, computeScoreSignals } from "../hybridScore.js";
import type { AggregateMetrics, CaseResult, FeatureReport } from "../types.js";

/** Mirrors api/src/services/retrieval.ts's own RELATIVE_SCORE_CUTOFF exactly
 * — see that file and docs/RETRIEVAL_QUALITY_PHASE_PLAN.md for the full
 * rationale. Kept as a literal, re-verified-equal constant (not imported —
 * this package has no dependency on `api`) by
 * retrievalEvaluator.test.ts's own "mirrors production" test. */
export const RELATIVE_SCORE_CUTOFF = 0.7;

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
 * cosine similarity, then re-ranks/selects by the hybrid combined score
 * (semantic + lexical + identifier + file-path) with the same relative-
 * to-top cutoff production's selectRankedResults() applies — the
 * evaluation package's stand-in for Phase 8's search(), used by every
 * evaluator that needs retrieved evidence. `RankedChunk.score` stays pure
 * semantic cosine similarity, mirroring SearchResult's own preserved
 * `score` field contract. Can return fewer than `k` results when the
 * score falls off a cliff (see RELATIVE_SCORE_CUTOFF) — always keeps at
 * least the top-ranked chunk when any exist. */
export function rankChunks(query: string, chunks: FixtureChunk[] = FIXTURE_CHUNKS, k = TOP_K): RankedChunk[] {
  if (chunks.length === 0) return [];
  const queryVector = deterministicEmbedding(query);
  const withCombined = chunks.map((chunk) => {
    const content = chunkContent(chunk);
    const semanticScore = cosineSimilarity(queryVector, deterministicEmbedding(content));
    const signals = computeScoreSignals(query, semanticScore, {
      content,
      symbolName: chunk.symbolName,
      filePath: chunk.filePath,
    });
    return { chunk, score: semanticScore, combined: combinedScore(signals) };
  });

  withCombined.sort((a, b) => b.combined - a.combined);

  const topCombined = withCombined[0]!.combined;
  const threshold = topCombined * RELATIVE_SCORE_CUTOFF;

  const selected: RankedChunk[] = [];
  for (const { chunk, score, combined } of withCombined) {
    if (selected.length >= k) break;
    if (selected.length > 0 && combined < threshold) break;
    selected.push({ chunk, score });
  }
  return selected;
}

function evaluateCase(testCase: RetrievalCase, chunks: FixtureChunk[], k: number): CaseResult {
  const ranked = rankChunks(testCase.query, chunks, k);
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

export function evaluateRetrieval(
  cases: RetrievalCase[] = RETRIEVAL_CASES,
  k = TOP_K,
  chunks: FixtureChunk[] = FIXTURE_CHUNKS,
): FeatureReport {
  const results = cases.map((c) => evaluateCase(c, chunks, k));

  const n = results.length || 1;
  const hits = results.filter((r) => r.score > 0).length;
  const emptyResults = results.filter((r) => (r.actual as { rankedIds: string[] }).rankedIds.length === 0).length;
  const duplicateCases = results.filter((r) => r.failureReasons.some((f) => f.includes("duplicate"))).length;
  const contextCompliant = cases.every((c) => {
    const ranked = rankChunks(c.query, chunks, k);
    return ranked.reduce((sum, r) => sum + chunkContent(r.chunk).length, 0) <= MAX_CONTEXT_CHARS;
  });
  const precisionValues = results.map((r) => {
    const actual = r.actual as { rankedIds: string[] };
    const c = cases.find((cc) => cc.id === r.caseId)!;
    const acceptable = new Set([...c.expectedChunkIds, ...c.acceptableAlternativeChunkIds]);
    const relevant = actual.rankedIds.filter((id) => acceptable.has(id)).length;
    return actual.rankedIds.length > 0 ? relevant / actual.rankedIds.length : 0;
  });

  // Rank distribution (Milestone 6 reporting): reciprocal rank (r.score) is
  // 1/rank when the first expected chunk was found, 0 on a miss — a clean,
  // exact way to recover each case's actual rank without a second pass.
  const rankAt1 = results.filter((r) => r.score === 1).length;
  const rankAt2to3 = results.filter((r) => r.score > 1 / 3 && r.score < 1).length;
  const rankAt4PlusOrMissed = n - rankAt1 - rankAt2to3;

  const aggregate: AggregateMetrics = {
    recallAtK: hits / n,
    hitRate: hits / n,
    meanReciprocalRank: results.reduce((sum, r) => sum + r.score, 0) / n,
    precisionAtK: precisionValues.reduce((sum, v) => sum + v, 0) / n,
    emptyResultRate: emptyResults / n,
    duplicateSourceCaseRate: duplicateCases / n,
    contextSizeCompliant: contextCompliant ? 1 : 0,
    // Fraction of cases whose first relevant result ranked exactly 1st /
    // ranked 2nd-3rd / ranked 4th-or-later-or-missed entirely — sums to 1.
    rankDistributionTop1Rate: rankAt1 / n,
    rankDistributionTop2To3Rate: rankAt2to3 / n,
    rankDistribution4PlusOrMissedRate: rankAt4PlusOrMissed / n,
    caseCount: n,
  };

  return { feature: "retrieval", aggregate, cases: results };
}
