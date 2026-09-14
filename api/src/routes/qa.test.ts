import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../env.js";

const app = createApp();

async function cleanDb() {
  await prisma.answerSource.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.question.deleteMany();
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

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

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

async function createProject(cookie: string[], name = "QA Test Project") {
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

/** Every outbound fetch() call (GitHub, ai-service parsing/embeddings/qa)
 * goes through the same global fetch, consumed strictly in the real call
 * order — same pattern as routes/codebaseIndex.test.ts and
 * routes/retrieval.test.ts. */
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

function qaAnswerBody(overrides: Record<string, unknown> = {}) {
  return {
    content: {
      answer: "The add function is defined in src/app.ts.",
      cited_source_numbers: [1],
      insufficient_evidence: false,
      ...overrides,
    },
  };
}

/** Connects a repository and completes indexing for one small TS file with
 * one symbol — the fixture every Q&A test builds on. */
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
  await request(app).post(`/projects/${projectId}/codebase-index/start`).set("Cookie", cookie);
}

describe("auth and ownership", () => {
  it("returns 401 without a session on all three endpoints", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    expect((await request(app).post(`/projects/${id}/qa`).send({ question: "x" })).status).toBe(401);
    expect((await request(app).get(`/projects/${id}/qa`)).status).toBe(401);
    expect((await request(app).get(`/projects/${id}/qa/${id}`)).status).toBe(401);
  });

  it("returns 404 for a project owned by someone else on all three endpoints", async () => {
    const ownerCookie = await registerAndGetCookie("qa-owner@example.com");
    const intruderCookie = await registerAndGetCookie("qa-intruder@example.com");
    const projectId = await createProject(ownerCookie);
    const fakeQuestionId = "00000000-0000-0000-0000-000000000000";

    const askRes = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", intruderCookie)
      .send({ question: "Where is X?" });
    expect(askRes.status).toBe(404);
    expect(askRes.body.error.code).toBe("NOT_FOUND");

    const listRes = await request(app).get(`/projects/${projectId}/qa`).set("Cookie", intruderCookie);
    expect(listRes.status).toBe(404);

    const getRes = await request(app)
      .get(`/projects/${projectId}/qa/${fakeQuestionId}`)
      .set("Cookie", intruderCookie);
    expect(getRes.status).toBe(404);
  });
});

