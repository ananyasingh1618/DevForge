/**
 * Bounded, safe security-audit logging (Phase 16, Milestone 16.5).
 * Follows the exact same pattern as `searchObservability.ts` (Phase 14):
 * one structured JSON line per event, to stdout — no new database table,
 * no new infrastructure, consistent with this project's own established
 * minimalism precedent. Deliberately never includes a password, a raw
 * session token, a GitHub token, or any other credential-shaped value —
 * only the event type, actor, and outcome needed to reconstruct "who did
 * what, when, with what result" for a real security investigation.
 */

export type AuditEvent =
  | { event: "auth.register"; userId: string }
  | { event: "auth.login_success"; userId: string }
  | { event: "auth.login_failure" } // deliberately no email/identifier — see loginUser()'s own enumeration-resistance rationale; logging which email was tried would reintroduce the same enumeration surface the identical-error-message design exists to close
  | { event: "auth.logout"; userId: string }
  | { event: "ownership.denied"; userId: string; projectId: string }
  | { event: "repository.connected"; userId: string; projectId: string }
  | { event: "repository.disconnected"; userId: string; projectId: string };

export function logAuditEvent(event: AuditEvent): void {
  console.log(JSON.stringify({ ...event, timestamp: new Date().toISOString(), category: "audit" }));
}
