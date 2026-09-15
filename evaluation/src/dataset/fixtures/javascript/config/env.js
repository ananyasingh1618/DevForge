// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Exercises "configuration" and "exact variable name"
// categories in plain JavaScript.

/** Default outbound request timeout in milliseconds, used whenever a
 * caller doesn't specify its own. */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Reads a boolean feature flag from the environment, defaulting to false
 * when unset or set to anything other than "true".
 */
function getFeatureFlag(name) {
  return process.env[name] === "true";
}

module.exports = { DEFAULT_TIMEOUT_MS, getFeatureFlag };
