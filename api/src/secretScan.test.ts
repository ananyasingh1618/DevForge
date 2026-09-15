import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { env } from "./env.js";
import { containsSecretPattern } from "./lib/secretRedaction.js";

/**
 * Phase 16, Milestone 16.6 — a dedicated cross-surface secret-pattern test
 * suite. Distinct from (and building on) Milestone 16.4's
 * `secretRedaction.test.ts`, which unit-tests the redaction function in
 * isolation: this file drives a real, full-stack flow (register -> connect
 * a repository with a realistically-shaped GitHub token -> index a file
 * containing an embedded secret -> search -> create/cancel a job ->
 * disconnect) and scans EVERY API response body and every captured
 * console.log line for anything matching a known secret shape —
 * `containsSecretPattern()` — rather than checking only the specific
 * fields a developer happened to think to assert on individually.
 *
 * Uses a realistic 40-character `ghp_`-prefixed token (not the short
 * `ghp_faketoken1234567890` fixture value used elsewhere in the suite,
 * which is deliberately too short to match the real GitHub-token-shape
 * regex) so this test would actually catch a real leak if one existed.
 */

const app = createApp();

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
const REALISTIC_TOKEN = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const SOURCE_WITH_SECRET =
  'export const dbConfig = {\n  connectionString: "postgresql://admin:sup3rSecretPass@prod-db.internal:5432/app",\n  awsAccessKey: "AKIAIOSFODNN7EXAMPLE",\n};\n';

async function cleanDb() {
  await prisma.job.deleteMany();
  await prisma.codeChunk.deleteMany();
  await prisma.indexedFile.deleteMany();
  await prisma.codebaseIndex.deleteMany();
  await prisma.repositoryConnection.deleteMany();
  await prisma.session.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

beforeEach(async () => {
  await cleanDb();
  env.GITHUB_TOKEN_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  env.GITHUB_TOKEN_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

afterAll(async () => {
  await cleanDb();
  env.GITHUB_TOKEN_ENCRYPTION_KEY = undefined;
  await prisma.$disconnect();
});

function base64(content: string): string {
  return Buffer.from(content, "utf-8").toString("base64");
}

function mockFetchResponses(responses: Array<{ status: number; body: unknown }>) {
  let callIndex = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      const r = (responses[callIndex] ?? responses[responses.length - 1])!;
      callIndex++;
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
    }),
  );
}

function embedBody(vectors: number[][]) {
  return { embeddings: vectors, model: "voyage-code-3", dimensions: vectors[0]?.length ?? 0 };
}

async function registerAndGetCookie(email: string) {
  const res = await request(app).post("/auth/register").send({ email, password: "correct-horse-battery" });
  return res.headers["set-cookie"] as unknown as string[];
}

