// Fixture file for DevForge's evaluation dataset (Phase 11). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately contains a plausible reliability issue so
// review evaluation has a real target to find.

/**
 * Attempts to parse a webhook payload. Intentionally flawed for evaluation
 * purposes: the catch block silently swallows any parse error instead of
 * logging it or surfacing it to the caller, so a malformed payload fails
 * invisibly and is indistinguishable from an empty one.
 */
export function parseWebhookPayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Attempts to parse a webhook payload, surfacing a parse failure instead of
 * hiding it. Included so the fixture dataset also demonstrates the safe
 * pattern the function above should have followed.
 */
export function parseWebhookPayloadStrict(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid webhook payload: ${err instanceof Error ? err.message : String(err)}`);
  }
}
