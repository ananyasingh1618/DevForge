/**
 * Byte-for-byte mirror of api/src/lib/qaAnswerGrounding.ts (this package
 * has no dependency on `api` — same cross-package convention every other
 * shared concept in evaluation/ already follows). See that file's own
 * header comment and docs/RETRIEVAL_QUALITY_PHASE_PLAN.md for the full
 * rationale. Used by src/realProviders.ts's realQaAnswers() so real-mode
 * evaluation exercises the identical safety net production applies,
 * rather than scoring raw, ungrounded provider output — and so a
 * fallback's occurrence is actually measurable (see qaEvaluator.ts's
 * `fallbackCount` aggregate metric).
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
