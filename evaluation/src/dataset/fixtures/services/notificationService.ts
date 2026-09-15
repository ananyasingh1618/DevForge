// Fixture file for DevForge's evaluation dataset (Phase 11). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately contains a plausible reliability issue so
// review evaluation has a real target to find.

type NotifyPayload = { userId: string; message: string };

/**
 * Sends a notification to an internal notification service. Intentionally
 * flawed for evaluation purposes: the outbound call is fired without being
 * awaited and has no error handling, so a failed delivery is silently lost
 * and the caller has no way to know a notification never went out.
 */
export function notifyUserFireAndForget(baseUrl: string, payload: NotifyPayload): void {
  fetch(`${baseUrl}/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Sends a notification and reports whether it actually succeeded. Included
 * so the fixture dataset also demonstrates the safe pattern the function
 * above should have followed.
 */
export async function notifyUser(baseUrl: string, payload: NotifyPayload): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
