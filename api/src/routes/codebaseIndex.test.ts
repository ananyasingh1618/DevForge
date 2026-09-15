import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../env.js";
import { MAX_FILE_SIZE_BYTES } from "../services/codebaseIndex.js";

const app = createApp();

async function cleanDb() {
  await prisma.symbol.deleteMany();
  await prisma.indexedFile.deleteMany();
  await prisma.codebaseIndex.deleteMany();
  await prisma.session.deleteMany();
  await prisma.repositoryConnection.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

// Same technique routes/repository.test.ts already established: mutate the
// real, imported `env` object directly (safe because githubTokenCrypto.ts
// reads it at call time, not at import time), rather than vi.mock.
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

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

function getSetCookie(res: request.Response): string[] {
  const cookie = res.headers["set-cookie"] as string[] | undefined;
  if (!cookie) {
    throw new Error("Expected a Set-Cookie header on the response");
  }
  return cookie;
}

async function registerAndGetCookie(email: string) {
  const res = await request(app)
    .post("/auth/register")
    .send({ email, password: "correct-horse-battery" });
  return getSetCookie(res);
}

async function createProject(cookie: string[], name = "Codebase Index Test Project") {
  const res = await request(app).post("/projects").set("Cookie", cookie).send({ name });
  return res.body.data.project.id as string;
}

const GITHUB_USER_BODY = { login: "octocat", id: 1 };
const GITHUB_REPO_BODY = {
  id: 1296269,
  full_name: "octocat/Hello-World",
  html_url: "https://github.com/octocat/Hello-World",
  default_branch: "master",
  private: false,
};

/** Mocks the outbound fetch() calls made by both githubClient.ts (real
 * GitHub API shape) and aiServiceClient.ts's parseFileViaAiService (real
 * ai-service response shape) — both go through the same global fetch, so
 * responses are consumed strictly in the real call order: connect's
 * getAuthenticatedUser/getRepository, then start/reindex's
 * getBranchCommit, getTree, and one getBlob+parse pair per fetched file.
 * Mirrors routes/repository.test.ts's mockGithubResponses, extended to also
 * cover the parser call and to expose the underlying spy so tests can
 * assert exact call counts (for the determinism/short-circuit behavior). */
function mockFetchResponses(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  let callIndex = 0;
  const spy = vi.fn().mockImplementation(async () => {
    const r = (responses[callIndex] ?? responses[responses.length - 1])!;
    callIndex++;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (name: string) => r.headers?.[name] ?? null },
      json: async () => r.body,
    };
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function base64(content: string): string {
  return Buffer.from(content, "utf-8").toString("base64");
}

async function connectRepository(cookie: string[], projectId: string) {
  mockFetchResponses([
    { status: 200, body: GITHUB_USER_BODY },
    { status: 200, body: GITHUB_REPO_BODY },
  ]);
  const res = await request(app)
    .post(`/projects/${projectId}/repository/connect`)
    .set("Cookie", cookie)
    .send({ token: "ghp_faketoken1234567890", owner: "octocat", repo: "Hello-World" });
  return res.body.data.connection;
}

describe("auth and ownership (representative across all five endpoints)", () => {
  it("returns 401 without a session on every endpoint", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    expect((await request(app).post(`/projects/${id}/codebase-index/start`)).status).toBe(401);
    expect((await request(app).get(`/projects/${id}/codebase-index`)).status).toBe(401);
    expect((await request(app).get(`/projects/${id}/codebase-index/files`)).status).toBe(401);
    expect((await request(app).get(`/projects/${id}/codebase-index/files/${id}/symbols`)).status).toBe(401);
    expect((await request(app).post(`/projects/${id}/codebase-index/reindex`)).status).toBe(401);
  });

  it("returns 404 for a project owned by someone else", async () => {
    const ownerCookie = await registerAndGetCookie("ci-owner@example.com");
    const intruderCookie = await registerAndGetCookie("ci-intruder@example.com");
    const projectId = await createProject(ownerCookie);

    const res = await request(app)
      .post(`/projects/${projectId}/codebase-index/start`)
      .set("Cookie", intruderCookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("POST /projects/:projectId/codebase-index/start — no connection / not configured", () => {
  it("returns 400 NO_REPOSITORY_CONNECTED when nothing is connected", async () => {
    const cookie = await registerAndGetCookie("ci-noconn@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_REPOSITORY_CONNECTED");
  });

  it("returns 503 GITHUB_INTEGRATION_NOT_CONFIGURED when unset, without calling fetch", async () => {
    const cookie = await registerAndGetCookie("ci-notconfigured@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    env.GITHUB_TOKEN_ENCRYPTION_KEY = undefined; // this environment's real, confirmed state
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("GITHUB_INTEGRATION_NOT_CONFIGURED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("persists a failed row with the real error when resolving the branch commit fails", async () => {
    const cookie = await registerAndGetCookie("ci-commitfail@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    mockFetchResponses([{ status: 401, body: { message: "Bad credentials" } }]);
    const startRes = await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
    expect(startRes.status).toBe(401);
    expect(startRes.body.error.code).toBe("GITHUB_INVALID_CREDENTIALS");

    const getRes = await request(app).get(`/projects/${projectId}/codebase-index`).set("Cookie", cookie);
    expect(getRes.body.data.index.status).toBe("failed");
    expect(getRes.body.data.index.error).toContain("invalid or expired");
    expect(getRes.body.data.index.fileCount).toBe(0);
  });
});

describe("POST /projects/:projectId/codebase-index/start — happy path", () => {
  it("indexes supported files, skips others with real reasons, and extracts symbols", async () => {
    const cookie = await registerAndGetCookie("ci-happy@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    const tsSource = "export function add(a, b) {\n  return a + b;\n}\n";
    mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-abc123" } } },
      {
        status: 200,
        body: {
          tree: [
            { path: "README.md", type: "blob", sha: "sha-readme", size: 10 },
            { path: "node_modules/pkg/index.js", type: "blob", sha: "sha-nm", size: 20 },
            { path: "src/app.ts", type: "blob", sha: "sha-app", size: tsSource.length },
          ],
          truncated: false,
        },
      },
      // Only src/app.ts is fetched+parsed: README.md is unsupported (no
      // extension match) and node_modules/... is filtered before it ever
      // reaches the candidate list — neither consumes a blob/parse call.
      { status: 200, body: { content: base64(tsSource), encoding: "base64" } },
      {
        status: 200,
        body: {
          language: "typescript",
          status: "parsed",
          symbols: [
            { name: "add", type: "function", start_line: 1, end_line: 3, parent_index: null, signature: "(a, b)" },
          ],
          error: null,
        },
      },
    ]);

    const startRes = await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
    expect(startRes.status).toBe(200);
    const index = startRes.body.data.index;
    expect(index.status).toBe("completed");
    expect(index.branch).toBe("master");
    expect(index.commitSha).toBe("commit-abc123");
    expect(index.fileCount).toBe(2); // README.md + src/app.ts — node_modules/... is never a candidate.
    expect(index.parsedFileCount).toBe(1);
    expect(index.failedFileCount).toBe(0);
    expect(index.truncated).toBe(false);

    const filesRes = await request(app).get(`/projects/${projectId}/codebase-index/files`).set("Cookie", cookie);
    expect(filesRes.status).toBe(200);
    const files = filesRes.body.data.files as { path: string; parseStatus: string; language: string | null; id: string }[];
    expect(files.map((f) => f.path)).toEqual(["README.md", "src/app.ts"]);
    expect(files.find((f) => f.path === "node_modules/pkg/index.js")).toBeUndefined();

    const readme = files.find((f) => f.path === "README.md")!;
    expect(readme.parseStatus).toBe("unsupported");
    expect(readme.language).toBeNull();

    const appFile = files.find((f) => f.path === "src/app.ts")!;
    expect(appFile.parseStatus).toBe("parsed");
    expect(appFile.language).toBe("typescript");

    const symbolsRes = await request(app)
      .get(`/projects/${projectId}/codebase-index/files/${appFile.id}/symbols`)
      .set("Cookie", cookie);
    expect(symbolsRes.status).toBe(200);
    expect(symbolsRes.body.data.symbols).toEqual([
      expect.objectContaining({ name: "add", type: "function", startLine: 1, endLine: 3, parentId: null }),
    ]);
  });

  it("records a parse_error file without symbols and counts it as failed", async () => {
    const cookie = await registerAndGetCookie("ci-parseerror@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-1" } } },
      { status: 200, body: { tree: [{ path: "bad.js", type: "blob", sha: "sha-bad", size: 5 }], truncated: false } },
      { status: 200, body: { content: base64("function foo( {"), encoding: "base64" } },
      { status: 200, body: { language: "javascript", status: "parse_error", symbols: [], error: "Syntax error." } },
    ]);

    const res = await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.index.parsedFileCount).toBe(0);
    expect(res.body.data.index.failedFileCount).toBe(1);

    const filesRes = await request(app).get(`/projects/${projectId}/codebase-index/files`).set("Cookie", cookie);
    const file = filesRes.body.data.files[0];
    expect(file.parseStatus).toBe("parse_error");
    expect(file.parseError).toBe("Syntax error.");
  });

  it("skips an oversized file without fetching its content", async () => {
    const cookie = await registerAndGetCookie("ci-toolarge@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    const fetchSpy = mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-1" } } },
      {
        status: 200,
        body: {
          tree: [{ path: "huge.ts", type: "blob", sha: "sha-huge", size: MAX_FILE_SIZE_BYTES + 1 }],
          truncated: false,
        },
      },
    ]);

    const res = await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.index.fileCount).toBe(1);
    // Only getBranchCommit + getTree — no blob fetch for the oversized file.
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const filesRes = await request(app).get(`/projects/${projectId}/codebase-index/files`).set("Cookie", cookie);
    expect(filesRes.body.data.files[0].parseStatus).toBe("skipped_too_large");
  });

  it("skips a binary-extension file without fetching its content", async () => {
    const cookie = await registerAndGetCookie("ci-binary@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    const fetchSpy = mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-1" } } },
      { status: 200, body: { tree: [{ path: "logo.png", type: "blob", sha: "sha-logo", size: 500 }], truncated: false } },
    ]);

    const res = await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const filesRes = await request(app).get(`/projects/${projectId}/codebase-index/files`).set("Cookie", cookie);
    expect(filesRes.body.data.files[0].parseStatus).toBe("skipped_binary");
  });
});

