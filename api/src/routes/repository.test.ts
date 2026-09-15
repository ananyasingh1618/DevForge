import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../env.js";

const app = createApp();

async function cleanDb() {
  await prisma.session.deleteMany();
  await prisma.repositoryConnection.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

// This file exercises the *configured* behavior (business logic behind the
// config gate) using a fake, never-real key set directly on the real `env`
// object — githubTokenCrypto.ts reads env.GITHUB_TOKEN_ENCRYPTION_KEY at
// call time, so mutating it here is safe and doesn't touch real env vars.
// The one test that needs the *unconfigured* path (this environment's real
// state) temporarily clears it and restores it afterward.
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

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

async function createProject(cookie: string[], name = "GitHub Test Project") {
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
const GITHUB_BRANCHES_BODY = [
  { name: "master", protected: true },
  { name: "develop", protected: false },
];

/** Mocks the outbound fetch() calls githubClient.ts makes to the real
 * GitHub API — a test double for the HTTP boundary only, mirroring
 * routes/architecture.test.ts's mockAiServiceFetch. Responses are consumed
 * in order (getAuthenticatedUser then getRepository for connect/verify;
 * listBranches for branches/update-branch). */
function mockGithubResponses(
  responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>,
) {
  let callIndex = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => {
      const r = (responses[callIndex] ?? responses[responses.length - 1])!;
      callIndex++;
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: { get: (name: string) => r.headers?.[name] ?? null },
        json: async () => r.body,
      };
    }),
  );
}

async function connectRepository(cookie: string[], projectId: string) {
  mockGithubResponses([
    { status: 200, body: GITHUB_USER_BODY },
    { status: 200, body: GITHUB_REPO_BODY },
  ]);
  const res = await request(app)
    .post(`/projects/${projectId}/repository/connect`)
    .set("Cookie", cookie)
    .send({ token: "ghp_faketoken1234567890", owner: "octocat", repo: "Hello-World" });
  return res.body.data.connection;
}

