/**
 * Intent-aware reranking — a distinct stage applied after base hybrid
 * scoring (semantic + lexical + identifier + exact-identifier + file-path,
 * see hybridScore.ts) and before the adaptive cutoff. Added to close the
 * direct-hit-rate and recall@3 gaps documented in
 * docs/RETRIEVAL_TARGET_CLOSURE_PROGRESS.md: real diagnostic cases showed
 * that no combination of the existing per-candidate signals can express
 * "this is the orchestrating function, not one of the steps it calls" or
 * "this is the public entry point, not the internal helper it delegates
 * to" — those are relationships *between* candidates (Workstream 2/3's own
 * "structural repository signals" and "reranking" categories), not
 * properties of a single candidate in isolation, so they belong in a
 * reranking stage that sees the whole candidate pool at once, not inside
 * per-candidate computeScoreSignals().
 *
 * Every bonus here is small and additive relative to the base combined
 * score (never a replacement for it) and is gated by a general, wording-
 * based query-intent classification (queryIntent.ts) plus a general,
 * content-derived reference graph (referenceGraph.ts) — never a benchmark
 * query string or chunk id. Mirrored (not imported) in
 * api/src/lib/rerank.ts, matching every other cross-package convention
 * this codebase already follows.
 */

import { classifyQueryIntent, negatedWordSet, wantsMultipleEvidence, type QueryIntent } from "./queryIntent.js";
import { buildReferenceGraph, areLinked, type ReferenceCandidate } from "./referenceGraph.js";
import { tokenize, lexicalOverlapScore, type ScoreSignals } from "./hybridScore.js";

export type RerankCandidate = ReferenceCandidate & {
  filePath: string;
  combined: number;
  cutoffBasis: number;
  signals: ScoreSignals;
  /** Mirrors api/src/lib/rerank.ts's own negatedSimilarity field exactly. */
  negatedSimilarity?: number;
};

export type RerankedCandidate<T extends RerankCandidate = RerankCandidate> = T & {
  adjustedScore: number;
  adjustedCutoffBasis: number;
  intent: QueryIntent;
};

const ENTRY_POINT_BONUS = 0.18;
const ORCHESTRATION_BONUS = 0.22;
// Mirrors api/src/lib/rerank.ts's own ORCHESTRATION_STEP_BONUS exactly.
const ORCHESTRATION_STEP_BONUS = 0.25;
// Mirrors api/src/lib/rerank.ts's own DEPENDENCY_BONUS/USAGE_BONUS exactly
// — see that file for the full rationale.
const DEPENDENCY_BONUS = 0.6;
const USAGE_BONUS = 0.6;
const CONFIG_BONUS = 0.12;
const ERROR_BONUS = 0.1;
const TEST_BONUS = 0.15;
// Mirrors api/src/lib/rerank.ts's own NEGATED_MATCH_PENALTY exactly — see
// that file for the full rationale (finishes wiring up queryIntent.ts's
// negatedWordSet(), unused since the first retrieval-target-closure pass).
const NEGATED_MATCH_PENALTY = 0.3;
// Mirrors api/src/lib/rerank.ts's own NEGATED_SEMANTIC_PENALTY exactly —
// see that file for the full rationale (catches negated-concept matches
// the lexical penalty's stemming minimum misses, e.g. "owns" vs. "owned").
const NEGATED_SEMANTIC_PENALTY = 0.1;
// Mirrors api/src/lib/rerank.ts's own SAME_FILE_EVIDENCE_BONUS/
// SAME_FILE_GROUNDING_FLOOR exactly — see that file for the full rationale.
const SAME_FILE_EVIDENCE_BONUS = 0.2;
const SAME_FILE_GROUNDING_FLOOR = 0.15;
// Mirrors api/src/lib/rerank.ts's own STEP_SPECIFICITY_BONUS/
// STEP_SPECIFICITY_MARGIN exactly — see that file for the full rationale
// (a narrower, margin-gated, reference-link-only re-attempt of a rule
// tried and reverted in the second pass).
const STEP_SPECIFICITY_BONUS = 0.3;
const STEP_SPECIFICITY_MARGIN = 0.1;
// Mirrors api/src/lib/rerank.ts's own BASE_NAME_BONUS exactly — see that
// file for the full rationale (a general Strict/Safe/Async/V2/Legacy
// suffix-variant naming convention signal, not benchmark-specific).
const BASE_NAME_BONUS = 0.3;

/** Mirrors api/src/lib/rerank.ts's own isBaseNameOf exactly. */
function isBaseNameOf(base: string, variant: string): boolean {
  const toSnake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  const b = toSnake(base);
  const v = toSnake(variant);
  return v !== b && v.startsWith(`${b}_`);
}

/** True if `filePath`'s basename (ignoring extension) is a conventional
 * "public surface" filename — `index` (TS/JS/JS barrel-file convention) or
 * `__init__` (the equivalent Python package-entry convention). General
 * across all three languages this codebase indexes, not tied to any one
 * fixture path. */
function isEntryPointFile(filePath: string): boolean {
  const basename = filePath.split("/").pop() ?? filePath;
  const stem = basename.replace(/\.[a-z0-9]+$/i, "");
  return stem === "index" || stem === "__init__";
}

function isTestFile(filePath: string): boolean {
  return /(^|\/)(tests?|spec|__tests__)(\/|$)/i.test(filePath) || /\.(test|spec)\.[a-z0-9]+$/i.test(filePath);
}

function isConfigFile(filePath: string): boolean {
  return /(^|\/)(config|settings|env)(\/|\.[a-z0-9]+$|$)/i.test(filePath);
}

function looksLikeErrorHandlingContent(content: string): boolean {
  return /\b(throw|raise|except|catch|Error\b)/.test(content);
}

