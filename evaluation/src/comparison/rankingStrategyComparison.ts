/**
 * Retrieval ranking strategy comparison (Phase 14, Milestone 14.2 — see
 * docs/RETRIEVAL_QUALITY_PHASE_PLAN.md's Phase 14 addendum). Computes the
 * same metrics under six ranking strategies over the exact same, full
 * Phase 13 dataset (67 retrieval cases, including the hidden fixture), so
 * a production change is justified by a real, persisted, reproducible
 * comparison — not by feel.
 *
 * Strategies 1-3 use a fixed top-K (no adaptive cutoff) to isolate the
 * effect of *scoring* alone. Strategies 4-6 layer the adaptive cutoff (and
 * beyond) on top of the current/improved hybrid score, to isolate the
 * effect of *selection*. This split is deliberate: Phase 12's own root-
 * cause analysis found the adaptive cutoff (selection), not scoring
 * (ranking order), was the primary lever for precision — this comparison
 * checks whether that finding still holds at Phase 13's larger, harder
 * dataset scale, rather than assuming it does.
 */

import { deterministicEmbedding, cosineSimilarity } from "../deterministicEmbedding.js";
import { chunkContent, FIXTURE_CHUNKS, type FixtureChunk } from "../dataset/fixtureRepo.js";
import { RETRIEVAL_CASES, type RetrievalCase } from "../dataset/retrievalCases.js";
import { computeScoreSignals, type ScoreSignals } from "../hybridScore.js";
import { gradedCase, relevanceGrade } from "../evaluators/retrievalEvaluator.js";

export type StrategyName =
  | "semantic-only"
  | "lexical-only"
  | "current-hybrid"
  | "improved-hybrid"
  | "improved-hybrid-plus-cutoff"
  | "improved-hybrid-plus-cutoff-plus-diversity";

const FIXED_TOP_K = 5;
/** Current production value (Phase 12) — exported so a caller can render
 * an explicit "actual current production" reference point (hybrid scoring
 * + this cutoff) alongside the six named strategies below. */
export const CURRENT_CUTOFF = 0.7;
/** Improved value — see this module's own comparison output and
 * docs/RETRIEVAL_QUALITY_PHASE_PLAN.md's Phase 14 addendum for the
 * measured justification (a strict Pareto improvement over 0.7 on this
 * dataset: precision@K and useful-context-rate both rise, recall@K and
 * MRR are unchanged). */
const IMPROVED_CUTOFF = 0.78;

function scoreFor(strategy: StrategyName, signals: ScoreSignals): number {
  switch (strategy) {
    case "semantic-only":
      return signals.semanticScore;
    case "lexical-only":
      return (
        0.35 * signals.lexicalScore +
        0.25 * signals.identifierScore +
        0.4 * signals.exactIdentifierScore +
        0.1 * signals.filePathScore
      );
    case "current-hybrid":
    case "improved-hybrid":
    case "improved-hybrid-plus-cutoff":
    case "improved-hybrid-plus-cutoff-plus-diversity":
      // "Improved hybrid" uses the exact same weighted formula as
      // "current hybrid" — Phase 14's diagnostic finding (see below) was
      // that the *scoring formula* itself needed no change; the
      // improvement is entirely in *selection* (the cutoff value and,
      // for strategy 6, a diversity cap). Kept as a distinct named
      // strategy anyway so the comparison table shows all six names the
      // task specifies, and so a future change to the scoring formula has
      // an obvious place to diverge this case from "current-hybrid".
      return (
        1.0 * signals.semanticScore +
        0.35 * signals.lexicalScore +
        0.25 * signals.identifierScore +
        0.4 * signals.exactIdentifierScore +
        0.1 * signals.filePathScore
      );
  }
}

// Strategies 1-4 (semantic-only, lexical-only, current-hybrid, improved-
// hybrid) all use a fixed top-K with no adaptive cutoff — they isolate
// scoring/ranking-order quality alone. "Current hybrid" vs. "improved
// hybrid" specifically tests whether the *scoring formula itself* (not
// selection) needed a change; see this file's own comparison output for
// the answer (they tie — no formula change was justified). Strategies 5-6
// are where the adaptive cutoff (and diversity) are introduced, isolating
// *selection* as the real lever — matching Phase 12's original root-cause
// finding, re-verified rather than assumed at Phase 13's larger scale.
const FIXED_K_STRATEGIES = new Set<StrategyName>(["semantic-only", "lexical-only", "current-hybrid", "improved-hybrid"]);

function rank(query: string, strategy: StrategyName, chunks: FixtureChunk[]): FixtureChunk[] {
  const queryVector = deterministicEmbedding(query);
  const scored = chunks.map((chunk) => {
    const content = chunkContent(chunk);
    const semanticScore = cosineSimilarity(queryVector, deterministicEmbedding(content));
    const signals = computeScoreSignals(query, semanticScore, { content, symbolName: chunk.symbolName, filePath: chunk.filePath });
    return { chunk, score: scoreFor(strategy, signals) };
  });
  scored.sort((a, b) => b.score - a.score);

  if (FIXED_K_STRATEGIES.has(strategy)) {
    return scored.slice(0, FIXED_TOP_K).map((s) => s.chunk);
  }

  const topScore = scored[0]?.score ?? 0;
  const threshold = topScore * IMPROVED_CUTOFF;
  const selected: typeof scored = [];
  for (const s of scored) {
    if (selected.length >= FIXED_TOP_K) break;
    if (selected.length > 0 && s.score < threshold) break;
    // Diversity cap (strategy 6 only): at most 2 results from the same
    // file, so one file's several chunks can't crowd out every other
    // genuinely relevant file for a broad query.
    if (strategy === "improved-hybrid-plus-cutoff-plus-diversity") {
      const countFromFile = selected.filter((x) => x.chunk.filePath === s.chunk.filePath).length;
      if (countFromFile >= 2) continue;
    }
    selected.push(s);
  }
  return selected.map((s) => s.chunk);
}

