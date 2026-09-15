// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Exercises the "configuration" category and the "exact
// variable name" category via MAX_RETRY_ATTEMPTS.

/** Maximum number of times a failed outbound request is retried before
 * giving up. Referenced by name in a retrieval case as an exact-identifier
 * query. */
export const MAX_RETRY_ATTEMPTS = 3;

const flags: Record<string, boolean> = {
  "new-checkout-flow": false,
  "beta-search-ranking": true,
};

/**
 * Checks whether a named feature flag is enabled. Unknown flag names
 * default to disabled rather than throwing.
 */
export function isFeatureEnabled(flagName: string): boolean {
  return flags[flagName] ?? false;
}
