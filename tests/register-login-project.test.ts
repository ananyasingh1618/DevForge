import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * Integration test: register -> login -> create project -> list project,
 * run against a genuinely running API process over real HTTP (not an
 * in-process Supertest app instance like api/src/**\/*.test.ts uses). This
 * is what actually proves the deployed server, not just the Express app
 * object, works end to end.
 *
 * Requires: the API reachable at API_URL (default http://localhost:4000)
 * backed by a real, migrated Postgres database. Start both before running
 * (see docs/FOUNDATION_PROGRESS.md / the root README for exact commands).
 */

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://devforge:devforge@localhost:5433/devforge";

async function waitForHealth(timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) return;
    } catch {
      // API not reachable yet; keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `API at ${API_URL} did not become healthy within ${timeoutMs}ms. Is it running? ` +
      `(cd api && pnpm dev)`,
  );
}

function extractCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error(`Expected a Set-Cookie header on response from ${res.url}`);
  }
  // Only the cookie's own name=value pair should be echoed back on
  // subsequent requests, not its Path/Expires/HttpOnly/SameSite attributes.
  return setCookie.split(";")[0] ?? "";
}

const email = `integration-test-${Date.now()}@example.com`;
const password = "correct-horse-battery";

describe("register -> login -> create project -> list project", () => {
  const dbClient = new Client({ connectionString: DATABASE_URL });
  let dbConnected = false;

  beforeAll(async () => {
    await waitForHealth();
    await dbClient.connect();
    dbConnected = true;
  });

  afterAll(async () => {
    // If beforeAll threw (e.g. the API never came up), the client was never
    // connected — using it here would hang until hookTimeout instead of
    // failing fast with the real error from beforeAll.
    if (!dbConnected) return;
    await dbClient.query("DELETE FROM users WHERE email = $1", [email]);
    await dbClient.end();
  });

  it("runs the full flow against the real HTTP server", async () => {
    // 1. Register.
    const registerRes = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(registerRes.status).toBe(201);
    const registerBody = (await registerRes.json()) as { data: { user: { email: string } } };
    expect(registerBody.data.user.email).toBe(email);

    // 2. Login (a separate request/session, proving login works
    // independently of the session register happens to create).
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(loginRes.status).toBe(200);
    const sessionCookie = extractCookie(loginRes);

    // 3. Create a project using the login session.
    const createRes = await fetch(`${API_URL}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({
        name: "Integration Test Project",
        description: "Created by the register->login->create->list integration test.",
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as {
      data: { project: { id: string; name: string } };
    };
    expect(createBody.data.project.name).toBe("Integration Test Project");
    const projectId = createBody.data.project.id;

    // 4. List projects and confirm the created project is present.
    const listRes = await fetch(`${API_URL}/projects`, {
      headers: { Cookie: sessionCookie },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: { projects: Array<{ id: string; name: string }> };
    };
    expect(listBody.data.projects.some((p) => p.id === projectId)).toBe(true);

    // 5. Fetch it by id too, for completeness of the vertical slice.
    const getRes = await fetch(`${API_URL}/projects/${projectId}`, {
      headers: { Cookie: sessionCookie },
    });
    expect(getRes.status).toBe(200);
  });

  it("confirms only a bcrypt hash and a SHA-256 session token hash are ever persisted", async () => {
    const { rows: userRows } = await dbClient.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = $1",
      [email],
    );
    expect(userRows).toHaveLength(1);
    expect(userRows[0]?.password_hash).toMatch(/^\$2[aby]\$/);
    expect(userRows[0]?.password_hash).not.toContain(password);

    const { rows: sessionRows } = await dbClient.query<{ token_hash: string }>(
      `SELECT s.token_hash FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE u.email = $1`,
      [email],
    );
    expect(sessionRows.length).toBeGreaterThan(0);
    for (const row of sessionRows) {
      expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
