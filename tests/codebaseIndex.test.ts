import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * Integration test: register -> create project -> attempt to start codebase
 * indexing, run against a genuinely running API process over real HTTP (see
 * register-login-project.test.ts for why this differs from the in-process
 * Supertest tests in api/src/).
 *
 * This environment has no repository connected for a freshly created
 * project, so the real path this suite exercises is the honest
 * NO_REPOSITORY_CONNECTED error — reached before any GitHub or ai-service
 * call is made — not a fabricated indexing result. Like
 * tests/repository.test.ts, this suite needs no real GitHub credentials and,
 * notably, does not need ai-service running at all: the pipeline never
 * reaches the parser without a connected repository.
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

const email = `codebase-index-integration-test-${Date.now()}@example.com`;
const password = "correct-horse-battery";

describe("register -> create project -> attempt codebase indexing (real stack)", () => {
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

  it("gets a real, honest NO_REPOSITORY_CONNECTED response — no fabricated index", async () => {
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
      body: JSON.stringify({ name: "Codebase Index Integration Test Project" }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as { data: { project: { id: string } } };
    const projectId = createBody.data.project.id;

    // Confirmed empty before attempting to index.
    const getBeforeRes = await fetch(`${API_URL}/projects/${projectId}/codebase-index`, {
      headers: { Cookie: sessionCookie },
    });
    const getBeforeBody = (await getBeforeRes.json()) as { data: { index: unknown } };
    expect(getBeforeBody.data.index).toBeNull();

    // The real path a user would take: through the Node API, with no
    // repository ever connected for this project.
    const startRes = await fetch(`${API_URL}/projects/${projectId}/codebase-index/start`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });
    expect(startRes.status).toBe(400);
    const startBody = (await startRes.json()) as { error: { code: string; message: string } };
    expect(startBody.error.code).toBe("NO_REPOSITORY_CONNECTED");

    // Nothing was persisted from the blocked attempt.
    const getAfterRes = await fetch(`${API_URL}/projects/${projectId}/codebase-index`, {
      headers: { Cookie: sessionCookie },
    });
    const getAfterBody = (await getAfterRes.json()) as { data: { index: unknown } };
    expect(getAfterBody.data.index).toBeNull();

    // Listing files/symbols before any index exists is also a real, honest
    // 404 — never an empty-but-"successful" list.
    const filesRes = await fetch(`${API_URL}/projects/${projectId}/codebase-index/files`, {
      headers: { Cookie: sessionCookie },
    });
    expect(filesRes.status).toBe(404);
    const filesBody = (await filesRes.json()) as { error: { code: string } };
    expect(filesBody.error.code).toBe("CODEBASE_INDEX_NOT_FOUND");
  });
});