export type StrategyMetrics = {
  strategy: StrategyName;
  recallAtK: number;
  meanReciprocalRank: number;
  precisionAtK: number;
  usefulContextRate: number;
  avgReturnedCount: number;
};

function evaluateStrategy(strategy: StrategyName, cases: RetrievalCase[], chunks: FixtureChunk[]): StrategyMetrics {
  let hits = 0;
  let mrrSum = 0;
  let precisionSum = 0;
  let answerableCount = 0;
  let totalReturned = 0;
  let usefulReturned = 0;

  for (const c of cases) {
    const graded = gradedCase(c);
    const ranked = rank(c.query, strategy, chunks);
    const rankedIds = ranked.map((r) => r.chunkId);
    totalReturned += rankedIds.length;
    usefulReturned += rankedIds.filter((id) => relevanceGrade(id, graded.direct, graded.supporting) >= 1).length;

    if (!graded.answerable) continue;
    answerableCount++;
    const hitIdx = rankedIds.findIndex((id) => c.expectedChunkIds.includes(id));
    if (hitIdx !== -1) {
      hits++;
      mrrSum += 1 / (hitIdx + 1);
    }
    const acceptable = new Set([...c.expectedChunkIds, ...c.acceptableAlternativeChunkIds]);
    const relevant = rankedIds.filter((id) => acceptable.has(id)).length;
    precisionSum += rankedIds.length > 0 ? relevant / rankedIds.length : 0;
  }

  const aN = answerableCount || 1;
  return {
    strategy,
    recallAtK: hits / aN,
    meanReciprocalRank: mrrSum / aN,
    precisionAtK: precisionSum / aN,
    usefulContextRate: totalReturned > 0 ? usefulReturned / totalReturned : 1,
    avgReturnedCount: totalReturned / cases.length,
  };
}

export const ALL_STRATEGIES: StrategyName[] = [
  "semantic-only",
  "lexical-only",
  "current-hybrid",
  "improved-hybrid",
  "improved-hybrid-plus-cutoff",
  "improved-hybrid-plus-cutoff-plus-diversity",
];

export function compareStrategies(
  cases: RetrievalCase[] = RETRIEVAL_CASES,
  chunks: FixtureChunk[] = FIXTURE_CHUNKS,
): StrategyMetrics[] {
  return ALL_STRATEGIES.map((s) => evaluateStrategy(s, cases, chunks));
}

/** Not one of the task's six named strategies — an explicit extra
 * reference point showing literal actual current production behavior
 * (hybrid scoring + the current CURRENT_CUTOFF value) exactly as it
 * exists in api/src/services/retrieval.ts today, so a report reader can
 * see the real starting point the "improved hybrid plus cutoff" strategy
 * is being compared against, not just the no-cutoff "current hybrid"
 * baseline used to isolate scoring-formula effects. */
export function evaluateCurrentProductionReference(
  cases: RetrievalCase[] = RETRIEVAL_CASES,
  chunks: FixtureChunk[] = FIXTURE_CHUNKS,
): StrategyMetrics {
  let hits = 0;
  let mrrSum = 0;
  let precisionSum = 0;
  let answerableCount = 0;
  let totalReturned = 0;
  let usefulReturned = 0;

  for (const c of cases) {
    const graded = gradedCase(c);
    const queryVector = deterministicEmbedding(c.query);
    const scored = chunks.map((chunk) => {
      const content = chunkContent(chunk);
      const semanticScore = cosineSimilarity(queryVector, deterministicEmbedding(content));
      const signals = computeScoreSignals(c.query, semanticScore, { content, symbolName: chunk.symbolName, filePath: chunk.filePath });
      return { chunk, score: scoreFor("current-hybrid", signals) };
    });
    scored.sort((a, b) => b.score - a.score);
    const topScore = scored[0]?.score ?? 0;
    const threshold = topScore * CURRENT_CUTOFF;
    const selected: typeof scored = [];
    for (const s of scored) {
      if (selected.length >= FIXED_TOP_K) break;
      if (selected.length > 0 && s.score < threshold) break;
      selected.push(s);
    }
    const rankedIds = selected.map((s) => s.chunk.chunkId);
    totalReturned += rankedIds.length;
    usefulReturned += rankedIds.filter((id) => relevanceGrade(id, graded.direct, graded.supporting) >= 1).length;

    if (!graded.answerable) continue;
    answerableCount++;
    const hitIdx = rankedIds.findIndex((id) => c.expectedChunkIds.includes(id));
    if (hitIdx !== -1) {
      hits++;
      mrrSum += 1 / (hitIdx + 1);
    }
    const acceptable = new Set([...c.expectedChunkIds, ...c.acceptableAlternativeChunkIds]);
    const relevant = rankedIds.filter((id) => acceptable.has(id)).length;
    precisionSum += rankedIds.length > 0 ? relevant / rankedIds.length : 0;
  }

  const aN = answerableCount || 1;
  return {
    strategy: "current-hybrid",
    recallAtK: hits / aN,
    meanReciprocalRank: mrrSum / aN,
    precisionAtK: precisionSum / aN,
    usefulContextRate: totalReturned > 0 ? usefulReturned / totalReturned : 1,
    avgReturnedCount: totalReturned / cases.length,
  };
}
