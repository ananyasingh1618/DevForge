import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../env.js";

const app = createApp();

async function cleanDb() {
  await prisma.codeReviewFindingSource.deleteMany();
  await prisma.codeReviewFinding.deleteMany();
  await prisma.codeReviewSource.deleteMany();
  await prisma.codeReview.deleteMany();
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

async function createProject(cookie: string[], name = "Review Test Project") {
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

/** Every outbound fetch() call (GitHub, ai-service parsing/embeddings/review)
 * goes through the same global fetch, consumed strictly in the real call
 * order — same pattern as routes/qa.test.ts. */
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

function reviewAnswerBody(overrides: Record<string, unknown> = {}) {
  return {
    content: {
      summary: "One finding related to input validation.",
      findings: [
        {
          title: "Missing input validation",
          description: "add() does not validate that its arguments are numbers.",
          severity: "medium",
          category: "validation",
          confidence: "medium",
          recommendation: "Validate argument types before performing arithmetic.",
          cited_source_numbers: [1],
        },
      ],
      ...overrides,
    },
  };
}

/** Connects a repository and completes indexing for one small TS file with
 * one symbol — the fixture every review test builds on. */
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
    expect((await request(app).post(`/projects/${id}/reviews`).send({})).status).toBe(401);
    expect((await request(app).get(`/projects/${id}/reviews`)).status).toBe(401);
    expect((await request(app).get(`/projects/${id}/reviews/${id}`)).status).toBe(401);
  });

  it("returns 404 for a project owned by someone else on all three endpoints", async () => {
    const ownerCookie = await registerAndGetCookie("review-owner@example.com");
    const intruderCookie = await registerAndGetCookie("review-intruder@example.com");
    const projectId = await createProject(ownerCookie);
    const fakeReviewId = "00000000-0000-0000-0000-000000000000";

    const createRes = await request(app)
      .post(`/projects/${projectId}/reviews`)
      .set("Cookie", intruderCookie)
      .send({});
    expect(createRes.status).toBe(404);
    expect(createRes.body.error.code).toBe("NOT_FOUND");

    const listRes = await request(app).get(`/projects/${projectId}/reviews`).set("Cookie", intruderCookie);
    expect(listRes.status).toBe(404);

    const getRes = await request(app)
      .get(`/projects/${projectId}/reviews/${fakeReviewId}`)
      .set("Cookie", intruderCookie);
    expect(getRes.status).toBe(404);
  });
});

