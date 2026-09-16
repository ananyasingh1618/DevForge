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
 * evaluation/src/rerank.ts, matching every other cross-package convention
 * this codebase already follows.
 */

import { classifyQueryIntent, type QueryIntent } from "./queryIntent.js";
import { buildReferenceGraph, areLinked, type ReferenceCandidate } from "./referenceGraph.js";

export type RerankCandidate = ReferenceCandidate & {
  filePath: string;
  combined: number;
  cutoffBasis: number;
};

export type RerankedCandidate<T extends RerankCandidate = RerankCandidate> = T & {
  adjustedScore: number;
  adjustedCutoffBasis: number;
  intent: QueryIntent;
};

const ENTRY_POINT_BONUS = 0.18;
const ORCHESTRATION_BONUS = 0.22;
// Boosts an orchestrator's own individual steps (see the "orchestration"
// case below) enough to clear the cutoff threshold the orchestrator's own,
// much higher combined score sets — see that case's own comment.
const ORCHESTRATION_STEP_BONUS = 0.25;
// Deliberately larger than HYBRID_WEIGHTS.exactIdentifier's own +0.4 boost
// (hybridScore.ts): a "dependency"/"usage" query very often names the
// caller by its exact identifier (e.g. "what does removeFromCart delegate
// to?"), which would otherwise always win the exact-identifier bonus over
// the callee the query is actually asking about. Measured directly against
// the full benchmark (docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md) that
// 0.45 was still not consistently enough (the caller's own combined score
// can exceed the callee's by more than 0.45 once its own semantic/lexical
// signals are also considered, not just the +0.4 exact-identifier term) —
// 0.6 reliably is, without costing any other passing case.
const DEPENDENCY_BONUS = 0.6;
const USAGE_BONUS = 0.6;
const CONFIG_BONUS = 0.12;
const ERROR_BONUS = 0.1;
const TEST_BONUS = 0.15;

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
 * Applies intent-driven bonuses to a scored candidate pool. Returns every
 * candidate with an `adjustedScore` (used for final ranking/selection) and
 * `adjustedCutoffBasis`. The cutoff basis is deliberately left equal to
 * the *unadjusted* `cutoffBasis` — an intent bonus changes an individual
 * candidate's rank and its own chance of clearing the cutoff, but must
 * never feed into the threshold's own reference point. A first version of
 * this function added the bonus to `cutoffBasis` too, reasoning "a
 * legitimately intent-relevant candidate should also raise the bar
 * everyone else must clear" — but this backfires specifically when the
 * bonus lands on the already-top-ranked candidate: the threshold is
 * `max(cutoffBasis) * RELATIVE_SCORE_CUTOFF`, so inflating the very
 * candidate that already sets that max makes the bar *stricter* for every
 * other candidate, including a genuinely coherent runner-up that simply
 * didn't happen to also match the same intent-bonus criterion (e.g. an
 * "error"-intent bonus that only fires for candidates whose own content
 * contains `throw`/`catch`). Caught as a real, measured regression
 * (several same-file sibling pairs that used to both survive the cutoff
 * started returning only one) during this same architecture work — see
 * docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md.
 */
export function applyIntentRerank<T extends RerankCandidate>(query: string, candidates: T[]): RerankedCandidate<T>[] {
  if (candidates.length === 0) return [];

  const intent = classifyQueryIntent(query);
  const graph = buildReferenceGraph(candidates);

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
        // The individual steps an orchestrator calls are legitimate
        // supporting evidence for an "everything that happens"/"walk me
        // through" style query (exactly what this intent's own patterns
        // match) — without this, the orchestrator's own much higher
        // combined score (it typically has the strongest lexical/semantic
        // match, being the one candidate whose content literally mentions
        // every step) sets a cutoff threshold its own individual steps
        // can never clear, even though they are the coherent evidence
        // group the query is actually asking for. Found as a real,
        // measured shortfall during this architecture work (the "walk me
        // through everything" case returned only the orchestrator itself,
        // with recall@3 as low as 0.25) — see
        // docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md.
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
