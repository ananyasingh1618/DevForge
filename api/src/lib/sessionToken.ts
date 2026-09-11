import crypto from "node:crypto";

export const SESSION_COOKIE_NAME = "devforge_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * The raw token is what's sent to the client in the cookie. Only its SHA-256
 * hash is ever persisted in the sessions table, so a database read alone
 * (e.g. via a leaked backup) can't be used to impersonate a session.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
