// Fixture file for DevForge's evaluation dataset (Phase 12, Milestone 6) — a
// new adversarial fixture added to stress-test code review, not present
// when Phase 10 was built. Small, synthetic, non-sensitive sample code
// written for this dataset — not copied from any real project.
//
// Deliberately "suspicious but valid": this function uses a manually
// managed in-memory map with periodic cleanup, which can look unusual or
// error-prone at a glance (no framework, no automatic expiry), but is
// actually correct — every code path that inserts also schedules its own
// removal, and the cleanup interval is bounded. Tests that review does not
// flag an unfamiliar-looking pattern as a defect when it is not actually
// wrong (per the task's "do not report a finding solely because a pattern
// looks unfamiliar" instruction).

const requestCounts = new Map<string, number>();

/**
 * Rate-limits a caller by key, allowing at most `maxRequests` within
 * `windowMs`. Correct despite its manual bookkeeping: every increment is
 * paired with a scheduled decrement via setTimeout, so requestCounts never
 * grows unbounded and every entry is eventually cleaned up.
 */
export function allowRequest(key: string, maxRequests: number, windowMs: number): boolean {
  const current = requestCounts.get(key) ?? 0;
  if (current >= maxRequests) {
    return false;
  }
  requestCounts.set(key, current + 1);
  setTimeout(() => {
    const remaining = (requestCounts.get(key) ?? 1) - 1;
    if (remaining <= 0) {
      requestCounts.delete(key);
    } else {
      requestCounts.set(key, remaining);
    }
  }, windowMs);
  return true;
}
