import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * Integration test: register -> create project -> analyze requirements,
 * run against genuinely running API and ai-service processes over real
 * HTTP (see register-login-project.test.ts for why this differs from the
 * in-process Supertest tests in api/src/).
 *
 * This environment has no ANTHROPIC_API_KEY configured, so the asserted
 * outcome is the real, honest AI_PROVIDER_UNAVAILABLE error — not a
 * fabricated success. That absence is itself the thing worth proving: even
 * through the complete real stack (browser-equivalent HTTP call -> Node API
 * -> ai-service -> Anthropic-provider check), nothing invents a result. If
 * this suite is ever run with a real key configured, the analyze call would
 * be expected to return 201 with real structured content instead — but no
 * such run happened here, so no such claim is made.
 *
 * Requires: the API at API_URL (default http://localhost:4000) and
 * ai-service at AI_SERVICE_URL (default http://localhost:8001), both
 * reachable, API backed by a real migrated Postgres database.
 */

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8001";
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

const email = `req-integration-test-${Date.now()}@example.com`;
const password = "correct-horse-battery";

describe("register -> create project -> analyze requirements (real stack)", () => {
  const dbClient = new Client({ connectionString: DATABASE_URL });
  let dbConnected = false;

  beforeAll(async () => {
    await waitForHealth(API_URL, "API");
    await waitForHealth(AI_SERVICE_URL, "ai-service");
    await dbClient.connect();
    dbConnected = true;
  });

  afterAll(async () => {
    if (!dbConnected) return;
    await dbClient.query("DELETE FROM users WHERE email = $1", [email]);
    await dbClient.end();
  });

  it("gets a real, honest AI_PROVIDER_UNAVAILABLE response — no fabricated requirements", async () => {
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
      body: JSON.stringify({ name: "Requirements Integration Test Project" }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as { data: { project: { id: string } } };
    const projectId = createBody.data.project.id;

    // Confirm ai-service itself genuinely has no provider configured right
    // now, so the assertion below reflects this environment's real state
    // rather than an assumption.
    const directAiRes = await fetch(`${AI_SERVICE_URL}/requirements/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: "A tool that tracks coffee consumption during reviews." }),
    });
    expect(directAiRes.status).toBe(503);
    const directAiBody = (await directAiRes.json()) as { error: { code: string } };
    expect(directAiBody.error.code).toBe("PROVIDER_NOT_CONFIGURED");

    // Now the real path a user would take: through the Node API.
    const analyzeRes = await fetch(`${API_URL}/projects/${projectId}/requirements/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ idea: "A tool that tracks coffee consumption during reviews." }),
    });
    expect(analyzeRes.status).toBe(503);
    const analyzeBody = (await analyzeRes.json()) as { error: { code: string; message: string } };
    expect(analyzeBody.error.code).toBe("AI_PROVIDER_UNAVAILABLE");

    // Nothing was persisted from the failed attempt.
    const listRes = await fetch(`${API_URL}/projects/${projectId}/requirements`, {
      headers: { Cookie: sessionCookie },
    });
    const listBody = (await listRes.json()) as { data: { versions: unknown[] } };
    expect(listBody.data.versions).toHaveLength(0);
  });
});