describe("validation", () => {
  it("returns 400 for a blank (whitespace-only) scope", async () => {
    const cookie = await registerAndGetCookie("review-blank@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({ scope: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for a scope over the length limit", async () => {
    const cookie = await registerAndGetCookie("review-toolong@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app)
      .post(`/projects/${projectId}/reviews`)
      .set("Cookie", cookie)
      .send({ scope: "x".repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for a non-string scope", async () => {
    const cookie = await registerAndGetCookie("review-wrongtype@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({ scope: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("prerequisites — no provider call when they fail", () => {
  it("returns 400 NO_COMPLETED_INDEX with no repository connected, without calling fetch", async () => {
    const cookie = await registerAndGetCookie("review-noindex@example.com");
    const projectId = await createProject(cookie);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_COMPLETED_INDEX");
    expect(fetchSpy).not.toHaveBeenCalled();

    const listRes = await request(app).get(`/projects/${projectId}/reviews`).set("Cookie", cookie);
    expect(listRes.body.data.reviews).toEqual([]);
  });

  it("returns 503 GITHUB_INTEGRATION_NOT_CONFIGURED when unset, without calling fetch", async () => {
    const cookie = await registerAndGetCookie("review-notconfigured@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    env.GITHUB_TOKEN_ENCRYPTION_KEY = undefined;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("GITHUB_INTEGRATION_NOT_CONFIGURED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("retrieval-before-provider ordering", () => {
  it("never reaches the review provider when retrieval itself fails, and persists no review", async () => {
    const cookie = await registerAndGetCookie("review-retrievalfails@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    // A real-shaped GitHub 401 during the chunk-building blob refetch — the
    // review provider (also effectively "unconfigured" in this suite,
    // since no fetch response for /review/analyze is queued) is never
    // reached; if it had been, a different, distinguishable error would
    // surface.
    mockFetchResponses([{ status: 401, body: { message: "Bad credentials" } }]);
    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("GITHUB_INVALID_CREDENTIALS");

    const listRes = await request(app).get(`/projects/${projectId}/reviews`).set("Cookie", cookie);
    expect(listRes.body.data.reviews).toEqual([]);
  });
});

describe("successful review", () => {
  it("retrieves, reviews, and persists findings with correct branch/commit and trusted source metadata", async () => {
    const cookie = await registerAndGetCookie("review-happy@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } }, // buildChunksForIndex's getBlob
      { status: 200, body: embedBody([[1, 0, 0, 0]]) }, // ensureEmbeddings
      { status: 200, body: embedBody([[1, 0, 0, 0]]) }, // query embedding
      { status: 200, body: reviewAnswerBody() }, // /review/analyze
    ]);

    const res = await request(app)
      .post(`/projects/${projectId}/reviews`)
      .set("Cookie", cookie)
      .send({ scope: "Review add() for validation issues." });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      scope: "Review add() for validation issues.",
      status: "completed",
      summary: "One finding related to input validation.",
      findingCount: 1,
      branch: "master",
      commit: "commit-abc123",
    });
    expect(res.body.data.findings).toHaveLength(1);
    expect(res.body.data.findings[0]).toMatchObject({
      title: "Missing input validation",
      severity: "medium",
      category: "validation",
      confidence: "medium",
    });
    // Trusted metadata comes from Node's own retrieval records, never the model.
    expect(res.body.data.findings[0].sources).toEqual([
      { filePath: "src/app.ts", symbolName: "add", startLine: 1, endLine: 3, score: expect.any(Number) },
    ]);

    // Evidence is actually persisted, inspectable via GET.
    const reviewId = res.body.data.reviewId as string;
    const getRes = await request(app).get(`/projects/${projectId}/reviews/${reviewId}`).set("Cookie", cookie);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.findings).toHaveLength(1);

    const listRes = await request(app).get(`/projects/${projectId}/reviews`).set("Cookie", cookie);
    expect(listRes.body.data.reviews).toHaveLength(1);
    expect(listRes.body.data.reviews[0].reviewId).toBe(reviewId);
  });

  it("uses a fixed default scope when none is supplied", async () => {
    const cookie = await registerAndGetCookie("review-defaultscope@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: reviewAnswerBody() },
    ]);

    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});
    expect(res.status).toBe(201);
    expect(res.body.data.scope).toMatch(/general code review/i);
  });

  it("drops a finding left with no valid citations after filtering, never persisting a fabricated finding", async () => {
    const cookie = await registerAndGetCookie("review-fabricated@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      {
        status: 200,
        body: reviewAnswerBody({
          findings: [
            {
              title: "fabricated finding",
              description: "d",
              severity: "high",
              category: "security",
              confidence: "high",
              recommendation: "r",
              cited_source_numbers: [42, 99], // out of range for a 1-source request
            },
          ],
        }),
      },
    ]);

    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});
    expect(res.status).toBe(201);
    expect(res.body.data.findings).toEqual([]);
    expect(res.body.data.findingCount).toBe(0);
  });

  it("persists multiple distinct findings that legitimately cite the same real source", async () => {
    const cookie = await registerAndGetCookie("review-shared-source@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      {
        status: 200,
        body: reviewAnswerBody({
          summary: "Two independent issues in the same function.",
          findings: [
            {
              title: "Security concern",
              description: "d1",
              severity: "high",
              category: "security",
              confidence: "high",
              recommendation: "r1",
              cited_source_numbers: [1],
            },
            {
              title: "Reliability concern",
              description: "d2",
              severity: "medium",
              category: "reliability",
              confidence: "medium",
              recommendation: "r2",
              cited_source_numbers: [1],
            },
          ],
        }),
      },
    ]);

    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});
    expect(res.status).toBe(201);
    expect(res.body.data.findingCount).toBe(2);
    const titles = res.body.data.findings.map((f: { title: string }) => f.title);
    expect(titles).toEqual(["Security concern", "Reliability concern"]);
    for (const finding of res.body.data.findings) {
      expect(finding.sources).toEqual([expect.objectContaining({ filePath: "src/app.ts" })]);
    }
  });
});

