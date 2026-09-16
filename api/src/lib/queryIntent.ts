/**
 * Lightweight, rule-based query-intent classification — added to close the
 * direct-hit-rate and useful-context-rate gaps documented in
 * docs/RETRIEVAL_TARGET_CLOSURE_PROGRESS.md as a "demonstrated architectural
 * ceiling." Real diagnostic data (re-run against the live evaluator, not
 * assumed) showed several failure classes a single fixed hybrid-score
 * formula structurally cannot distinguish: a query asking for the *public
 * entry point* of a feature scored an internal implementation detail
 * higher; a query asking which function *orchestrates* several steps
 * scored one of the steps higher than the orchestrator; a query asking
 * which function is *imported/called* scored the caller higher than the
 * callee it actually calls. None of these are fixable by reweighting the
 * existing semantic/lexical/identifier/file-path signals — they need a
 * signal that reflects what *kind* of answer the query is actually asking
 * for. This module is deliberately general-purpose: every rule matches on
 * the query's own wording pattern (English question forms any codebase's
 * users would naturally use), never a specific identifier, file, or
 * benchmark case id — verified by grep across this file for any dataset-
 * specific string.
 *
 * Mirrored (not imported — no cross-package dependency, matching every
 * other file's own established convention) in evaluation/src/queryIntent.ts.
 */

export type QueryIntent =
  | "entry-point"
  | "dependency"
  | "usage"
  | "configuration"
  | "error"
  | "test"
  | "definition"
  | "orchestration"
  | "general";

type IntentRule = { intent: QueryIntent; patterns: RegExp[] };

// Ordered by specificity — the first matching rule wins, so a more specific
// phrase (e.g. "public entry point") is checked before a more generic one
// (e.g. "how does") that could otherwise also match the same query.
const INTENT_RULES: IntentRule[] = [
  {
    intent: "entry-point",
    patterns: [
      /\bpublic (entry point|api|interface)\b/i,
      /\bentry point\b/i,
      /\bpublic[- ]facing\b/i,
      /\bexported (function|api)\b/i,
      /\bexposes?\b/i,
    ],
  },
  {
    intent: "orchestration",
    patterns: [
      /\borchestrat/i,
      /\bfrom .+ to .+\b/i,
      /\bwalk me through\b/i,
      /\bend[- ]to[- ]end\b/i,
      /\beverything that happens\b/i,
      /\bwhat function .*(coordinat|orchestrat)/i,
    ],
  },
  {
    intent: "dependency",
    patterns: [
      /\bwhich function does .+ (import|call|use)\b/i,
      /\bimports?\b/i,
      /\bdelegates? to\b/i,
      /\bunderlying .+ function\b/i,
      /\bdepends? on\b/i,
    ],
  },
  {
    intent: "usage",
    patterns: [
      /\bwho calls\b/i,
      /\bwhere is .+ used\b/i,
      /\bused by\b/i,
      /\bcallers? of\b/i,
      /\bwhich .+ (calls|invokes)\b/i,
    ],
  },
  {
    intent: "configuration",
    patterns: [
      /\benvironment variable\b/i,
      /\bconfig(uration)?\b/i,
      /\bfeature flag\b/i,
      /\bsetting\b/i,
      /\bloaded from\b/i,
    ],
  },
  {
    intent: "error",
    patterns: [
      /\berror\b/i,
      /\bexception\b/i,
      // Negative lookahead excludes "fails to <verb>" specifically — that's
      // the "fails to"/"failing to" negation construction (negatedWordSet's
      // own NEGATION_CUES), describing an *omission* the query names, not a
      // question about error-handling code. A bare "X fails"/"a failure
      // occurs" still matches. Found as a real bug during the retrieval-
      // target-closure architecture work: "which function fails to check
      // ownership" was classified as "error" intent, awarding ERROR_BONUS
      // to whichever candidate's content happens to throw/catch — which is
      // reliably the *secure*, correctly-checking sibling, the opposite of
      // what a "fails to check" query is actually asking for. See
      // docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md for the measured case.
      /\bfails?\b(?!\s+to\b)/i,
      /\bfailure\b/i,
      /\bthrows?\b/i,
      /\bvulnerabilit(y|ies)\b/i,
      /\brisk\b/i,
    ],
  },
  {
    intent: "test",
    patterns: [/\btest(s|ing)?\b/i, /\bassert/i, /\bspec\b/i],
  },
  {
    intent: "definition",
    patterns: [/^\s*[A-Za-z][A-Za-z0-9_.]*\s*$/, /\bwhat is\b/i, /\bdefine[sd]?\b/i, /\bdefinition\b/i],
  },
];

