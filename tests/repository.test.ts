import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * Integration test: register -> create project -> connect a repository, run
 * against a genuinely running API process over real HTTP (see
 * register-login-project.test.ts for why this differs from the in-process
 * Supertest tests in api/src/).
 *
 * This environment has no GITHUB_TOKEN_ENCRYPTION_KEY configured (confirmed
 * in docs/GITHUB_INTEGRATION_PHASE_PLAN.md's Milestone 1 inspection), so
 * connecting a repository genuinely cannot succeed here — meaning the real
 * path this suite exercises is the honest, real
 * GITHUB_INTEGRATION_NOT_CONFIGURED error, not a fabricated connection. If
 * this suite is ever run with a real key configured AND a real, valid
 * user-supplied GitHub personal access token, connecting would be expected
 * to succeed instead — but no such run happened here, so no such claim is
 * made, and no real GitHub credentials are used or required by this test.
 *
 * Requires: the API at API_URL (default http://localhost:4000), reachable,
 * backed by a real migrated Postgres database. Unlike every prior phase's
 * integration test, this one does not need ai-service at all — GitHub
 * integration never calls it.
 */

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://devforge:devforge@localhost:5433/devforge";

async function waitForHealth(url: string, label: string, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // Not reachable yet; keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} at ${url} did not become healthy within ${timeoutMs}ms.`);
}

function extractCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error(`Expected a Set-Cookie header on response from ${res.url}`);
  }
  return setCookie.split(";")[0] ?? "";
}

const email = `repository-integration-test-${Date.now()}@example.com`;
const password = "correct-horse-battery";

describe("register -> create project -> connect a repository (real stack)", () => {
  const dbClient = new Client({ connectionString: DATABASE_URL });
  let dbConnected = false;

  beforeAll(async () => {
    await waitForHealth(API_URL, "API");
    await dbClient.connect();
    dbConnected = true;
  });

  afterAll(async () => {
    if (!dbConnected) return;
    await dbClient.query("DELETE FROM users WHERE email = $1", [email]);
    await dbClient.end();
  });

  it("gets a real, honest GITHUB_INTEGRATION_NOT_CONFIGURED response — no fabricated connection", async () => {
    const registerRes = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(registerRes.status).toBe(201);
    const sessionCookie = extractCookie(registerRes);

    const createRes = await fetch(`${API_URL}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ name: "Repository Integration Test Project" }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as { data: { project: { id: string } } };
    const projectId = createBody.data.project.id;

    // Confirmed empty before attempting to connect.
    const getBeforeRes = await fetch(`${API_URL}/projects/${projectId}/repository`, {
      headers: { Cookie: sessionCookie },
    });
    const getBeforeBody = (await getBeforeRes.json()) as { data: { connection: unknown } };
    expect(getBeforeBody.data.connection).toBeNull();

    // The real path a user would take: through the Node API. No real GitHub
    // credentials are used — this token is intentionally fake, and the
    // request never reaches GitHub at all, since the config check fires
    // first.
    const connectRes = await fetch(`${API_URL}/projects/${projectId}/repository/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ token: "ghp_notARealToken1234567890", owner: "octocat", repo: "Hello-World" }),
    });
    expect(connectRes.status).toBe(503);
    const connectBody = (await connectRes.json()) as { error: { code: string; message: string } };
    expect(connectBody.error.code).toBe("GITHUB_INTEGRATION_NOT_CONFIGURED");

    // Nothing was persisted from the blocked attempt.
    const getAfterRes = await fetch(`${API_URL}/projects/${projectId}/repository`, {
      headers: { Cookie: sessionCookie },
    });
    const getAfterBody = (await getAfterRes.json()) as { data: { connection: unknown } };
    expect(getAfterBody.data.connection).toBeNull();
  });
});