describe("validation", () => {
  it("returns 400 for a blank question", async () => {
    const cookie = await registerAndGetCookie("qa-blank@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).post(`/projects/${projectId}/qa`).set("Cookie", cookie).send({ question: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for a missing question field", async () => {
    const cookie = await registerAndGetCookie("qa-missing@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).post(`/projects/${projectId}/qa`).set("Cookie", cookie).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for a question over the length limit", async () => {
    const cookie = await registerAndGetCookie("qa-toolong@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", cookie)
      .send({ question: "x".repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for a non-string question", async () => {
    const cookie = await registerAndGetCookie("qa-wrongtype@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).post(`/projects/${projectId}/qa`).set("Cookie", cookie).send({ question: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("prerequisites — no provider call when they fail", () => {
  it("returns 400 NO_COMPLETED_INDEX with no repository connected, without calling fetch", async () => {
    const cookie = await registerAndGetCookie("qa-noindex@example.com");
    const projectId = await createProject(cookie);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", cookie)
      .send({ question: "Where is authentication implemented?" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_COMPLETED_INDEX");
    expect(fetchSpy).not.toHaveBeenCalled();

    const listRes = await request(app).get(`/projects/${projectId}/qa`).set("Cookie", cookie);
    expect(listRes.body.data.questions).toEqual([]);
  });

  it("returns 503 GITHUB_INTEGRATION_NOT_CONFIGURED when unset, without calling fetch", async () => {
    const cookie = await registerAndGetCookie("qa-notconfigured@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    env.GITHUB_TOKEN_ENCRYPTION_KEY = undefined;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", cookie)
      .send({ question: "Where is authentication implemented?" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("GITHUB_INTEGRATION_NOT_CONFIGURED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("retrieval-before-provider ordering", () => {
  it("never reaches the Q&A provider when retrieval itself fails, and persists no question", async () => {
    const cookie = await registerAndGetCookie("qa-retrievalfails@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    // A real-shaped GitHub 401 during the chunk-building blob refetch —
    // the Q&A provider (also effectively "unconfigured" in this suite,
    // since no fetch response for /qa/answer is queued) is never reached;
    // if it had been, a different, distinguishable error would surface.
    mockFetchResponses([{ status: 401, body: { message: "Bad credentials" } }]);
    const res = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", cookie)
      .send({ question: "Where is authentication implemented?" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("GITHUB_INVALID_CREDENTIALS");

    const listRes = await request(app).get(`/projects/${projectId}/qa`).set("Cookie", cookie);
    expect(listRes.body.data.questions).toEqual([]);
  });
});

describe("successful Q&A", () => {
  it("retrieves, answers, and persists evidence with correct branch/commit", async () => {
    const cookie = await registerAndGetCookie("qa-happy@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } }, // buildChunksForIndex's getBlob
      { status: 200, body: embedBody([[1, 0, 0, 0]]) }, // ensureEmbeddings
      { status: 200, body: embedBody([[1, 0, 0, 0]]) }, // query embedding
      { status: 200, body: qaAnswerBody() }, // /qa/answer
    ]);

    const res = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", cookie)
      .send({ question: "Where is add() defined?" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      question: "Where is add() defined?",
      answer: "The add function is defined in src/app.ts.",
      insufficientEvidence: false,
      branch: "master",
      commit: "commit-abc123",
    });
    expect(res.body.data.sources).toHaveLength(1);
    expect(res.body.data.sources[0]).toMatchObject({
      filePath: "src/app.ts",
      symbolName: "add",
      startLine: 1,
      endLine: 3,
      cited: true,
    });

    // Evidence is actually persisted, inspectable via GET.
    const questionId = res.body.data.questionId as string;
    const getRes = await request(app).get(`/projects/${projectId}/qa/${questionId}`).set("Cookie", cookie);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.answer).toBe("The add function is defined in src/app.ts.");
    expect(getRes.body.data.sources[0].cited).toBe(true);

    const listRes = await request(app).get(`/projects/${projectId}/qa`).set("Cookie", cookie);
    expect(listRes.body.data.questions).toHaveLength(1);
    expect(listRes.body.data.questions[0].questionId).toBe(questionId);
  });

  it("only marks sources the model actually cited, not every source sent", async () => {
    const cookie = await registerAndGetCookie("qa-partialcite@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: qaAnswerBody({ cited_source_numbers: [] }) },
    ]);

    const res = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", cookie)
      .send({ question: "Where is add() defined?" });
    expect(res.status).toBe(200);
    expect(res.body.data.sources[0].cited).toBe(false);
  });
});

describe("empty retrieval result", () => {
  it("returns an insufficient-evidence answer without ever calling the Q&A provider", async () => {
    const cookie = await registerAndGetCookie("qa-emptyretrieval@example.com");
    const projectId = await createProject(cookie);

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

    // No files to chunk; only the query itself gets embedded — /qa/answer
    // must never be called.
    const fetchSpy = mockFetchResponses([{ status: 200, body: embedBody([[1, 0, 0, 0]]) }]);
    const res = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", cookie)
      .send({ question: "anything" });

    expect(res.status).toBe(200);
    expect(res.body.data.insufficientEvidence).toBe(true);
    expect(res.body.data.sources).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("provider configuration and failure", () => {
  it("returns 503 AI_PROVIDER_UNAVAILABLE when ANTHROPIC_API_KEY is not configured", async () => {
    const cookie = await registerAndGetCookie("qa-noanthropic@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      {
        status: 503,
        body: { error: { code: "PROVIDER_NOT_CONFIGURED", message: "No LLM provider is configured." } },
      },
    ]);

    const res = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", cookie)
      .send({ question: "Where is add() defined?" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_PROVIDER_UNAVAILABLE");
  });

  it("returns 503 EMBEDDING_PROVIDER_UNAVAILABLE when VOYAGE_API_KEY is not configured", async () => {
    const cookie = await registerAndGetCookie("qa-novoyage@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      {
        status: 503,
        body: { error: { code: "PROVIDER_NOT_CONFIGURED", message: "No embedding provider is configured." } },
      },
    ]);

    const res = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", cookie)
      .send({ question: "Where is add() defined?" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("EMBEDDING_PROVIDER_UNAVAILABLE");
  });

  it("returns 502 AI_PROVIDER_ERROR on a genuine Q&A provider failure", async () => {
    const cookie = await registerAndGetCookie("qa-providerfail@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 502, body: { error: { code: "AI_PROVIDER_ERROR", message: "The AI provider rate-limited this request." } } },
    ]);

    const res = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", cookie)
      .send({ question: "Where is add() defined?" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_SERVICE_ERROR");
  });

  it("returns 502 AI_RESPONSE_INVALID for a malformed provider response", async () => {
    const cookie = await registerAndGetCookie("qa-malformed@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: { content: { answer: "", cited_source_numbers: "not-an-array", insufficient_evidence: false } } },
    ]);

    const res = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", cookie)
      .send({ question: "Where is add() defined?" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_RESPONSE_INVALID");
  });
});

describe("no secret leakage", () => {
  it("never includes the raw GitHub token anywhere in a Q&A response", async () => {
    const cookie = await registerAndGetCookie("qa-nosecrets@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: qaAnswerBody() },
    ]);

    const res = await request(app)
      .post(`/projects/${projectId}/qa`)
      .set("Cookie", cookie)
      .send({ question: "Where is add() defined?" });
    expect(JSON.stringify(res.body)).not.toContain("ghp_faketoken1234567890");
  });
});

describe("project isolation", () => {
  it("never returns another project's chunks as sources", async () => {
    const cookieA = await registerAndGetCookie("qa-isolation-a@example.com");
    const projectA = await createProject(cookieA, "Project A");
    await connectAndIndex(cookieA, projectA);
    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: qaAnswerBody() },
    ]);
    const resA = await request(app)
      .post(`/projects/${projectA}/qa`)
      .set("Cookie", cookieA)
      .send({ question: "Where is add() defined?" });
    const questionIdA = resA.body.data.questionId as string;

    const cookieB = await registerAndGetCookie("qa-isolation-b@example.com");
    const projectB = await createProject(cookieB, "Project B");

    // Project B's owner cannot fetch Project A's question, even scoped
    // through a project they do own.
    const crossRes = await request(app)
      .get(`/projects/${projectB}/qa/${questionIdA}`)
      .set("Cookie", cookieB);
    expect(crossRes.status).toBe(404);

    // Nor can they reach it through Project A directly (they don't own it).
    const directRes = await request(app)
      .get(`/projects/${projectA}/qa/${questionIdA}`)
      .set("Cookie", cookieB);
    expect(directRes.status).toBe(404);
  });
});
