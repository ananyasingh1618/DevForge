import type { ReviewFindingFromAi } from "./aiServiceClient.js";

/**
 * Independently re-validates every finding's cited source numbers against
 * the real, Node-owned `1..sourceCount` range, and drops any finding left
 * with zero valid citations after filtering — an uncited finding is not
 * evidence-based and must never be persisted. Defense in depth on top of
 * the identical filtering ai-service's own AnthropicReviewProvider already
 * performs (see ai-service/app/agents/review/provider.py); never trust
 * either layer alone. Pure and deterministic: the same input always
 * produces the same output, directly unit-testable without a database or a
 * network call — mirrors lib/qaSourceSelection.ts's own precedent for why
 * this kind of safety-critical logic is factored out as a standalone
 * function rather than left inline in the service.
 */
export function filterValidFindings(
  findings: ReviewFindingFromAi[],
  sourceCount: number,
): ReviewFindingFromAi[] {
  return findings
    .map((finding) => ({
      ...finding,
      citedSourceNumbers: [...new Set(finding.citedSourceNumbers)].filter(
        (n) => Number.isInteger(n) && n >= 1 && n <= sourceCount,
      ),
    }))
    .filter((finding) => finding.citedSourceNumbers.length > 0);
}
