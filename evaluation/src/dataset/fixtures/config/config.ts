// Fixture file for DevForge's evaluation dataset (Phase 11). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately contains a plausible reliability issue so
// review evaluation has a real target to find.

/**
 * Loads the configured webhook signing secret. Intentionally flawed for
 * evaluation purposes: if the environment variable is unset, it silently
 * falls back to `undefined` instead of failing clearly, so signature
 * verification later either throws a confusing low-level error or, worse,
 * silently no-ops.
 */
export function loadWebhookSecret(env: Record<string, string | undefined>): string | undefined {
  return env.WEBHOOK_SIGNING_SECRET;
}

/**
 * Loads the configured request timeout in milliseconds, with a real,
 * validated default. Included so the fixture dataset also demonstrates
 * the safe pattern the function above should have followed.
 */
export function loadRequestTimeoutMs(env: Record<string, string | undefined>): number {
  const raw = env.REQUEST_TIMEOUT_MS;
  if (!raw) return 5000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`REQUEST_TIMEOUT_MS must be a positive number, got: ${raw}`);
  }
  return parsed;
}
