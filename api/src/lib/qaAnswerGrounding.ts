/**
 * Deterministic post-processing safety net for a Q&A provider's raw answer
 * — see docs/RETRIEVAL_QUALITY_PHASE_PLAN.md, Milestone 4. Citation-number
 * filtering itself (dropping an out-of-range/negative/non-integer/
 * duplicate reference) was already correct before this phase — a `Set`
 * naturally deduplicates, and the existing range check already rejected
 * out-of-range and non-integer values (re-confirmed, not re-implemented,
 * by this file's own tests). The one real gap this phase found: a
 * provider could return `insufficient_evidence: false` (a confident-
 * looking answer) while citing zero valid sources — an answer with no
 * grounded citation at all is, by this system's own citation-safety
 * design, unverifiable and must never be presented as an established
 * fact. `groundAnswer()` is the single choke point that guarantees this
 * can never reach a persisted `Answer` row or an API response — bounded
 * and deterministic (a text substitution, never a retry or a second
 * provider call), never silently converting a fabricated citation into a
 * different one.
 */

export type RawQaAnswer = {
  answer: string;
  citedSourceNumbers: number[];
  insufficientEvidence: boolean;
};

export type GroundedQaAnswer = {
  answer: string;
  citedOrders: Set<number>;
  insufficientEvidence: boolean;
  /** True when this function overrode the provider's own answer/flag —
   * exposed so callers can log/observe the override without needing to
   * re-derive it (never logged with any source content, just a boolean). */
  overridden: boolean;
};

export const UNGROUNDED_FALLBACK_ANSWER =
  "The generated answer did not cite any of the supplied evidence, so it cannot be safely " +
  "grounded. Try rephrasing the question, or ask about a more specific file, function, or feature.";

/**
 * Re-validates cited source numbers against the real `1..sourceCount`
 * range (defense in depth on top of the identical filtering ai-service's
 * own provider already performs — never trust either layer alone), then
 * applies the zero-valid-citation safety net described above.
 */
export function groundAnswer(raw: RawQaAnswer, sourceCount: number): GroundedQaAnswer {
  const citedOrders = new Set(
    raw.citedSourceNumbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= sourceCount),
  );

  if (!raw.insufficientEvidence && citedOrders.size === 0 && sourceCount > 0) {
    return { answer: UNGROUNDED_FALLBACK_ANSWER, citedOrders, insufficientEvidence: true, overridden: true };
  }

  return { answer: raw.answer, citedOrders, insufficientEvidence: raw.insufficientEvidence, overridden: false };
}
