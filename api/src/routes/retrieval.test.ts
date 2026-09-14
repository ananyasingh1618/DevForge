import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../env.js";

const app = createApp();

async function cleanDb() {
  await prisma.embedding.deleteMany();
  await prisma.codeChunk.deleteMany();
  await prisma.symbol.deleteMany();
  await prisma.indexedFile.deleteMany();
  await prisma.codebaseIndex.deleteMany();
  await prisma.session.deleteMany();
  await prisma.repositoryConnection.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");

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
  const res = await request(app).post("/auth/register").send({ email, password: "correct-horse-battery" });
  return getSetCookie(res);
}

async function createProject(cookie: string[], name = "Retrieval Test Project") {
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

const TS_SOURCE = "export function add(a, b) {\n  return a + b;\n}\n";

/** Same pattern as routes/codebaseIndex.test.ts's mockFetchResponses,
 * extended to also cover the embedding endpoint — every outbound fetch()
 * call (GitHub, ai-service parsing, ai-service embeddings) goes through the
 * same global fetch, consumed strictly in the real call order. */
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

function embedBody(vectors: number[][]) {
  return { model: "voyage-code-3", dimensions: 4, embeddings: vectors };
}

/** Connects a repository and completes indexing for one small TS file with
 * one symbol — the fixture every search test builds on. Returns the
 * project id and the commit sha the index landed on. */
async function connectAndIndex(cookie: string[], projectId: string) {
  mockFetchResponses([
    { status: 200, body: GITHUB_USER_BODY },
    { status: 200, body: GITHUB_REPO_BODY },
  ]);
  await request(app)
    .post(`/projects/${projectId}/repository/connect`)
    .set("Cookie", cookie)
    .send({ token: "ghp_faketoken1234567890", owner: "octocat", repo: "Hello-World" });

  mockFetchResponses([
    { status: 200, body: { commit: { sha: "commit-abc123" } } },
    {
      status: 200,
      body: { tree: [{ path: "src/app.ts", type: "blob", sha: "sha-app", size: TS_SOURCE.length }], truncated: false },
    },
    { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
    {
      status: 200,
      body: {
        language: "typescript",
        status: "parsed",
        symbols: [{ name: "add", type: "function", start_line: 1, end_line: 3, parent_index: null, signature: "(a, b)" }],
        error: null,
      },
    },
  ]);
  const startRes = await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
  return { commitSha: startRes.body.data.index.commitSha as string };
}

describe("auth and ownership", () => {
  it("returns 401 without a session", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const res = await request(app).post(`/projects/${id}/search`).send({ query: "add two numbers" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for a project owned by someone else", async () => {
    const ownerCookie = await registerAndGetCookie("search-owner@example.com");
    const intruderCookie = await registerAndGetCookie("search-intruder@example.com");
    const projectId = await createProject(ownerCookie);

    const res = await request(app)
      .post(`/projects/${projectId}/search`)
      .set("Cookie", intruderCookie)
      .send({ query: "add two numbers" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("validation", () => {
  it("returns 400 for an empty query", async () => {
    const cookie = await registerAndGetCookie("search-empty@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).post(`/projects/${projectId}/search`).set("Cookie", cookie).send({ query: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for a limit above 50", async () => {
    const cookie = await registerAndGetCookie("search-limit@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app)
      .post(`/projects/${projectId}/search`)
      .set("Cookie", cookie)
      .send({ query: "add two numbers", limit: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("no completed index", () => {
  it("returns 400 NO_COMPLETED_INDEX when nothing is connected", async () => {
    const cookie = await registerAndGetCookie("search-noindex@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app)
      .post(`/projects/${projectId}/search`)
      .set("Cookie", cookie)
      .send({ query: "add two numbers" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_COMPLETED_INDEX");
  });
});

describe("branch/commit mismatch", () => {
  it("returns 400 INDEX_COMMIT_MISMATCH for a branch that doesn't match the current index", async () => {
    const cookie = await registerAndGetCookie("search-mismatch@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    const res = await request(app)
      .post(`/projects/${projectId}/search`)
      .set("Cookie", cookie)
      .send({ query: "add two numbers", branch: "develop" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INDEX_COMMIT_MISMATCH");
    expect(res.body.error.message).toContain("master");
  });

  it("returns 400 INDEX_COMMIT_MISMATCH for a commit that doesn't match the current index", async () => {
    const cookie = await registerAndGetCookie("search-commitmismatch@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    const res = await request(app)
      .post(`/projects/${projectId}/search`)
      .set("Cookie", cookie)
      .send({ query: "add two numbers", commit: "0000000000000000000000000000000000" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INDEX_COMMIT_MISMATCH");
  });
});

describe("GitHub integration not configured", () => {
  it("returns 503 when the encryption key is unset, without calling fetch", async () => {
    const cookie = await registerAndGetCookie("search-notconfigured@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    env.GITHUB_TOKEN_ENCRYPTION_KEY = undefined;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .post(`/projects/${projectId}/search`)
      .set("Cookie", cookie)
      .send({ query: "add two numbers" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("GITHUB_INTEGRATION_NOT_CONFIGURED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("happy path", () => {
  it("builds chunks and embeddings lazily, then returns ranked results", async () => {
    const cookie = await registerAndGetCookie("search-happy@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } }, // buildChunksForIndex's getBlob
      { status: 200, body: embedBody([[1, 0, 0, 0]]) }, // ensureEmbeddings — one chunk
      { status: 200, body: embedBody([[1, 0, 0, 0]]) }, // query embedding — identical vector
    ]);

    const res = await request(app)
      .post(`/projects/${projectId}/search`)
      .set("Cookie", cookie)
      .send({ query: "add two numbers" });

    expect(res.status).toBe(200);
    const results = res.body.data.results;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      filePath: "src/app.ts",
      symbolName: "add",
      symbolType: "function",
      startLine: 1,
      endLine: 3,
      language: "typescript",
      branch: "master",
    });
    expect(results[0].score).toBeCloseTo(1, 5);

    // Persisted for reuse.
    const chunkCount = await prisma.codeChunk.count({ where: { projectId } });
    const embeddingCount = await prisma.embedding.count();
    expect(chunkCount).toBe(1);
    expect(embeddingCount).toBe(1);
  });

  it("reuses persisted chunks/embeddings on a second search — no re-fetch, no re-embed", async () => {
    const cookie = await registerAndGetCookie("search-reuse@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
    ]);
    const firstRes = await request(app)
      .post(`/projects/${projectId}/search`)
      .set("Cookie", cookie)
      .send({ query: "add two numbers" });
    expect(firstRes.status).toBe(200);

    // Second search: only the query needs embedding — no getBlob, no
    // re-embedding the already-embedded chunk.
    const fetchSpy = mockFetchResponses([{ status: 200, body: embedBody([[1, 0, 0, 0]]) }]);
    const secondRes = await request(app)
      .post(`/projects/${projectId}/search`)
      .set("Cookie", cookie)
      .send({ query: "add two numbers" });
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.data.results).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array, not an error, when nothing is relevant enough to exist", async () => {
    const cookie = await registerAndGetCookie("search-emptyresults@example.com");
    const projectId = await createProject(cookie);
    // Index with zero files at all (empty tree) -> completed index, but no
    // parsed files to chunk.
    mockFetchResponses([
      { status: 200, body: GITHUB_USER_BODY },
      { status: 200, body: GITHUB_REPO_BODY },
    ]);
    await request(app)
      .post(`/projects/${projectId}/repository/connect`)
      .set("Cookie", cookie)
      .send({ token: "ghp_faketoken1234567890", owner: "octocat", repo: "Hello-World" });
    mockFetchResponses([
      { status: 200, body: { commit: { sha: "commit-empty" } } },
      { status: 200, body: { tree: [], truncated: false } },
    ]);
    await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);

    // No files to chunk, so buildChunksForIndex makes no GitHub calls and
    // ensureEmbeddings has nothing to embed — but the query itself is
    // always embedded, even against an empty index.
    mockFetchResponses([{ status: 200, body: embedBody([[1, 0, 0, 0]]) }]);
    const res = await request(app)
      .post(`/projects/${projectId}/search`)
      .set("Cookie", cookie)
      .send({ query: "anything" });
    expect(res.status).toBe(200);
    expect(res.body.data.results).toEqual([]);
  });

  it("returns 503 EMBEDDING_PROVIDER_UNAVAILABLE when the embedding provider isn't configured", async () => {
    const cookie = await registerAndGetCookie("search-noembed@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } }, // getBlob succeeds
      {
        status: 503,
        body: { error: { code: "PROVIDER_NOT_CONFIGURED", message: "No embedding provider is configured." } },
      },
    ]);

    const res = await request(app)
      .post(`/projects/${projectId}/search`)
      .set("Cookie", cookie)
      .send({ query: "add two numbers" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("EMBEDDING_PROVIDER_UNAVAILABLE");
  });
});

describe("project isolation", () => {
  it("never returns another project's chunks", async () => {
    const cookieA = await registerAndGetCookie("search-isolation-a@example.com");
    const projectA = await createProject(cookieA, "Project A");
    await connectAndIndex(cookieA, projectA);
    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
    ]);
    const resA = await request(app)
      .post(`/projects/${projectA}/search`)
      .set("Cookie", cookieA)
      .send({ query: "add two numbers" });
    const chunkIdA = resA.body.data.results[0].chunkId as string;

    const cookieB = await registerAndGetCookie("search-isolation-b@example.com");
    const projectB = await createProject(cookieB, "Project B");
    await connectAndIndex(cookieB, projectB);
    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
    ]);
    const resB = await request(app)
      .post(`/projects/${projectB}/search`)
      .set("Cookie", cookieB)
      .send({ query: "add two numbers" });
    const chunkIdB = resB.body.data.results[0].chunkId as string;

    expect(chunkIdA).not.toBe(chunkIdB);

    // Project B's owner can never search project A's data, even by trying
    // (ownership-checked 404 well before any chunk is ever considered).
    const crossRes = await request(app)
      .post(`/projects/${projectA}/search`)
      .set("Cookie", cookieB)
      .send({ query: "add two numbers" });
    expect(crossRes.status).toBe(404);
  });
});