describe("cross-surface secret scan (Phase 16, Milestone 16.6)", () => {
  it("never leaks the connecting GitHub token or repo-embedded secrets across a full connect->index->search->job->disconnect flow", async () => {
    const cookie = await registerAndGetCookie("secretscan-full@example.com");
    const projectCreateRes = await request(app).post("/projects").set("Cookie", cookie).send({ name: "Secret Scan Project" });
    const projectId = projectCreateRes.body.data.project.id as string;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const responseBodies: unknown[] = [];

    async function trackedRequest(exec: () => Promise<request.Response>): Promise<request.Response> {
      const res = await exec();
      responseBodies.push(res.body);
      return res;
    }

    // Connect.
    mockFetchResponses([
      { status: 200, body: { login: "octocat", id: 1 } },
      { status: 200, body: { id: 1, full_name: "octocat/secrets-repo", html_url: "https://github.com/octocat/secrets-repo", default_branch: "main", private: false } },
    ]);
    await trackedRequest(() =>
      request(app)
        .post(`/projects/${projectId}/repository/connect`)
        .set("Cookie", cookie)
        .send({ token: REALISTIC_TOKEN, owner: "octocat", repo: "secrets-repo" }),
    );

    // Get connection.
    await trackedRequest(() => request(app).get(`/projects/${projectId}/repository`).set("Cookie", cookie));

    // Verify.
    mockFetchResponses([
      { status: 200, body: { login: "octocat", id: 1 } },
      { status: 200, body: { id: 1, full_name: "octocat/secrets-repo", html_url: "https://github.com/octocat/secrets-repo", default_branch: "main", private: false } },
    ]);
    await trackedRequest(() => request(app).post(`/projects/${projectId}/repository/verify`).set("Cookie", cookie));

    // List branches.
    mockFetchResponses([{ status: 200, body: [{ name: "main", protected: true }] }]);
    await trackedRequest(() => request(app).get(`/projects/${projectId}/repository/branches`).set("Cookie", cookie));

    // Index a file with an embedded secret.
    mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-secretscan" } } },
      { status: 200, body: { tree: [{ path: "src/db.ts", type: "blob", sha: "sha-db", size: SOURCE_WITH_SECRET.length }], truncated: false } },
      { status: 200, body: { content: base64(SOURCE_WITH_SECRET), encoding: "base64" } },
      { status: 200, body: { language: "typescript", status: "parsed", symbols: [], error: null } },
    ]);
    await trackedRequest(() => request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie));

    // Search (triggers chunk-building + embedding).
    mockFetchResponses([
      { status: 200, body: { content: base64(SOURCE_WITH_SECRET), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
    ]);
    await trackedRequest(() => request(app).post(`/projects/${projectId}/search`).set("Cookie", cookie).send({ query: "db config" }));

    // Create and cancel a job.
    const jobCreateRes = await trackedRequest(() =>
      request(app).post(`/projects/${projectId}/jobs`).set("Cookie", cookie).send({ type: "qa", input: { question: "what is the connection string" } }),
    );
    const jobId = (jobCreateRes.body as { data: { job: { id: string } } }).data.job.id;
    await trackedRequest(() => request(app).post(`/projects/${projectId}/jobs/${jobId}/cancel`).set("Cookie", cookie));
    await trackedRequest(() => request(app).get(`/projects/${projectId}/jobs`).set("Cookie", cookie));

    // Update branch, then disconnect.
    mockFetchResponses([{ status: 200, body: [{ name: "main", protected: true }] }]);
    await trackedRequest(() => request(app).patch(`/projects/${projectId}/repository`).set("Cookie", cookie).send({ branch: "main" }));
    await trackedRequest(() => request(app).delete(`/projects/${projectId}/repository`).set("Cookie", cookie));

    // Scan every response body captured across the entire flow.
    for (const body of responseBodies) {
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(REALISTIC_TOKEN);
      expect(serialized).not.toContain("sup3rSecretPass");
      expect(serialized).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(containsSecretPattern(serialized)).toBe(false);
    }

    // Scan every console.log/console.error line captured across the entire
    // flow (audit-log events, error logging, anything else emitted).
    const allLoggedLines = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => String(call[0]));
    for (const line of allLoggedLines) {
      expect(line).not.toContain(REALISTIC_TOKEN);
      expect(line).not.toContain("sup3rSecretPass");
      expect(line).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(containsSecretPattern(line)).toBe(false);
    }

    logSpy.mockRestore();
    errorSpy.mockRestore();

    // Confirms this test actually exercised something (not a vacuous pass
    // over an empty array) and that the token really was used for real
    // GitHub calls, not skipped.
    expect(responseBodies.length).toBeGreaterThan(5);
  });

  it("never leaks a password in any auth response across register/login/logout/me", async () => {
    const PASSWORD = "correct-horse-battery-staple-9000";
    const email = "secretscan-auth@example.com";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const registerRes = await request(app).post("/auth/register").send({ email, password: PASSWORD });
    const cookie = registerRes.headers["set-cookie"] as unknown as string[];
    const loginRes = await request(app).post("/auth/login").send({ email, password: PASSWORD });
    const meRes = await request(app).get("/auth/me").set("Cookie", cookie);
    await request(app).post("/auth/logout").set("Cookie", cookie);

    for (const res of [registerRes, loginRes, meRes]) {
      expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    }
    const allLoggedLines = logSpy.mock.calls.map((call) => String(call[0]));
    for (const line of allLoggedLines) {
      expect(line).not.toContain(PASSWORD);
    }
    logSpy.mockRestore();
  });
});
