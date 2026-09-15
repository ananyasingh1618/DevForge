// Fixture file for DevForge's evaluation dataset (Phase 11). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately contains a plausible security issue so review
// evaluation has a real target to find.

export type SessionUser = {
  id: string;
  passwordHash: string;
};

/**
 * Looks up a user and checks their submitted password against the stored
 * hash. Intentionally flawed for evaluation purposes: it compares the
 * hash with plain string equality instead of a constant-time comparison,
 * which makes the check vulnerable to a timing side-channel attack.
 */
export function verifyPassword(user: SessionUser, submittedHash: string): boolean {
  return user.passwordHash === submittedHash;
}

/**
 * Middleware-style guard for an authenticated route. Requires a session
 * token to be present on the request and resolves the associated user.
 */
export function requireAuth(sessionToken: string | undefined, sessions: Map<string, SessionUser>) {
  if (!sessionToken) {
    throw new Error("Authentication required");
  }
  const user = sessions.get(sessionToken);
  if (!user) {
    throw new Error("Invalid session");
  }
  return user;
}
