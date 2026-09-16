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

import { classifyQueryIntent, negatedWordSet, wantsMultipleEvidence, type QueryIntent } from "./queryIntent.js";
import { buildReferenceGraph, areLinked, type ReferenceCandidate } from "./referenceGraph.js";
import { tokenize, lexicalOverlapScore, type ScoreSignals } from "./hybridScore.js";

export type RerankCandidate = ReferenceCandidate & {
  filePath: string;
  combined: number;
  cutoffBasis: number;
  signals: ScoreSignals;
  /** Cosine similarity between the query's negated-clause text (if any)
   * and this candidate's own embedding vector, computed by the caller
   * (which has embedding access this module deliberately doesn't) —
   * see NEGATED_SEMANTIC_PENALTY's own comment. 0 (a no-op) when the
   * query has no detected negation cue. */
  negatedSimilarity?: number;
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
// Added in the retrieval-target-closure architecture's real-local-
// embedding-model second pass (docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md)
// — finishes wiring up queryIntent.ts's own negatedWordSet(), built in the
// first pass but left unused. Real diagnostic cases showed a consistent
// failure shape a real embedding model's raw semantic judgment cannot
// avoid on its own: a query phrased as a negation ("which function
// returns a project *without* checking ownership", "fails to check that
// the requester owns it") names the exact concept its own correct answer
// must *lack* — and the sibling candidate that actually *has* that
// concept (the ownership-checked variant) is semantically closer to the
// query's own words than the correct, unchecked one is, so it wins on
// semantic score alone. This penalty only ever activates when a real
// negation cue was detected in the query (the large majority of queries
// have none, making this term an exact no-op for them, never a broad
// penalty like the removed qualifierMismatchCount — see hybridScore.ts's
// own comment on why that one was reverted), and only reduces a
// candidate's score in proportion to how much of the query's own negated
// wording that specific candidate's own content/symbol actually contains.
const NEGATED_MATCH_PENALTY = 0.3;
// Semantic counterpart to NEGATED_MATCH_PENALTY, added in the same pass
// after real per-case inspection found the lexical penalty alone still
// missed cases where the negated concept and the wrong candidate's own
// matching word are morphological variants shorter than hybridScore.ts's
// tokensMatch stemming minimum (e.g. "owns" vs. "owned," both under 6
// characters — "which function returns a project without checking that
// the requester owns it," where the correct, unchecked candidate never
// scores this penalty down because "owns"/"owned" never lexically match,
// yet the wrong, ownership-checking candidate is obviously the one a
// human reader would recognize as matching the negated concept). A real
// embedding model's own semantic judgment of the negated clause's text
// against each candidate's content catches this regardless of surface
// word form — weight kept low (a real weight sweep found 0.1 the measured
// optimum; higher values started reducing direct-hit-rate on cases this
// signal doesn't even touch, by over-suppressing legitimate semantic
// overlap once compounded with a lower `HYBRID_WEIGHTS.semantic`). See
// docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md for the full sweep.
const NEGATED_SEMANTIC_PENALTY = 0.1;
// Boosts a same-source-file sibling of the top-scored candidate into the
// top-K ranking (not just past the selection cutoff) when the query's own
// wording signals it wants more than one result (wantsMultipleEvidence) —
// see that function's own comment for the full rationale. Kept small and
// gated by the candidate's own independent lexical/identifier grounding
// (SAME_FILE_GROUNDING_FLOOR), never a blanket "same file as the winner"
// boost. A real sweep found 0.2 the point that recovers Recall@5 without
// affecting Direct-hit-rate in either direction; 0.3+ started reducing it.
const SAME_FILE_EVIDENCE_BONUS = 0.2;
const SAME_FILE_GROUNDING_FLOOR = 0.15;
// A margin-gated "step-specificity" signal, added in the retrieval-target-
// closure architecture's third pass (docs/RETRIEVAL_ARCHITECTURE_MAXIMUM_UPGRADE.md).
// A narrower, safer version of a rule tried and reverted in the second
// pass (see docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md's "step-
// specificity rule" — boost any referenced candidate whose own identifier
// match is at least as strong as the referencer's, found net-negative
// there because it fired too broadly). Real per-case inspection this pass
// found a specific, common shape it missed: an orchestrator/caller
// candidate that merely *references* the action a query describes (e.g.
// `processOrder` calling `normalizeOrderPayload`) naturally accumulates
// lexical overlap with the query from every step it names, outscoring the
// one candidate that actually *performs* that specific action — even
// though the query is asking about the specific step, not the
// orchestrator. Gated on a real margin (`STEP_SPECIFICITY_MARGIN`, not
// merely ">="), and restricted to only a candidate the raw-top-scored
// candidate has a real detected reference to (never same-file alone — a
// same-file extension was measured and found to fix some cases while
// breaking others with no net improvement, so it was not adopted).
const STEP_SPECIFICITY_BONUS = 0.3;
const STEP_SPECIFICITY_MARGIN = 0.1;
// A general code-naming-convention signal, added in the same pass: when a
// same-file candidate's own symbol name is a literal prefix of the raw-
// top-scored candidate's name (e.g. `parseWebhookPayload` is the base of
// `parseWebhookPayloadStrict`), it is very likely the base/primary
// implementation, with the top-scored one a named *variant* of it (a
// widespread real convention — Strict/Safe/Async/V2/Legacy suffixes
// denoting a variant of a base function, independent of any specific
// codebase or benchmark). Found because the variant's own longer name
// tends to accumulate more lexical/semantic overlap with a general
// question about the base behavior than the base function's own shorter,
// plainer name does. Deliberately unidirectional (only ever promotes the
// *base* name, never demotes it) and restricted to exact same-file
// siblings — not a general "shorter name wins" rule, which would have no
// principled justification. A real sweep found 0.2 the point past which
// no further gain was measured; kept at 0.3 for headroom, matching this
// file's other bonus values' rounding.
const BASE_NAME_BONUS = 0.3;

/** True if `variant`'s name (snake_cased for comparison, so both camelCase
 * and snake_case identifiers compare uniformly) starts with `base`'s own
 * name followed by a word boundary — i.e. `base` names the same core
 * concept `variant` extends with a further qualifier. Requires a genuine
 * word-boundary continuation (an underscore after the shared prefix), so
 * `getOrder` is never mistaken for the base of `getOrderRoute` unless the
 * shared prefix actually ends on a word boundary in both spellings. */
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

    // Negation-aware suppression — see NEGATED_MATCH_PENALTY's own comment.
    // Never touches adjustedCutoffBasis, for the same reason a positive
    // bonus never does (see this function's own doc comment): the
    // threshold's reference point must stay independent of any per-
    // candidate adjustment, positive or negative.
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
