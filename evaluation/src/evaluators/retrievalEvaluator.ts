import { cosineSimilarity, deterministicEmbedding } from "../deterministicEmbedding.js";
import { chunkContent, FIXTURE_CHUNKS, type FixtureChunk } from "../dataset/fixtureRepo.js";
import { RETRIEVAL_CASES, type RetrievalCase } from "../dataset/retrievalCases.js";
import { combinedScore, computeScoreSignals, HYBRID_WEIGHTS } from "../hybridScore.js";
import { applyIntentRerank, areLinked, buildReferenceGraph } from "../rerank.js";
import type { AggregateMetrics, CaseResult, FeatureReport } from "../types.js";

/** Mirrors api/src/services/retrieval.ts's own RELATIVE_SCORE_CUTOFF exactly
 * — see that file and docs/RETRIEVAL_QUALITY_PHASE_PLAN.md for the full
 * rationale (tightened 0.7 → 0.78 in Phase 14, Milestone 14.2). Kept as a
 * literal, re-verified-equal constant (not imported — this package has no
 * dependency on `api`) by retrievalEvaluator.test.ts's own "mirrors
 * production" test. */
export const RELATIVE_SCORE_CUTOFF = 0.78;

/** Mirrors Phase 8's own default search limit (api/src/schemas/retrieval.ts's
 * `limit` default is 10; MAX_SOURCES for Q&A/review is 8) — 5 is used here
 * deliberately smaller, since this fixture dataset only has 16 chunks total
 * and a tighter K makes ranking quality differences actually visible. */
export const TOP_K = 5;

/** Mirrors lib/qaSourceSelection.ts's MAX_CONTEXT_CHARS, so this fixture's
 * compliance check exercises the same real production budget. */
export const MAX_CONTEXT_CHARS = 16_000;

export type RankedChunk = { chunk: FixtureChunk; score: number };

/** Mirrors api/src/services/retrieval.ts's own INCOHERENCE_STRICTNESS
 * exactly — see that file for the full rationale (retrieval-target-closure
 * architecture work, docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md). */
const INCOHERENCE_STRICTNESS = 1.15;

function topLevelDirectory(filePath: string): string {
  const idx = filePath.indexOf("/");
  return idx === -1 ? "" : filePath.slice(0, idx);
}

/** Ranks every fixture chunk against a query by deterministic-embedding
 * cosine similarity, then re-ranks/selects by the hybrid combined score
 * (semantic + lexical + identifier + file-path), intent-aware reranking,
 * and a coherence-aware adaptive cutoff — mirroring
 * api/src/services/retrieval.ts's own selectRankedResults() exactly (see
 * that file's own doc comment for the full per-stage rationale). The
 * evaluation package's stand-in for Phase 8's search(), used by every
 * evaluator that needs retrieved evidence. `RankedChunk.score` stays pure
 * semantic cosine similarity, mirroring SearchResult's own preserved
 * `score` field contract. Can return fewer than `k` results when the
 * score falls off a cliff — always keeps at least the top-ranked chunk
 * when any exist. */
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
    const combined = combinedScore(signals);
    // Mirrors api/src/services/retrieval.ts's own cutoff-basis desensitization
    // exactly (Part A, Milestone A3/A4 — see
    // docs/RETRIEVAL_TARGET_CLOSURE_REPORT.md, "Case 3"): the threshold's
    // reference point excludes the binary exact-identifier jackpot, so one
    // candidate's exact match doesn't unfairly raise the bar for every
    // other candidate. Ranking order still uses the full combined score.
    const cutoffBasis = combined - HYBRID_WEIGHTS.exactIdentifier * signals.exactIdentifierScore;
    return {
      chunkId: chunk.chunkId,
      symbolName: chunk.symbolName,
      filePath: chunk.filePath,
      content,
      chunk,
      score: semanticScore,
      combined,
      cutoffBasis,
    };
  });

  const reranked = applyIntentRerank(query, withCombined);
  reranked.sort((a, b) => b.adjustedScore - a.adjustedScore);

  const topAdjustedCutoffBasis = Math.max(...reranked.map((c) => c.adjustedCutoffBasis));
  const baseThreshold = topAdjustedCutoffBasis * RELATIVE_SCORE_CUTOFF;

  const referenceGraph = buildReferenceGraph(reranked);
  const top = reranked[0]!;

  const selected: RankedChunk[] = [];
  for (const candidate of reranked) {
    if (selected.length >= k) break;
    if (selected.length === 0) {
      selected.push({ chunk: candidate.chunk, score: candidate.score });
      continue;
    }
    const coherent =
      topLevelDirectory(candidate.filePath) === topLevelDirectory(top.filePath) ||
      areLinked(referenceGraph, candidate.chunkId, top.chunkId);
    const effectiveThreshold = coherent ? baseThreshold : baseThreshold * INCOHERENCE_STRICTNESS;
    if (candidate.adjustedScore < effectiveThreshold) continue;
    selected.push({ chunk: candidate.chunk, score: candidate.score });
  }
  return selected;
}