describe("POST /projects/:projectId/repository/connect", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).post(
      "/projects/00000000-0000-0000-0000-000000000000/repository/connect",
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for a project owned by someone else", async () => {
    const ownerCookie = await registerAndGetCookie("repo-owner@example.com");
    const intruderCookie = await registerAndGetCookie("repo-intruder@example.com");
    const projectId = await createProject(ownerCookie);

    mockGithubResponses([{ status: 200, body: GITHUB_USER_BODY }]);
    const res = await request(app)
      .post(`/projects/${projectId}/repository/connect`)
      .set("Cookie", intruderCookie)
      .send({ token: "ghp_faketoken1234567890", owner: "octocat", repo: "Hello-World" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for a malformed owner name, without calling fetch", async () => {
    const cookie = await registerAndGetCookie("repo-badowner@example.com");
    const projectId = await createProject(cookie);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .post(`/projects/${projectId}/repository/connect`)
      .set("Cookie", cookie)
      .send({ token: "ghp_faketoken1234567890", owner: "-bad-", repo: "Hello-World" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 400 for a repo name of exactly '..' — a GitHub-path-confusion defense added in Milestone 16.4", async () => {
    const cookie = await registerAndGetCookie("repo-dotdot@example.com");
    const projectId = await createProject(cookie);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .post(`/projects/${projectId}/repository/connect`)
      .set("Cookie", cookie)
      .send({ token: "ghp_faketoken1234567890", owner: "octocat", repo: ".." });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 400 for a repo name of exactly '.'", async () => {
    const cookie = await registerAndGetCookie("repo-dot@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app)
      .post(`/projects/${projectId}/repository/connect`)
      .set("Cookie", cookie)
      .send({ token: "ghp_faketoken1234567890", owner: "octocat", repo: "." });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a token that's too short", async () => {
    const cookie = await registerAndGetCookie("repo-shorttoken@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app)
      .post(`/projects/${projectId}/repository/connect`)
      .set("Cookie", cookie)
      .send({ token: "x", owner: "octocat", repo: "Hello-World" });
    expect(res.status).toBe(400);
  });

  it("returns 503 GITHUB_INTEGRATION_NOT_CONFIGURED when the encryption key is unset, without calling fetch", async () => {
    const cookie = await registerAndGetCookie("repo-noconfig@example.com");
    const projectId = await createProject(cookie);
    env.GITHUB_TOKEN_ENCRYPTION_KEY = undefined; // this environment's real, confirmed state
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .post(`/projects/${projectId}/repository/connect`)
      .set("Cookie", cookie)
      .send({ token: "ghp_faketoken1234567890", owner: "octocat", repo: "Hello-World" });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("GITHUB_INTEGRATION_NOT_CONFIGURED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("connects successfully and returns a sanitized connection (never the token)", async () => {
    const cookie = await registerAndGetCookie("repo-connect@example.com");
    const projectId = await createProject(cookie);

    const connection = await connectRepository(cookie, projectId);

    expect(connection.githubOwner).toBe("octocat");
    expect(connection.githubRepo).toBe("Hello-World");
    expect(connection.githubAccountLogin).toBe("octocat");
    expect(connection.repositoryUrl).toBe("https://github.com/octocat/Hello-World");
    expect(connection.selectedBranch).toBe("master");
    expect(connection.status).toBe("verified");
    expect(connection.tokenLast4).toBe("7890");
    expect(connection.encryptedToken).toBeUndefined();
    expect(JSON.stringify(connection)).not.toContain("ghp_faketoken1234567890");
  });

  it("maps a real-shaped GitHub 401 to GITHUB_INVALID_CREDENTIALS and persists nothing", async () => {
    const cookie = await registerAndGetCookie("repo-invalidtoken@example.com");
    const projectId = await createProject(cookie);
    mockGithubResponses([{ status: 401, body: { message: "Bad credentials" } }]);

    const res = await request(app)
      .post(`/projects/${projectId}/repository/connect`)
      .set("Cookie", cookie)
      .send({ token: "ghp_faketoken1234567890", owner: "octocat", repo: "Hello-World" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("GITHUB_INVALID_CREDENTIALS");

    const getRes = await request(app)
      .get(`/projects/${projectId}/repository`)
      .set("Cookie", cookie);
    expect(getRes.body.data.connection).toBeNull();
  });
});

describe("GET /projects/:projectId/repository", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).get("/projects/00000000-0000-0000-0000-000000000000/repository");
    expect(res.status).toBe(401);
  });

  it("returns 404 for a project owned by someone else", async () => {
    const ownerCookie = await registerAndGetCookie("repo-get-owner@example.com");
    const intruderCookie = await registerAndGetCookie("repo-get-intruder@example.com");
    const projectId = await createProject(ownerCookie);
    const res = await request(app)
      .get(`/projects/${projectId}/repository`)
      .set("Cookie", intruderCookie);
    expect(res.status).toBe(404);
  });

  it("returns 200 with connection: null when nothing is connected", async () => {
    const cookie = await registerAndGetCookie("repo-get-empty@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).get(`/projects/${projectId}/repository`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.connection).toBeNull();
  });
});

describe("POST /projects/:projectId/repository/verify", () => {
  it("returns 404 when nothing is connected", async () => {
    const cookie = await registerAndGetCookie("repo-verify-none@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app)
      .post(`/projects/${projectId}/repository/verify`)
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("re-verifies successfully and refreshes lastVerifiedAt", async () => {
    const cookie = await registerAndGetCookie("repo-verify-ok@example.com");
    const projectId = await createProject(cookie);
    const first = await connectRepository(cookie, projectId);

    mockGithubResponses([
      { status: 200, body: GITHUB_USER_BODY },
      { status: 200, body: GITHUB_REPO_BODY },
    ]);
    const res = await request(app)
      .post(`/projects/${projectId}/repository/verify`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.connection.status).toBe("verified");
    expect(new Date(res.body.data.connection.lastVerifiedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.lastVerifiedAt).getTime(),
    );
  });

  it("persists status: error and lastError on failure, while still returning the real error", async () => {
    const cookie = await registerAndGetCookie("repo-verify-fail@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    mockGithubResponses([{ status: 401, body: { message: "Bad credentials" } }]);
    const verifyRes = await request(app)
      .post(`/projects/${projectId}/repository/verify`)
      .set("Cookie", cookie);
    expect(verifyRes.status).toBe(401);
    expect(verifyRes.body.error.code).toBe("GITHUB_INVALID_CREDENTIALS");

    const getRes = await request(app).get(`/projects/${projectId}/repository`).set("Cookie", cookie);
    expect(getRes.body.data.connection.status).toBe("error");
    expect(getRes.body.data.connection.lastError).toContain("invalid or expired");
  });
});

describe("GET /projects/:projectId/repository/branches", () => {
  it("returns 404 when nothing is connected", async () => {
    const cookie = await registerAndGetCookie("repo-branches-none@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app)
      .get(`/projects/${projectId}/repository/branches`)
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("returns the live branch list when connected", async () => {
    const cookie = await registerAndGetCookie("repo-branches-ok@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    mockGithubResponses([{ status: 200, body: GITHUB_BRANCHES_BODY }]);
    const res = await request(app)
      .get(`/projects/${projectId}/repository/branches`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.branches).toEqual([
      { name: "master", protected: true },
      { name: "develop", protected: false },
    ]);
  });
});

describe("PATCH /projects/:projectId/repository", () => {
  it("returns 404 when nothing is connected", async () => {
    const cookie = await registerAndGetCookie("repo-branch-update-none@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app)
      .patch(`/projects/${projectId}/repository`)
      .set("Cookie", cookie)
      .send({ branch: "develop" });
    expect(res.status).toBe(404);
  });

  it("updates the selected branch when it exists in the live branch list", async () => {
    const cookie = await registerAndGetCookie("repo-branch-update-ok@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    mockGithubResponses([{ status: 200, body: GITHUB_BRANCHES_BODY }]);
    const res = await request(app)
      .patch(`/projects/${projectId}/repository`)
      .set("Cookie", cookie)
      .send({ branch: "develop" });

    expect(res.status).toBe(200);
    expect(res.body.data.connection.selectedBranch).toBe("develop");
  });

  it("returns 400 GITHUB_INVALID_BRANCH when the branch doesn't exist in the live list", async () => {
    const cookie = await registerAndGetCookie("repo-branch-invalid@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    mockGithubResponses([{ status: 200, body: GITHUB_BRANCHES_BODY }]);
    const res = await request(app)
      .patch(`/projects/${projectId}/repository`)
      .set("Cookie", cookie)
      .send({ branch: "does-not-exist" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("GITHUB_INVALID_BRANCH");
  });

  it("returns 400 when the branch field is missing", async () => {
    const cookie = await registerAndGetCookie("repo-branch-missing@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);
    const res = await request(app)
      .patch(`/projects/${projectId}/repository`)
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for a branch name containing '..' — schema-level defense in depth added in Milestone 16.4", async () => {
    const cookie = await registerAndGetCookie("repo-branch-dotdot@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);
    const res = await request(app)
      .patch(`/projects/${projectId}/repository`)
      .set("Cookie", cookie)
      .send({ branch: "feature/../../escape" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for a branch name containing a control character", async () => {
    const cookie = await registerAndGetCookie("repo-branch-control@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);
    const res = await request(app)
      .patch(`/projects/${projectId}/repository`)
      .set("Cookie", cookie)
      .send({ branch: "main\x00evil" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("DELETE /projects/:projectId/repository", () => {
  it("returns 404 when nothing is connected", async () => {
    const cookie = await registerAndGetCookie("repo-disconnect-none@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).delete(`/projects/${projectId}/repository`).set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("disconnects and removes the connection", async () => {
    const cookie = await registerAndGetCookie("repo-disconnect-ok@example.com");
    const projectId = await createProject(cookie);
    await connectRepository(cookie, projectId);

    const deleteRes = await request(app)
      .delete(`/projects/${projectId}/repository`)
      .set("Cookie", cookie);
    expect(deleteRes.status).toBe(204);

    const getRes = await request(app).get(`/projects/${projectId}/repository`).set("Cookie", cookie);
    expect(getRes.body.data.connection).toBeNull();
  });

  it("returns 404 for a project owned by someone else", async () => {
    const ownerCookie = await registerAndGetCookie("repo-disconnect-owner@example.com");
    const intruderCookie = await registerAndGetCookie("repo-disconnect-intruder@example.com");
    const projectId = await createProject(ownerCookie);
    await connectRepository(ownerCookie, projectId);

    const res = await request(app)
      .delete(`/projects/${projectId}/repository`)
      .set("Cookie", intruderCookie);
    expect(res.status).toBe(404);

    // Confirm the owner's connection is untouched.
    const getRes = await request(app)
      .get(`/projects/${projectId}/repository`)
      .set("Cookie", ownerCookie);
    expect(getRes.body.data.connection).not.toBeNull();
  });
});
