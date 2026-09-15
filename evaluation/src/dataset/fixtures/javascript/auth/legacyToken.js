// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately flawed, plain JavaScript: a legacy token
// validator using plain string equality, mirroring auth/legacyAuth.ts's
// TypeScript pattern.

/**
 * Validates a legacy API token by comparing it to the stored value with
 * plain string equality (===), not a constant-time comparison. Kept only
 * for backward compatibility with an old integration partner.
 */
function validateLegacyToken(submittedToken, storedToken) {
  return submittedToken === storedToken;
}

module.exports = { validateLegacyToken };
