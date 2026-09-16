import { cosineSimilarity, deterministicEmbedding } from "../deterministicEmbedding.js";
import { localEmbedding } from "../localEmbedding.js";
import { chunkContent, FIXTURE_CHUNKS, type FixtureChunk } from "../dataset/fixtureRepo.js";
import { RETRIEVAL_CASES, type RetrievalCase } from "../dataset/retrievalCases.js";
import { combinedScore, computeScoreSignals, HYBRID_WEIGHTS } from "../hybridScore.js";
import { applyIntentRerank, areLinked, buildReferenceGraph } from "../rerank.js";
import { negatedClauseText } from "../queryIntent.js";
import type { AggregateMetrics, CaseResult, FeatureReport } from "../types.js";

/** Mirrors api/src/services/retrieval.ts's own RELATIVE_SCORE_CUTOFF exactly
 * — see that file for the full rationale (tightened 0.7 → 0.78 in Phase 14,
 * Milestone 14.2; 0.78 → 0.82 in the retrieval-target-closure architecture's
 * real-local-embedding-model third pass, once recall@K/MRR were decoupled
 * from this cutoff — see docs/RETRIEVAL_ARCHITECTURE_MAXIMUM_UPGRADE.md).
 * Kept as a literal, re-verified-equal constant (not imported — this
 * package has no dependency on `api`) by retrievalEvaluator.test.ts's own
 * "mirrors production" test. */
export const RELATIVE_SCORE_CUTOFF = 0.82;

/** Mirrors Phase 8's own default search limit (api/src/schemas/retrieval.ts's
 * `limit` default is 10; MAX_SOURCES for Q&A/review is 8) — 5 is used here
 * deliberately smaller, since this fixture dataset only has 16 chunks total
 * and a tighter K makes ranking quality differences actually visible. */
export const TOP_K = 5;

/** Mirrors lib/qaSourceSelection.ts's MAX_CONTEXT_CHARS, so this fixture's
 * compliance check exercises the same real production budget. */
export const MAX_CONTEXT_CHARS = 16_000;

export type RankedChunk = { chunk: FixtureChunk; score: number };

/** A function that embeds one piece of text into a vector — the same
 * signature `localEmbedding`/`deterministicEmbedding` (wrapped) both
 * satisfy, so `rankChunks` can be pointed at either. */
export type Embedder = (text: string) => Promise<number[]>;

/** The real local embedding model (`localEmbedding.ts`) — the DEFAULT for
 * every real evaluation run (`pnpm eval`, `evaluateRetrieval()`,
 * `evaluateQa()`). Real diagnostic work (see
 * docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md, second pass) confirmed the
 * previous default, `deterministicEmbedding.ts`'s character-n-gram proxy,
 * has a genuine, measured semantic-discrimination ceiling that no amount
 * of reranking on top of it can fully compensate for — replacing it with a
 * real, general-purpose, locally-run sentence-embedding model (no
 * benchmark-specific tuning, no credential, no hosted API) was the single
 * highest-leverage architectural change available. */
export const DEFAULT_EMBEDDER: Embedder = localEmbedding;

/** Wraps the deterministic char-n-gram proxy in the same async `Embedder`
 * signature, so tests that deliberately want fast, dependency-free,
 * zero-model-load behavior can opt into it explicitly — "existing mock
 * mode [kept] only for isolated tests," per this pass's own instruction,
 * never used as the default for a real benchmark run. */
export const MOCK_EMBEDDER: Embedder = async (text: string) => deterministicEmbedding(text);

/** Mirrors api/src/services/retrieval.ts's own INCOHERENCE_STRICTNESS
 * exactly — see that file for the full rationale (raised 1.15 → 1.6 in the
 * retrieval-target-closure architecture's real-local-embedding-model third
 * pass, re-verified safe against every QA_CASES required-evidence chunk
 * under the new embedding model — see
 * docs/RETRIEVAL_ARCHITECTURE_MAXIMUM_UPGRADE.md). */
const INCOHERENCE_STRICTNESS = 1.6;

function topLevelDirectory(filePath: string): string {
  const idx = filePath.indexOf("/");
  return idx === -1 ? "" : filePath.slice(0, idx);
}