/**
 * Phase 13 (docs/BENCHMARK_EXPANSION_PHASE_PLAN.md, Milestone 13.3) graded-
 * relevance resolution — reads a case's new optional fields with the exact
 * defaulting rules documented on `RetrievalCase` itself, so every Phase
 * 11/12 case (none of which set these fields) resolves to precisely its
 * old binary-ish behavior.
 */
export type GradedCase = {
  direct: string[];
  supporting: string[];
  irrelevant: string[];
  answerable: boolean;
  category: string;
  language: string;
  difficulty: string;
};

export function gradedCase(testCase: RetrievalCase): GradedCase {
  return {
    direct: testCase.directSourceChunkIds ?? testCase.expectedChunkIds,
    supporting: testCase.supportingSourceChunkIds ?? testCase.acceptableAlternativeChunkIds,
    irrelevant: testCase.irrelevantExampleChunkIds ?? [],
    answerable: testCase.answerable ?? true,
    category: testCase.category ?? "natural-language-behavior",
    language: testCase.language ?? "typescript",
    difficulty: testCase.difficulty ?? "medium",
  };
}

export function relevanceGrade(chunkId: string, direct: string[], supporting: string[]): 0 | 1 | 2 {
  if (direct.includes(chunkId)) return 2;
  if (supporting.includes(chunkId)) return 1;
  return 0;
}

/** Standard graded discounted cumulative gain: sum of (2^grade - 1) /
 * log2(rank + 1), rank 1-indexed. */
function dcg(grades: number[]): number {
  return grades.reduce((sum, g, i) => sum + (2 ** g - 1) / Math.log2(i + 2), 0);
}

/** nDCG@k against the graded relevance model above. Defined as 1 (nothing
 * to rank, vacuously perfect) when the case has no direct/supporting
 * sources at all — matches this file's existing vacuous-case convention
 * (e.g. precisionAtK's own `: 0`/`: 1` fallbacks elsewhere). */
function ndcgAtK(rankedIds: string[], direct: string[], supporting: string[], k: number): number {
  const actual = dcg(rankedIds.slice(0, k).map((id) => relevanceGrade(id, direct, supporting)));
  const idealGrades = [
    ...Array(Math.min(direct.length, k)).fill(2),
    ...Array(Math.max(0, Math.min(supporting.length, Math.max(0, k - direct.length)))).fill(1),
  ];
  const ideal = dcg(idealGrades);
  return ideal > 0 ? actual / ideal : 1;
}

/** Precision at a fixed cutoff N, dividing by how many results were
 * *actually* returned (capped at N), not by N itself — consistent with
 * this file's pre-existing precisionAtK convention and deliberately
 * compatible with the adaptive relative-score cutoff (Phase 12): a case
 * that correctly returns only 1 highly-relevant result instead of padding
 * out to N must not be penalized by dividing by N. */
function precisionAtCutoff(rankedIds: string[], direct: string[], supporting: string[], n: number): number {
  const top = rankedIds.slice(0, n);
  if (top.length === 0) return 1;
  const relevant = top.filter((id) => relevanceGrade(id, direct, supporting) >= 1).length;
  return relevant / top.length;
}

