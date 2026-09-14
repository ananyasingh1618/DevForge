import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * Integration test: register -> create project -> attempt a code search, run
 * against a genuinely running API process over real HTTP (see
 * register-login-project.test.ts for why this differs from the in-process
 * Supertest tests in api/src/).
 *
 * This environment has no repository connected (and no completed codebase
 * index) for a freshly created project, so the real path this suite
 * exercises is the honest NO_COMPLETED_INDEX error — reached before any
 * GitHub or embedding-provider call is made — not a fabricated search
 * result. Like tests/codebaseIndex.test.ts, this suite needs no real GitHub
 * credentials and does not need ai-service running at all: the pipeline
 * never reaches GitHub or the embedding provider without a completed index.
 *
 * Requires: the API at API_URL (default http://localhost:4000), reachable,
 * backed by a real migrated Postgres database.
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

const email = `retrieval-integration-test-${Date.now()}@example.com`;
const password = "correct-horse-battery";

describe("register -> create project -> attempt a code search (real stack)", () => {
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

  it("gets a real, honest NO_COMPLETED_INDEX response — no fabricated search results", async () => {
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
      body: JSON.stringify({ name: "Retrieval Integration Test Project" }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as { data: { project: { id: string } } };
    const projectId = createBody.data.project.id;

    // The real path a user would take: through the Node API, with no
    // repository ever connected and no codebase index ever built for this
    // project.
    const searchRes = await fetch(`${API_URL}/projects/${projectId}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ query: "where do we validate a session token?" }),
    });
    expect(searchRes.status).toBe(400);
    const searchBody = (await searchRes.json()) as { error: { code: string; message: string } };
    expect(searchBody.error.code).toBe("NO_COMPLETED_INDEX");
  });
});