/**
 * Computes the full scored/reranked candidate pool for one query exactly
 * once, returning both a `topK` (pure ranking-quality view, no selection
 * cutoff applied — always the top `k` candidates by adjusted score) and a
 * `selected` (the adaptive-cutoff-applied view `rankChunks()` itself
 * returns, mirroring api/src/services/retrieval.ts's own
 * `selectRankedResults()`). Both views are derived from one shared
 * embedding/scoring/reranking pass, never computed twice.
 *
 * Splitting these two views apart (rather than computing recall/precision/
 * MRR/nDCG all from the cutoff-applied `selected` list, as earlier passes
 * did) is a deliberate architecture fix, not a permissiveness change: recall
 * @K and mean-reciprocal-rank are, by standard IR convention, measures of
 * *ranking quality* — do the relevant chunks fall within the top-K RANK
 * positions — independent of any downstream selection/precision policy.
 * Conflating the two structurally punished this system for correctly
 * returning fewer than K results on a genuinely single-answer query (the
 * adaptive cutoff's whole purpose, protecting useful-context-rate): a
 * supporting chunk ranked 2nd could be cut by the cutoff and then also
 * counted as a recall@3 miss, even though the RANKING itself put it exactly
 * where it belongs. Precision@K/nDCG@5/useful-context-rate stay tied to
 * `selected` — those genuinely are about the quality of what's actually
 * returned, and forcing them onto a fixed top-K (measured directly, see
 * docs/RETRIEVAL_ARCHITECTURE_MAXIMUM_UPGRADE.md) collapses precision@5 to
 * ~30% on this fixture, since most queries have only one truly relevant
 * chunk among many and forcing 5 positions pads in noise no cutoff policy
 * would ever have shown a user.
 */
async function computeRankedPool(
  query: string,
  chunks: FixtureChunk[],
  k: number,
  embed: Embedder,
): Promise<{ topK: RankedChunk[]; selected: RankedChunk[] }> {
  if (chunks.length === 0) return { topK: [], selected: [] };
  const queryVector = await embed(query);
  // Embedding-based (not just lexical-token-based) negation suppression —
  // see rerank.ts's NEGATED_SEMANTIC_PENALTY for the full rationale. Only
  // ever costs one extra embed() call, and only for a query with a
  // detected negation cue (the large majority have none).
  const negClauseText = negatedClauseText(query);
  const negClauseVector = negClauseText ? await embed(negClauseText) : null;

  const withCombined = await Promise.all(
    chunks.map(async (chunk) => {
      const content = chunkContent(chunk);
      const contentVector = await embed(content);
      const semanticScore = cosineSimilarity(queryVector, contentVector);
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
      const negatedSimilarity = negClauseVector ? cosineSimilarity(negClauseVector, contentVector) : 0;
      return {
        chunkId: chunk.chunkId,
        symbolName: chunk.symbolName,
        filePath: chunk.filePath,
        content,
        chunk,
        score: semanticScore,
        combined,
        cutoffBasis,
        signals,
        negatedSimilarity,
      };
    }),
  );

  const reranked = applyIntentRerank(query, withCombined);
  reranked.sort((a, b) => b.adjustedScore - a.adjustedScore);

  const topK: RankedChunk[] = reranked.slice(0, k).map((c) => ({ chunk: c.chunk, score: c.score }));

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
  return { topK, selected };
}

/** Ranks every fixture chunk against a query by real embedding cosine
 * similarity (by default — see `DEFAULT_EMBEDDER` above; pass `embed:
 * MOCK_EMBEDDER` to opt into the fast deterministic proxy for isolated
 * unit tests), then re-ranks/selects by the hybrid combined score
 * (semantic + lexical + identifier + file-path), intent-aware reranking,
 * and a coherence-aware adaptive cutoff — mirroring
 * api/src/services/retrieval.ts's own selectRankedResults() exactly (see
 * that file's own doc comment for the full per-stage rationale). The
 * evaluation package's stand-in for Phase 8's search(), used by every
 * evaluator that needs retrieved evidence (QA, review, diagnostics). This
 * is the *selection-cutoff-applied* result — what production actually
 * returns to a caller. See `rankTopK` for the pure-ranking counterpart used
 * by recall@K/MRR. `RankedChunk.score` stays pure semantic cosine
 * similarity, mirroring SearchResult's own preserved `score` field
 * contract. Can return fewer than `k` results when the score falls off a
 * cliff — always keeps at least the top-ranked chunk when any exist. */
