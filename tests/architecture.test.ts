import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * Integration test: register -> create project -> generate architecture,
 * run against genuinely running API and ai-service processes over real
 * HTTP (see register-login-project.test.ts for why this differs from the
 * in-process Supertest tests in api/src/).
 *
 * This environment has no ANTHROPIC_API_KEY configured, so requirements
 * analysis (and therefore PRD generation) cannot succeed here (see
 * requirements.test.ts and prd.test.ts) — meaning the project genuinely has
 * no active PRD version. That is exactly the real path this suite
 * exercises: calling architecture generate on a project with no active PRD
 * must return the real, honest NO_ACTIVE_PRD error, not a fabricated
 * architecture and not a provider error masking the actual dependency
 * problem. If this suite is ever run with a real key AND an active PRD
 * version already present, architecture generation would be expected to
 * succeed instead — but no such run happened here, so no such claim is
 * made.
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

const email = `architecture-integration-test-${Date.now()}@example.com`;
const password = "correct-horse-battery";

describe("register -> create project -> generate architecture (real stack)", () => {
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

  it("gets a real, honest NO_ACTIVE_PRD response — no fabricated architecture, no masking provider error", async () => {
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
      body: JSON.stringify({ name: "Architecture Integration Test Project" }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as { data: { project: { id: string } } };
    const projectId = createBody.data.project.id;

    // The dependency check must fire before ai-service is ever called, so
    // the project having zero PRD versions is sufficient here — this call
    // intentionally never touches /prd/generate.
    const listPrdRes = await fetch(`${API_URL}/projects/${projectId}/prd`, {
      headers: { Cookie: sessionCookie },
    });
    const listPrdBody = (await listPrdRes.json()) as { data: { versions: unknown[] } };
    expect(listPrdBody.data.versions).toHaveLength(0);

    // The real path a user would take: through the Node API.
    const generateRes = await fetch(`${API_URL}/projects/${projectId}/architecture/generate`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });
    expect(generateRes.status).toBe(400);
    const generateBody = (await generateRes.json()) as { error: { code: string; message: string } };
    expect(generateBody.error.code).toBe("NO_ACTIVE_PRD");

    // Nothing was persisted from the blocked attempt.
    const listArchitectureRes = await fetch(`${API_URL}/projects/${projectId}/architecture`, {
      headers: { Cookie: sessionCookie },
    });
    const listArchitectureBody = (await listArchitectureRes.json()) as {
      data: { versions: unknown[] };
    };
    expect(listArchitectureBody.data.versions).toHaveLength(0);

    // Confirm ai-service itself genuinely has no provider configured right
    // now, so this environment's PROVIDER_NOT_CONFIGURED path (already
    // covered for real in ai-service/tests/test_architecture.py) is not
    // silently stale — the dependency check above ran first specifically
    // because it must, not because the provider path was unreachable to
    // test.
    const directAiRes = await fetch(`${AI_SERVICE_URL}/architecture/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prd: {
          overview: "A tool that tracks coffee consumption during code reviews.",
          problem_statement: "Developers have no way to correlate coffee intake with reviews.",
        },
      }),
    });
    expect(directAiRes.status).toBe(503);
    const directAiBody = (await directAiRes.json()) as { error: { code: string } };
    expect(directAiBody.error.code).toBe("PROVIDER_NOT_CONFIGURED");
  });
});