function evaluateCase(testCase: RetrievalCase, chunks: FixtureChunk[], k: number): CaseResult {
  const graded = gradedCase(testCase);
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
  // An unanswerable case (Phase 13's insufficient-evidence retrieval
  // category) has no expected chunk by design — "none of [] appeared" is
  // vacuously true and must never count as a failure; see
  // docs/BENCHMARK_EXPANSION_PHASE_PLAN.md. Every other case keeps
  // exactly its pre-Phase-13 pass/fail rule.
  if (graded.answerable && !hit) {
    failureReasons.push(`None of expectedChunkIds ${JSON.stringify(testCase.expectedChunkIds)} appeared in top ${k}.`);
  }
  if (duplicates > 0) failureReasons.push(`${duplicates} duplicate chunk(s) in the ranked result.`);
  if (rankedIds.length === 0) failureReasons.push("Empty result set.");

  return {
    caseId: testCase.id,
    feature: "retrieval",
    passed: (!graded.answerable || hit) && duplicates === 0,
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
  const gradedById = new Map(cases.map((c) => [c.id, gradedCase(c)]));

  const n = results.length || 1;

  // Phase 13 (Milestone 13.3): recall/hit-rate/MRR/precision/empty-result/
  // rank-distribution below are computed over ANSWERABLE cases only —
  // recall and precision are not meaningful concepts for a query with no
  // correct answer (an unanswerable case's expectedChunkIds is always []
  // by construction, so it could never contribute a "hit" no matter how
  // good retrieval is). Every Phase 11/12 case is answerable (the field
  // defaults to true), so this is a pure bugfix with zero effect on any
  // historical report — it only changes behavior now that Phase 13 adds
  // the insufficient-evidence retrieval category. See
  // docs/BENCHMARK_EXPANSION_PHASE_PLAN.md.
  const answerableResults = results.filter((r) => gradedById.get(r.caseId)!.answerable);
  const unanswerableResults = results.filter((r) => !gradedById.get(r.caseId)!.answerable);
  const aN = answerableResults.length || 1;

  const hits = answerableResults.filter((r) => r.score > 0).length;
  const emptyResults = answerableResults.filter((r) => (r.actual as { rankedIds: string[] }).rankedIds.length === 0).length;
  const duplicateCases = results.filter((r) => r.failureReasons.some((f) => f.includes("duplicate"))).length;
  const contextCompliant = cases.every((c) => {
    const ranked = rankChunks(c.query, chunks, k);
    return ranked.reduce((sum, r) => sum + chunkContent(r.chunk).length, 0) <= MAX_CONTEXT_CHARS;
  });
  const precisionValues = answerableResults.map((r) => {
    const actual = r.actual as { rankedIds: string[] };
    const c = cases.find((cc) => cc.id === r.caseId)!;
    const acceptable = new Set([...c.expectedChunkIds, ...c.acceptableAlternativeChunkIds]);
    const relevant = actual.rankedIds.filter((id) => acceptable.has(id)).length;
    return actual.rankedIds.length > 0 ? relevant / actual.rankedIds.length : 0;
  });

  // Rank distribution (Milestone 6 reporting): reciprocal rank (r.score) is
  // 1/rank when the first expected chunk was found, 0 on a miss — a clean,
  // exact way to recover each case's actual rank without a second pass.
  const rankAt1 = answerableResults.filter((r) => r.score === 1).length;
  const rankAt2to3 = answerableResults.filter((r) => r.score > 1 / 3 && r.score < 1).length;
  const rankAt4PlusOrMissed = aN - rankAt1 - rankAt2to3;

  // --- Phase 13 (Milestone 13.3): graded-relevance metrics. ---
  const gradedMetrics = cases.map((c) => {
    const graded = gradedById.get(c.id)!;
    const ranked = rankChunks(c.query, chunks, k);
    const rankedIds = ranked.map((r) => r.chunk.chunkId);
    return { caseId: c.id, graded, rankedIds };
  });

  const precisionAt = (nCut: number) =>
    gradedMetrics.reduce((sum, m) => sum + precisionAtCutoff(m.rankedIds, m.graded.direct, m.graded.supporting, nCut), 0) / n;

  const recallAt = (nCut: number) => {
    const answerable = gradedMetrics.filter((m) => m.graded.answerable);
    const aCount = answerable.length || 1;
    const sum = answerable.reduce((acc, m) => {
      const relevantIds = new Set([...m.graded.direct, ...m.graded.supporting]);
      if (relevantIds.size === 0) return acc + 1;
      const found = [...relevantIds].filter((id) => m.rankedIds.slice(0, nCut).includes(id)).length;
      return acc + found / relevantIds.size;
    }, 0);
    return sum / aCount;
  };

  const ndcgAt5 =
    gradedMetrics.reduce((sum, m) => sum + ndcgAtK(m.rankedIds, m.graded.direct, m.graded.supporting, 5), 0) / n;

  const answerableGraded = gradedMetrics.filter((m) => m.graded.answerable);
  const directHits = answerableGraded.filter((m) => m.rankedIds.length > 0 && m.graded.direct.includes(m.rankedIds[0]!)).length;
  const directHitRate = answerableGraded.length > 0 ? directHits / answerableGraded.length : 1;

  const allReturnedGrades = gradedMetrics.flatMap((m) => m.rankedIds.map((id) => relevanceGrade(id, m.graded.direct, m.graded.supporting)));
  const usefulContextRate = allReturnedGrades.length > 0 ? allReturnedGrades.filter((g) => g >= 1).length / allReturnedGrades.length : 1;

  const emptyResultRateAnswerable = emptyResults / aN;

  // falseConfidenceRate: measured only over unanswerable cases, against a
  // threshold self-calibrated each run from this run's own answerable-case
  // top-1 scores (the 25th percentile), never a hardcoded constant tied to
  // this dataset. Documented limitation (see
  // docs/BENCHMARK_EXPANSION_PHASE_PLAN.md's root-cause analysis): the
  // deterministic mock embedding's score distributions for answerable vs.
  // unanswerable queries measurably overlap, so this number is reported
  // honestly but is NOT treated as a reliable production signal — the
  // real, validated zero-tolerance guarantee against false confidence is
  // enforced downstream, at the Q&A grounding layer (qaAnswerGrounding.ts),
  // which is evaluated separately and uses real model output, not a raw
  // similarity score, to decide when evidence is insufficient.
  const answerableTop1Scores = gradedMetrics
    .filter((m) => m.graded.answerable)
    .map((m) => rankChunks(cases.find((c) => c.id === m.caseId)!.query, chunks, k)[0]?.score ?? 0)
    .sort((a, b) => a - b);
  const p25Index = Math.floor(answerableTop1Scores.length * 0.25);
  const falseConfidenceThreshold = answerableTop1Scores[p25Index] ?? 1;
  const unanswerableTop1Scores = unanswerableResults.map((r) => {
    const c = cases.find((cc) => cc.id === r.caseId)!;
    return rankChunks(c.query, chunks, k)[0]?.score ?? 0;
  });
  const falseConfidenceRate =
    unanswerableTop1Scores.length > 0
      ? unanswerableTop1Scores.filter((s) => s >= falseConfidenceThreshold).length / unanswerableTop1Scores.length
      : 0;

  // Per-category/per-language/per-difficulty breakdowns, flattened into
  // AggregateMetrics's flat Record<string, number> shape (never a nested
  // object — every existing consumer, including report.ts's featureTable()
  // and JSON persistence, already handles an arbitrary flat metric list
  // with zero changes needed).
  const breakdown: AggregateMetrics = {};
  function addBreakdown(prefix: string, key: string, items: typeof gradedMetrics) {
    const answerableItems = items.filter((m) => m.graded.answerable);
    const hitCount = answerableItems.filter((m) => {
      const c = cases.find((cc) => cc.id === m.caseId)!;
      return m.rankedIds.some((id) => c.expectedChunkIds.includes(id));
    }).length;
    breakdown[`${prefix}_${key}_count`] = items.length;
    breakdown[`${prefix}_${key}_recall`] = answerableItems.length > 0 ? hitCount / answerableItems.length : 1;
  }
  const byCategory = new Map<string, typeof gradedMetrics>();
  const byLanguage = new Map<string, typeof gradedMetrics>();
  const byDifficulty = new Map<string, typeof gradedMetrics>();
  for (const m of gradedMetrics) {
    for (const [map, key] of [
      [byCategory, m.graded.category],
      [byLanguage, m.graded.language],
      [byDifficulty, m.graded.difficulty],
    ] as const) {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
  }
  for (const [key, items] of byCategory) addBreakdown("category", key, items);
  for (const [key, items] of byLanguage) addBreakdown("language", key, items);
  for (const [key, items] of byDifficulty) addBreakdown("difficulty", key, items);

  const aggregate: AggregateMetrics = {
    recallAtK: hits / aN,
    hitRate: hits / aN,
    meanReciprocalRank: answerableResults.reduce((sum, r) => sum + r.score, 0) / aN,
    precisionAtK: precisionValues.reduce((sum, v) => sum + v, 0) / aN,
    emptyResultRate: emptyResults / aN,
    duplicateSourceCaseRate: duplicateCases / n,
    contextSizeCompliant: contextCompliant ? 1 : 0,
    // Fraction of cases whose first relevant result ranked exactly 1st /
    // ranked 2nd-3rd / ranked 4th-or-later-or-missed entirely — sums to 1.
    rankDistributionTop1Rate: rankAt1 / aN,
    rankDistributionTop2To3Rate: rankAt2to3 / aN,
    rankDistribution4PlusOrMissedRate: rankAt4PlusOrMissed / aN,
    // --- Phase 13 (Milestone 13.3): graded-relevance metrics, additive —
    // every field above this line keeps its exact pre-Phase-13 meaning. ---
    precisionAt1: precisionAt(1),
    precisionAt3: precisionAt(3),
    precisionAt5: precisionAt(5),
    recallAt3: recallAt(3),
    recallAt5: recallAt(5),
    ndcgAt5,
    directHitRate,
    usefulContextRate,
    duplicateResultRate: duplicateCases / n,
    emptyResultRateAnswerable,
    falseConfidenceRate,
    answerableCaseCount: answerableResults.length,
    unanswerableCaseCount: unanswerableResults.length,
    ...breakdown,
    caseCount: n,
  };

  return { feature: "retrieval", aggregate, cases: results };
}