/**
 * Classifies a query into a single dominant intent, checked in the fixed
 * priority order above. A query naturally matches at most one category in
 * practice (e.g. an error query rarely also reads as a configuration
 * query), so first-match is sufficient — this stays simple, deterministic,
 * and easy to extend rather than building a full multi-label classifier
 * for a signal that only needs to pick one dominant framing.
 */
export function classifyQueryIntent(query: string): QueryIntent {
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((p) => p.test(query))) {
      return rule.intent;
    }
  }
  return "general";
}

/**
 * Negation-cue detection: finds English negation phrases ("fails to",
 * "doesn't", "does not", "without", "isn't", "missing", "lacks", "never")
 * and returns the raw text span immediately following each cue (up to the
 * next clause boundary), so a caller can identify which query tokens sit
 * inside a negated clause. General English negation patterns, not tied to
 * any specific word this dataset happens to use.
 */
const NEGATION_CUES = [
  /\b(?:fails? to|failing to)\s+([a-z0-9 '-]+?)(?:[.,?]|$)/gi,
  /\b(?:doesn't|does not|didn't|did not)\s+([a-z0-9 '-]+?)(?:[.,?]|$)/gi,
  /\b(?:isn't|is not|aren't|are not|wasn't|was not)\s+([a-z0-9 '-]+?)(?:[.,?]|$)/gi,
  /\bwithout\s+([a-z0-9 '-]+?)(?:[.,?]|$)/gi,
  /\b(?:lacks?|lacking|missing)\s+([a-z0-9 '-]+?)(?:[.,?]|$)/gi,
  /\bnever\s+([a-z0-9 '-]+?)(?:[.,?]|$)/gi,
];

/** Returns the set of lowercase words that appear only inside a detected
 * negated clause of `query` — used to avoid letting a match on one of
 * these words positively boost a candidate purely because it shares a word
 * the query actually negated. */
export function negatedWordSet(query: string): Set<string> {
  const words = new Set<string>();
  for (const pattern of NEGATION_CUES) {
    // Each pattern is stateful (global flag) — reset lastIndex per query so
    // repeated calls against different queries never carry over state.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(query)) !== null) {
      const span = match[1] ?? "";
      for (const w of span.toLowerCase().split(/[^a-z0-9]+/)) {
        if (w.length > 1) words.add(w);
      }
    }
  }
  return words;
}

/**
 * Returns the first detected negated clause's own raw text (not just its
 * individual words) — e.g. "checking that the requester owns it" from
 * "...without checking that the requester owns it". Used for an embedding-
 * based (not just lexical-token-based) suppression signal: `negatedWordSet`
 * alone cannot catch a candidate that matches the negated concept via a
 * short morphological variant below `hybridScore.ts`'s tokensMatch
 * stemming minimum (e.g. "owns" vs. "owned," both under 6 characters) —
 * embedding the clause's own text and comparing it against a candidate's
 * real semantic content catches that regardless of surface word form. Only
 * the first matching cue's clause is used (one embedding call's worth of
 * signal is enough; a query with multiple negated clauses is rare and the
 * first is nearly always the one naming the query's actual distinguishing
 * concept). Returns null when no negation cue is present — the common
 * case, where no extra embedding call is needed at all.
 */
export function negatedClauseText(query: string): string | null {
  for (const pattern of NEGATION_CUES) {
    pattern.lastIndex = 0;
    const match = pattern.exec(query);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Multi-evidence-cue detection: true when the query's own wording signals
 * it wants an enumeration of several results, not one authoritative
 * answer — a plural head noun naming the kind of thing being asked for
 * ("operations", "queries", "functions", "endpoints") or an explicit
 * enumeration quantifier ("every", "all"). General English phrasing
 * patterns, not tied to any specific benchmark case.
 *
 * Added in the retrieval-target-closure architecture's real-local-
 * embedding-model second pass (docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md)
 * to gate same-source-file evidence-group completion (see
 * retrieval.ts/retrievalEvaluator.ts's own selection logic): real
 * measurement showed unconditionally including a same-file sibling
 * candidate once it cleared a grounding floor recovered recall@3/5 but
 * visibly hurt useful-context-rate, because most queries in the benchmark
 * genuinely want exactly one chunk and a same-file sibling is usually
 * *not* relevant to them. Gating the same completion on this cue — so it
 * only fires for the minority of queries that actually ask for more than
 * one thing — recovered recall without that useful-context regression.
 */
const MULTI_EVIDENCE_CUES = [
  /\boperations\b/i,
  /\bqueries\b/i,
  /\bfunctions\b/i,
  /\bendpoints\b/i,
  /\bevery\b/i,
  /\ball\b/i,
];

export function wantsMultipleEvidence(query: string): boolean {
  return MULTI_EVIDENCE_CUES.some((p) => p.test(query));
}