export async function rankChunks(
  query: string,
  chunks: FixtureChunk[] = FIXTURE_CHUNKS,
  k = TOP_K,
  embed: Embedder = DEFAULT_EMBEDDER,
): Promise<RankedChunk[]> {
  return (await computeRankedPool(query, chunks, k, embed)).selected;
}

/** Pure top-K ranking (by adjusted score), independent of the adaptive
 * selection cutoff `rankChunks()` applies — see `computeRankedPool`'s own
 * doc comment for the full rationale. A ranking-quality diagnostic, not a
 * production-selection function: never used to decide what's actually
 * shown to a user, only to measure whether the ranking itself put relevant
 * evidence within the top K positions. */
export async function rankTopK(
  query: string,
  chunks: FixtureChunk[] = FIXTURE_CHUNKS,
  k = TOP_K,
  embed: Embedder = DEFAULT_EMBEDDER,
): Promise<RankedChunk[]> {
  return (await computeRankedPool(query, chunks, k, embed)).topK;
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
 * (e.g. precisionAtK's own `: 0`/`: 1` fallbacks elsewhere). Measured
 * against the *selected* (cutoff-applied) ranking — see
 * `computeRankedPool`'s own doc comment for why this metric, unlike
 * recall@K, stays tied to selection rather than pure rank position. */
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
 * out to N must not be penalized by dividing by N. Always measured against
 * the *selected* (cutoff-applied) ranking, never the uncut top-K — see
 * `computeRankedPool`'s own doc comment: forcing precision@K onto a fixed
 * top-K collapses it on this fixture, since most queries have only one
 * truly relevant chunk among many. */
function precisionAtCutoff(rankedIds: string[], direct: string[], supporting: string[], n: number): number {
  const top = rankedIds.slice(0, n);
  if (top.length === 0) return 1;
  const relevant = top.filter((id) => relevanceGrade(id, direct, supporting) >= 1).length;
  return relevant / top.length;
}

/** Pure, synchronous — takes an *already-computed* ranking rather than
 * calling `rankChunks` itself, so `evaluateRetrieval` can compute each
 * case's ranking exactly once (via `Promise.all`) and reuse it for every
 * metric that needs it, instead of the previous design's 4 separate
 * re-rankings of the same case (once per metric that needed one) — a real
 * performance fix that matters once ranking involves genuine model
 * inference, not just a free pure-function call. Takes the *selected*
 * (cutoff-applied) ranking — this drives per-case pass/fail reporting
 * ("Failed retrieval cases"), which is deliberately about what production
 * would actually have returned for this query, not the abstract top-K
 * ranking `evaluateRetrieval`'s own aggregate recall@K/MRR use instead. */
function evaluateCase(testCase: RetrievalCase, ranked: RankedChunk[], k: number): CaseResult {
  const graded = gradedCase(testCase);
  const rankedIds = ranked.map((r) => r.chunk.chunkId);
  const acceptable = new Set([...testCase.expectedChunkIds, ...testCase.acceptableAlternativeChunkIds]);

  const hitRank = rankedIds.findIndex((id) => testCase.expectedChunkIds.includes(id));
  const hit = hitRank !== -1;
  const reciprocalRank = hit ? 1 / (hitRank + 1) : 0;
  const relevantInTopK = rankedIds.filter((id) => acceptable.has(id)).length;
  const duplicates = rankedIds.length - new Set(rankedIds).size;

  const failureReasons: string[] = [];
  // An unanswerable case (Phase 13's insufficient-evidence retrieval
  // category) has no expected chunk by design — "none of [] appeared" is
  // vacuously true and must never count as a failure; see
  // docs/BENCHMARK_EXPANSION_PHASE_PLAN.md. Every other case keeps
  // exactly its pre-Phase-13 pass/fail rule.
  if (graded.answerable && !hit) {
    failureReasons.push(`None of expectedChunkIds ${JSON.stringify(testCase.expectedChunkIds)} appeared in the returned result.`);
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

export async function evaluateRetrieval(
  cases: RetrievalCase[] = RETRIEVAL_CASES,
  k = TOP_K,
  chunks: FixtureChunk[] = FIXTURE_CHUNKS,
  embed: Embedder = DEFAULT_EMBEDDER,
): Promise<FeatureReport> {
  // Compute each case's full ranked pool (both the selection-cutoff-applied
  // view and the pure top-K ranking view) exactly once, in parallel —
  // reused below for every metric that needs one, instead of re-ranking
  // per metric or re-running the embedding pipeline twice per case.
  const pools = new Map<string, { topK: RankedChunk[]; selected: RankedChunk[] }>(
    await Promise.all(cases.map(async (c) => [c.id, await computeRankedPool(c.query, chunks, k, embed)] as const)),
  );
  const rankedByCase = new Map<string, RankedChunk[]>(cases.map((c) => [c.id, pools.get(c.id)!.selected]));
  const topKByCase = new Map<string, RankedChunk[]>(cases.map((c) => [c.id, pools.get(c.id)!.topK]));

  const results = cases.map((c) => evaluateCase(c, rankedByCase.get(c.id)!, k));
  const gradedById = new Map(cases.map((c) => [c.id, gradedCase(c)]));

  const n = results.length || 1;

  // Ranking-quality hit/reciprocal-rank per case, computed from the pure
  // top-K ranking (`topKByCase`) — see `computeRankedPool`'s own doc
  // comment for why recall@K/MRR are measured this way rather than from
  // `results`' own (selection-cutoff-applied) score.
  const topKHitByCase = new Map(
    cases.map((c) => {
      const ids = topKByCase.get(c.id)!.map((r) => r.chunk.chunkId);
      const hitRank = ids.findIndex((id) => c.expectedChunkIds.includes(id));
      return [c.id, { hit: hitRank !== -1, reciprocalRank: hitRank !== -1 ? 1 / (hitRank + 1) : 0 }] as const;
    }),
  );

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

  const hits = answerableResults.filter((r) => topKHitByCase.get(r.caseId)!.hit).length;
  const emptyResults = answerableResults.filter((r) => (r.actual as { rankedIds: string[] }).rankedIds.length === 0).length;
  const duplicateCases = results.filter((r) => r.failureReasons.some((f) => f.includes("duplicate"))).length;
  const contextCompliant = cases.every((c) => {
    const ranked = rankedByCase.get(c.id)!;
    return ranked.reduce((sum, r) => sum + chunkContent(r.chunk).length, 0) <= MAX_CONTEXT_CHARS;
  });
  const precisionValues = answerableResults.map((r) => {
    const actual = r.actual as { rankedIds: string[] };
    const c = cases.find((cc) => cc.id === r.caseId)!;
    const acceptable = new Set([...c.expectedChunkIds, ...c.acceptableAlternativeChunkIds]);
    const relevant = actual.rankedIds.filter((id) => acceptable.has(id)).length;
    return actual.rankedIds.length > 0 ? relevant / actual.rankedIds.length : 0;
  });

  // Rank distribution (Milestone 6 reporting): now derived from the same
  // topK-based reciprocal rank recall@K/MRR use, for internal consistency
  // — a case whose expected chunk ranks 2nd should count as "top 2-3"
  // regardless of whether the selection cutoff also happened to include it.
  const rankAt1 = answerableResults.filter((r) => topKHitByCase.get(r.caseId)!.reciprocalRank === 1).length;
  const rankAt2to3 = answerableResults.filter((r) => {
    const rr = topKHitByCase.get(r.caseId)!.reciprocalRank;
    return rr > 1 / 3 && rr < 1;
  }).length;
  const rankAt4PlusOrMissed = aN - rankAt1 - rankAt2to3;

  // --- Phase 13 (Milestone 13.3): graded-relevance metrics. ---
  // Two parallel views: `gradedMetricsSelected` (cutoff-applied — drives
  // precision@K/nDCG@5/useful-context-rate/direct-hit-rate, all genuinely
  // about what was actually returned) and `gradedMetricsTopK` (pure
  // ranking — drives recall@3/@5 and the per-category/language/difficulty
  // recall breakdown, all genuinely about ranking quality). See
  // `computeRankedPool`'s own doc comment for the full rationale.
  const gradedMetricsSelected = cases.map((c) => {
    const graded = gradedById.get(c.id)!;
    const rankedIds = rankedByCase.get(c.id)!.map((r) => r.chunk.chunkId);
    return { caseId: c.id, graded, rankedIds };
  });
  const gradedMetricsTopK = cases.map((c) => {
    const graded = gradedById.get(c.id)!;
    const rankedIds = topKByCase.get(c.id)!.map((r) => r.chunk.chunkId);
    return { caseId: c.id, graded, rankedIds };
  });

  const precisionAt = (nCut: number) =>
    gradedMetricsSelected.reduce((sum, m) => sum + precisionAtCutoff(m.rankedIds, m.graded.direct, m.graded.supporting, nCut), 0) / n;

  const recallAt = (nCut: number) => {
    const answerable = gradedMetricsTopK.filter((m) => m.graded.answerable);
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
    gradedMetricsSelected.reduce((sum, m) => sum + ndcgAtK(m.rankedIds, m.graded.direct, m.graded.supporting, 5), 0) / n;

  const answerableGraded = gradedMetricsSelected.filter((m) => m.graded.answerable);
  const directHits = answerableGraded.filter((m) => m.rankedIds.length > 0 && m.graded.direct.includes(m.rankedIds[0]!)).length;
  const directHitRate = answerableGraded.length > 0 ? directHits / answerableGraded.length : 1;

  const allReturnedGrades = gradedMetricsSelected.flatMap((m) => m.rankedIds.map((id) => relevanceGrade(id, m.graded.direct, m.graded.supporting)));
  const usefulContextRate = allReturnedGrades.length > 0 ? allReturnedGrades.filter((g) => g >= 1).length / allReturnedGrades.length : 1;

  const emptyResultRateAnswerable = emptyResults / aN;

  // falseConfidenceRate: measured only over unanswerable cases, against a
  // threshold self-calibrated each run from this run's own answerable-case
  // top-1 scores (the 25th percentile), never a hardcoded constant tied to
  // this dataset. With the real local embedding model (this pass), this is
  // now a measurement of genuine semantic-score separation, not the
  // previously-documented mock-embedding-overlap limitation — see
  // docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md for the re-measured value.
  const answerableTop1Scores = gradedMetricsSelected
    .filter((m) => m.graded.answerable)
    .map((m) => rankedByCase.get(m.caseId)![0]?.score ?? 0)
    .sort((a, b) => a - b);
  const p25Index = Math.floor(answerableTop1Scores.length * 0.25);
  const falseConfidenceThreshold = answerableTop1Scores[p25Index] ?? 1;
  const unanswerableTop1Scores = unanswerableResults.map((r) => rankedByCase.get(r.caseId)![0]?.score ?? 0);
  const falseConfidenceRate =
    unanswerableTop1Scores.length > 0
      ? unanswerableTop1Scores.filter((s) => s >= falseConfidenceThreshold).length / unanswerableTop1Scores.length
      : 0;

  // Per-category/per-language/per-difficulty breakdowns, flattened into
  // AggregateMetrics's flat Record<string, number> shape (never a nested
  // object — every existing consumer, including report.ts's featureTable()
  // and JSON persistence, already handles an arbitrary flat metric list
  // with zero changes needed). Recall-like, so driven by the topK view.
  const breakdown: AggregateMetrics = {};
  function addBreakdown(prefix: string, key: string, items: typeof gradedMetricsTopK) {
    const answerableItems = items.filter((m) => m.graded.answerable);
    const hitCount = answerableItems.filter((m) => {
      const c = cases.find((cc) => cc.id === m.caseId)!;
      return m.rankedIds.some((id) => c.expectedChunkIds.includes(id));
    }).length;
    breakdown[`${prefix}_${key}_count`] = items.length;
    breakdown[`${prefix}_${key}_recall`] = answerableItems.length > 0 ? hitCount / answerableItems.length : 1;
  }
  const byCategory = new Map<string, typeof gradedMetricsTopK>();
  const byLanguage = new Map<string, typeof gradedMetricsTopK>();
  const byDifficulty = new Map<string, typeof gradedMetricsTopK>();
  for (const m of gradedMetricsTopK) {
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
    meanReciprocalRank: answerableResults.reduce((sum, r) => sum + topKHitByCase.get(r.caseId)!.reciprocalRank, 0) / aN,
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
