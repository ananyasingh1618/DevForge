// Fixture file for DevForge's evaluation dataset (Phase 11). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Deliberately contains a plausible security issue so review
// evaluation has a real target to find.

/**
 * Fetches a repository's default branch from the GitHub REST API.
 * Intentionally flawed for evaluation purposes: when the request fails,
 * the error message includes the raw access token, so the token can end
 * up in logs or error-tracking systems.
 */
export async function getDefaultBranch(owner: string, repo: string, token: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GitHub request failed using token ${token}: ${res.status}`);
  }
  const body = (await res.json()) as { default_branch: string };
  return body.default_branch;
}

/**
 * Fetches a repository's default branch without ever including the token
 * in an error message. Included so the fixture dataset also demonstrates
 * the safe pattern the function above should have followed.
 */
export async function getDefaultBranchSafe(owner: string, repo: string, token: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GitHub request failed: ${res.status}`);
  }
  const body = (await res.json()) as { default_branch: string };
  return body.default_branch;
}
