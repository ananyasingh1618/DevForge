// Fixture file for DevForge's evaluation dataset (Phase 12, Milestone 6) — a
// new adversarial fixture added to stress-test retrieval disambiguation, not
// present when the ranking improvements in Milestone 3 were designed. Small,
// synthetic, non-sensitive sample code written for this dataset — not
// copied from any real project.

/**
 * A legacy, deprecated password check retained only for reading old
 * session records in a historical format. Similar in name and purpose to
 * verifyPassword (auth/session.ts) but a distinct function in a distinct
 * file — tests whether retrieval can disambiguate two similarly-purposed
 * functions when a query is specific enough (e.g. naming "legacy") to
 * prefer one over the other.
 */
export function checkLegacyPassword(storedHash: string, submittedHash: string): boolean {
  return storedHash === submittedHash;
}

/**
 * Looks up a user by email for the legacy admin panel, backed by an
 * in-memory map rather than the real database. Same function name as
 * db/userRepository.ts's findUserByEmail, but a distinct implementation
 * with a distinct purpose in a distinct file — tests whether retrieval can
 * tell apart two same-named functions in different files as separate,
 * independently relevant candidates.
 */
export function findUserByEmail(adminDirectory: Map<string, unknown>, email: string): unknown {
  return adminDirectory.get(email) ?? null;
}