/**
 * Mirrors api/src/lib/rerank.ts's own applyIntentRerank exactly — see that
 * file for the full rationale, including a real regression this file's own
 * `adjustedCutoffBasis: c.cutoffBasis` (deliberately NOT adding the bonus)
 * fixes.
 */
export function applyIntentRerank<T extends RerankCandidate>(query: string, candidates: T[]): RerankedCandidate<T>[] {
  if (candidates.length === 0) return [];

  const intent = classifyQueryIntent(query);
  const graph = buildReferenceGraph(candidates);
  const negatedWords = negatedWordSet(query);
  const multiEvidence = wantsMultipleEvidence(query);

  // The single highest-raw-combined-scored candidate is used as the
  // reference point for "dependency"/"usage" intents (the caller/callee
  // relationship is always expressed relative to whichever candidate the
  // base signals already consider the strongest match) — computed once,
  // from the unadjusted `combined` score, never from ground truth.
  const topByBaseScore = candidates.reduce((best, c) => (c.combined > best.combined ? c : best), candidates[0]!);

  return candidates.map((c) => {
    let bonus = 0;

    switch (intent) {
      case "entry-point":
        if (isEntryPointFile(c.filePath)) bonus += ENTRY_POINT_BONUS;
        break;
      case "orchestration": {
        const outgoing = graph.get(c.chunkId) ?? new Set();
        // An "orchestrator" is a candidate whose own content references at
        // least two OTHER candidates in this same pool — a real, general
        // signal for "this function coordinates several steps," not a
        // guess: it's counting actual detected call/import references.
        if (outgoing.size >= 2) bonus += ORCHESTRATION_BONUS;
        // Mirrors api/src/lib/rerank.ts's own step-bonus exactly — see that
        // file for the full rationale (the orchestrator's own steps are
        // legitimate supporting evidence that would otherwise never clear
        // the cutoff the orchestrator's own much higher score sets).
        const topOutgoing = graph.get(topByBaseScore.chunkId) ?? new Set();
        if (c.chunkId !== topByBaseScore.chunkId && topOutgoing.size >= 2 && topOutgoing.has(c.chunkId)) {
          bonus += ORCHESTRATION_STEP_BONUS;
        }
        break;
      }
      case "dependency":
        // The query is asking what the strongest match imports/calls —
        // boost whichever OTHER candidate the top match actually
        // references, since that's the callee the query is asking about.
        if (c.chunkId !== topByBaseScore.chunkId && (graph.get(topByBaseScore.chunkId)?.has(c.chunkId) ?? false)) {
          bonus += DEPENDENCY_BONUS;
        }
        break;
      case "usage":
        // The query is asking who calls/uses the strongest match — boost
        // whichever OTHER candidate references the top match (i.e. is its
        // caller), the reverse direction of "dependency" above.
        if (c.chunkId !== topByBaseScore.chunkId && (graph.get(c.chunkId)?.has(topByBaseScore.chunkId) ?? false)) {
          bonus += USAGE_BONUS;
        }
        break;
      case "configuration":
        if (isConfigFile(c.filePath)) bonus += CONFIG_BONUS;
        break;
      case "error":
        if (looksLikeErrorHandlingContent(c.content)) bonus += ERROR_BONUS;
        break;
      case "test":
        if (isTestFile(c.filePath)) bonus += TEST_BONUS;
        break;
      case "definition":
      case "general":
        break;
    }

    // Negation-aware suppression — see NEGATED_MATCH_PENALTY's own comment.
    if (negatedWords.size > 0) {
      const candidateTokens = [...tokenize(c.content), ...tokenize(c.symbolName ?? "")];
      const negatedOverlap = lexicalOverlapScore([...negatedWords], candidateTokens);
      bonus -= NEGATED_MATCH_PENALTY * negatedOverlap;
    }
    if (c.negatedSimilarity) {
      bonus -= NEGATED_SEMANTIC_PENALTY * Math.max(0, c.negatedSimilarity);
    }

    // Same-source-file evidence-group ranking boost — see
    // SAME_FILE_EVIDENCE_BONUS's own comment.
    if (multiEvidence && c.chunkId !== topByBaseScore.chunkId && c.filePath === topByBaseScore.filePath) {
      const grounded = c.signals.lexicalScore > SAME_FILE_GROUNDING_FLOOR || c.signals.identifierScore > 0 || c.signals.exactIdentifierScore > 0;
      if (grounded) bonus += SAME_FILE_EVIDENCE_BONUS;
    }

    // Step-specificity — see STEP_SPECIFICITY_BONUS's own comment.
    if (c.chunkId !== topByBaseScore.chunkId) {
      const topOutgoing = graph.get(topByBaseScore.chunkId) ?? new Set();
      if (topOutgoing.has(c.chunkId) && c.signals.identifierScore >= topByBaseScore.signals.identifierScore + STEP_SPECIFICITY_MARGIN) {
        bonus += STEP_SPECIFICITY_BONUS;
      }
    }

    // Base-name convention — see BASE_NAME_BONUS's own comment.
    if (
      c.chunkId !== topByBaseScore.chunkId &&
      c.filePath === topByBaseScore.filePath &&
      c.symbolName &&
      topByBaseScore.symbolName &&
      isBaseNameOf(c.symbolName, topByBaseScore.symbolName)
    ) {
      bonus += BASE_NAME_BONUS;
    }

    return {
      ...c,
      intent,
      adjustedScore: c.combined + bonus,
      adjustedCutoffBasis: c.cutoffBasis,
    };
  });
}

/** Re-exported so callers that only need reference-linkage (the coherence-
 * aware cutoff in retrieval.ts/retrievalEvaluator.ts) don't need a second
 * import path for the same graph this module already builds. */
export { buildReferenceGraph, areLinked };