describe("empty retrieval result", () => {
  it("returns a completed review with zero findings without ever calling the review provider", async () => {
    const cookie = await registerAndGetCookie("review-emptyretrieval@example.com");
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

    // No files to chunk; only the query itself gets embedded — /review/analyze
    // must never be called.
    const fetchSpy = mockFetchResponses([{ status: 200, body: embedBody([[1, 0, 0, 0]]) }]);
    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("completed");
    expect(res.body.data.findingCount).toBe(0);
    expect(res.body.data.findings).toEqual([]);
    expect(res.body.data.sources).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("provider configuration and failure", () => {
  it("returns 503 AI_PROVIDER_UNAVAILABLE when ANTHROPIC_API_KEY is not configured", async () => {
    const cookie = await registerAndGetCookie("review-noanthropic@example.com");
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

    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_PROVIDER_UNAVAILABLE");
  });

  it("returns 503 EMBEDDING_PROVIDER_UNAVAILABLE when VOYAGE_API_KEY is not configured", async () => {
    const cookie = await registerAndGetCookie("review-novoyage@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      {
        status: 503,
        body: { error: { code: "PROVIDER_NOT_CONFIGURED", message: "No embedding provider is configured." } },
      },
    ]);

    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("EMBEDDING_PROVIDER_UNAVAILABLE");
  });

  it("returns 502 AI_SERVICE_ERROR on a genuine review provider failure, and persists the review as failed", async () => {
    const cookie = await registerAndGetCookie("review-providerfail@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 502, body: { error: { code: "AI_PROVIDER_ERROR", message: "The AI provider rate-limited this request." } } },
    ]);

    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_SERVICE_ERROR");

    // Deliberate improvement over Q&A's equivalent failure window (see
    // docs/CODE_REVIEW_PHASE_PLAN.md): the review row persisted before the
    // provider call is updated to a real "failed" status, not left
    // orphaned or silently dropped.
    const listRes = await request(app).get(`/projects/${projectId}/reviews`).set("Cookie", cookie);
    expect(listRes.body.data.reviews).toHaveLength(1);
    expect(listRes.body.data.reviews[0].status).toBe("failed");
  });

  it("returns 502 AI_RESPONSE_INVALID for a malformed provider response", async () => {
    const cookie = await registerAndGetCookie("review-malformed@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: { content: { summary: "", findings: "not-an-array" } } },
    ]);

    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_RESPONSE_INVALID");
  });

  it("returns 502 AI_RESPONSE_INVALID for a finding with an invalid severity value", async () => {
    const cookie = await registerAndGetCookie("review-badseverity@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      {
        status: 200,
        body: reviewAnswerBody({
          findings: [
            {
              title: "t",
              description: "d",
              severity: "catastrophic",
              category: "security",
              confidence: "high",
              recommendation: "r",
              cited_source_numbers: [1],
            },
          ],
        }),
      },
    ]);

    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_RESPONSE_INVALID");
  });
});

describe("no secret leakage", () => {
  it("never includes the raw GitHub token anywhere in a review response", async () => {
    const cookie = await registerAndGetCookie("review-nosecrets@example.com");
    const projectId = await createProject(cookie);
    await connectAndIndex(cookie, projectId);

    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: reviewAnswerBody() },
    ]);

    const res = await request(app).post(`/projects/${projectId}/reviews`).set("Cookie", cookie).send({});
    expect(JSON.stringify(res.body)).not.toContain("ghp_faketoken1234567890");
  });
});

describe("project isolation", () => {
  it("never returns another project's review history", async () => {
    const cookieA = await registerAndGetCookie("review-isolation-a@example.com");
    const projectA = await createProject(cookieA, "Project A");
    await connectAndIndex(cookieA, projectA);
    mockFetchResponses([
      { status: 200, body: { content: base64(TS_SOURCE), encoding: "base64" } },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: embedBody([[1, 0, 0, 0]]) },
      { status: 200, body: reviewAnswerBody() },
    ]);
    const resA = await request(app).post(`/projects/${projectA}/reviews`).set("Cookie", cookieA).send({});
    const reviewIdA = resA.body.data.reviewId as string;

    const cookieB = await registerAndGetCookie("review-isolation-b@example.com");
    const projectB = await createProject(cookieB, "Project B");

    // Project B's owner cannot fetch Project A's review, even scoped
    // through a project they do own.
    const crossRes = await request(app)
      .get(`/projects/${projectB}/reviews/${reviewIdA}`)
      .set("Cookie", cookieB);
    expect(crossRes.status).toBe(404);

    // Nor can they reach it through Project A directly (they don't own it).
    const directRes = await request(app)
      .get(`/projects/${projectA}/reviews/${reviewIdA}`)
      .set("Cookie", cookieB);
    expect(directRes.status).toBe(404);
  });
});