describe("determinism: start reuses an unchanged completed index; reindex always re-runs", () => {
  async function indexOnce(cookie: string[], projectId: string) {
    mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-same" } } },
      { status: 200, body: { tree: [], truncated: false } },
    ]);
    const res = await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.index.status).toBe("completed");
  }

  it("start short-circuits to the existing index when the commit is unchanged", async () => {
    const cookie = await registerAndGetCookie("ci-shortcircuit@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);
    await indexOnce(cookie, projectId);

    // Only getBranchCommit this time — no getTree, since the commit matches
    // the already-completed index and start() must not force a rebuild.
    const fetchSpy = mockFetchResponses([{ status: 200, body: { commit: { sha: "commit-same" } } }]);
    const res = await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reindex always re-runs the pipeline even when the commit is unchanged", async () => {
    const cookie = await registerAndGetCookie("ci-forcereindex@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);
    await indexOnce(cookie, projectId);

    const fetchSpy = mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-same" } } },
      { status: 200, body: { tree: [], truncated: false } },
    ]);
    const res = await request(app).post(`/projects/${projectId}/codebase-index/reindex`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    // getBranchCommit + getTree — reindex does not short-circuit.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("incremental indexing (Phase 14, Milestone 14.4)", () => {
  const tsSource = "export function add(a, b) {\n  return a + b;\n}\n";
  const symbolsResponse = {
    status: 200,
    body: {
      language: "typescript",
      status: "parsed",
      symbols: [{ name: "add", type: "function", start_line: 1, end_line: 3, parent_index: null, signature: "(a, b)" }],
      error: null,
    },
  };

  it("reindex skips re-fetching and re-parsing a file whose content hash is unchanged, reusing its symbols", async () => {
    const cookie = await registerAndGetCookie("ci-incr-unchanged@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-1" } } },
      { status: 200, body: { tree: [{ path: "src/app.ts", type: "blob", sha: "sha-app-v1", size: tsSource.length }], truncated: false } },
      { status: 200, body: { content: base64(tsSource), encoding: "base64" } },
      symbolsResponse,
    ]);
    const firstRes = await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
    expect(firstRes.body.data.index.parsedFileCount).toBe(1);

    // Reindex with the exact same blob sha for src/app.ts — only
    // getBranchCommit + getTree should fire; no getBlob, no parse call.
    const fetchSpy = mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-2" } } },
      { status: 200, body: { tree: [{ path: "src/app.ts", type: "blob", sha: "sha-app-v1", size: tsSource.length }], truncated: false } },
    ]);
    const reindexRes = await request(app).post(`/projects/${projectId}/codebase-index/reindex`).set("Cookie", cookie);
    expect(reindexRes.status).toBe(200);
    expect(reindexRes.body.data.index.parsedFileCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Symbols were reused, not lost or duplicated.
    const filesRes = await request(app).get(`/projects/${projectId}/codebase-index/files`).set("Cookie", cookie);
    const appFile = filesRes.body.data.files.find((f: { path: string }) => f.path === "src/app.ts");
    expect(appFile.parseStatus).toBe("parsed");
    const symbolsRes = await request(app)
      .get(`/projects/${projectId}/codebase-index/files/${appFile.id}/symbols`)
      .set("Cookie", cookie);
    expect(symbolsRes.body.data.symbols).toEqual([
      expect.objectContaining({ name: "add", type: "function", startLine: 1, endLine: 3 }),
    ]);
  });

  it("reindex re-fetches and re-parses a file whose content hash changed", async () => {
    const cookie = await registerAndGetCookie("ci-incr-changed@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-1" } } },
      { status: 200, body: { tree: [{ path: "src/app.ts", type: "blob", sha: "sha-app-v1", size: tsSource.length }], truncated: false } },
      { status: 200, body: { content: base64(tsSource), encoding: "base64" } },
      symbolsResponse,
    ]);
    await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);

    const newSource = "export function add(a, b) {\n  return a + b;\n}\nexport function sub(a, b) {\n  return a - b;\n}\n";
    const fetchSpy = mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-2" } } },
      { status: 200, body: { tree: [{ path: "src/app.ts", type: "blob", sha: "sha-app-v2", size: newSource.length }], truncated: false } },
      { status: 200, body: { content: base64(newSource), encoding: "base64" } },
      {
        status: 200,
        body: {
          language: "typescript",
          status: "parsed",
          symbols: [
            { name: "add", type: "function", start_line: 1, end_line: 3, parent_index: null, signature: "(a, b)" },
            { name: "sub", type: "function", start_line: 4, end_line: 6, parent_index: null, signature: "(a, b)" },
          ],
          error: null,
        },
      },
    ]);
    const reindexRes = await request(app).post(`/projects/${projectId}/codebase-index/reindex`).set("Cookie", cookie);
    expect(reindexRes.status).toBe(200);
    // getBranchCommit + getTree + getBlob + parse — a changed hash is
    // never cache-skipped.
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    const filesRes = await request(app).get(`/projects/${projectId}/codebase-index/files`).set("Cookie", cookie);
    const appFile = filesRes.body.data.files.find((f: { path: string }) => f.path === "src/app.ts");
    const symbolsRes = await request(app)
      .get(`/projects/${projectId}/codebase-index/files/${appFile.id}/symbols`)
      .set("Cookie", cookie);
    expect(symbolsRes.body.data.symbols).toHaveLength(2);
  });

  it("reindex always retries a file that previously failed to parse, even with an unchanged content hash", async () => {
    const cookie = await registerAndGetCookie("ci-incr-retry@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-1" } } },
      { status: 200, body: { tree: [{ path: "bad.js", type: "blob", sha: "sha-bad", size: 5 }], truncated: false } },
      { status: 200, body: { content: base64("function foo( {"), encoding: "base64" } },
      { status: 200, body: { language: "javascript", status: "parse_error", symbols: [], error: "Syntax error." } },
    ]);
    const firstRes = await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
    expect(firstRes.body.data.index.failedFileCount).toBe(1);

    // Same content hash again, but this time it parses successfully (e.g.
    // a parser fix shipped) — the file must be retried, not silently
    // reused with its stale parse_error status forever.
    const fetchSpy = mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-2" } } },
      { status: 200, body: { tree: [{ path: "bad.js", type: "blob", sha: "sha-bad", size: 5 }], truncated: false } },
      { status: 200, body: { content: base64("function foo( {"), encoding: "base64" } },
      symbolsResponse,
    ]);
    const reindexRes = await request(app).post(`/projects/${projectId}/codebase-index/reindex`).set("Cookie", cookie);
    expect(reindexRes.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(reindexRes.body.data.index.failedFileCount).toBe(0);
    expect(reindexRes.body.data.index.parsedFileCount).toBe(1);
  });

  it("reindex leaves no stale symbols for a file that no longer exists in the tree", async () => {
    const cookie = await registerAndGetCookie("ci-incr-deleted@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-1" } } },
      { status: 200, body: { tree: [{ path: "src/app.ts", type: "blob", sha: "sha-app-v1", size: tsSource.length }], truncated: false } },
      { status: 200, body: { content: base64(tsSource), encoding: "base64" } },
      symbolsResponse,
    ]);
    await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);

    // src/app.ts is removed from the tree entirely on reindex.
    mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-2" } } },
      { status: 200, body: { tree: [], truncated: false } },
    ]);
    const reindexRes = await request(app).post(`/projects/${projectId}/codebase-index/reindex`).set("Cookie", cookie);
    expect(reindexRes.status).toBe(200);
    expect(reindexRes.body.data.index.fileCount).toBe(0);

    const filesRes = await request(app).get(`/projects/${projectId}/codebase-index/files`).set("Cookie", cookie);
    expect(filesRes.body.data.files).toEqual([]);
    // No orphaned Symbol rows left behind in the database either.
    const remainingSymbols = await prisma.symbol.count();
    expect(remainingSymbols).toBe(0);
  });

  it("reindexing the same unchanged commit twice in a row is idempotent (no duplicate files or symbols)", async () => {
    const cookie = await registerAndGetCookie("ci-incr-idempotent@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    for (let i = 0; i < 2; i++) {
      mockFetchResponses([
        { status: 200, body: { commit: { sha: "commit-same" } } },
        { status: 200, body: { tree: [{ path: "src/app.ts", type: "blob", sha: "sha-app-v1", size: tsSource.length }], truncated: false } },
        { status: 200, body: { content: base64(tsSource), encoding: "base64" } },
        symbolsResponse,
      ]);
      const res = await request(app).post(`/projects/${projectId}/codebase-index/reindex`).set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.index.fileCount).toBe(1);
    }

    const filesRes = await request(app).get(`/projects/${projectId}/codebase-index/files`).set("Cookie", cookie);
    expect(filesRes.body.data.files).toHaveLength(1);
    const symbolCount = await prisma.symbol.count();
    expect(symbolCount).toBe(1);
  });
});

describe("GET /projects/:projectId/codebase-index", () => {
  it("returns index: null before any indexing has been attempted", async () => {
    const cookie = await registerAndGetCookie("ci-getnull@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).get(`/projects/${projectId}/codebase-index`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.index).toBeNull();
  });
});

describe("GET /projects/:projectId/codebase-index/files and .../files/:fileId/symbols", () => {
  it("returns 404 CODEBASE_INDEX_NOT_FOUND before any indexing has been attempted", async () => {
    const cookie = await registerAndGetCookie("ci-filesnone@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).get(`/projects/${projectId}/codebase-index/files`).set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CODEBASE_INDEX_NOT_FOUND");
  });

  it("returns 404 for a file id that doesn't belong to this project's index", async () => {
    const cookie = await registerAndGetCookie("ci-filenotfound@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);
    mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-1" } } },
      { status: 200, body: { tree: [], truncated: false } },
    ]);
    await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);

    const res = await request(app)
      .get(`/projects/${projectId}/codebase-index/files/00000000-0000-0000-0000-000000000000/symbols`)
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});
