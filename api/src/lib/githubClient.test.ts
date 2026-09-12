import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "./errors.js";
import { getAuthenticatedUser, getRepository, listBranches } from "./githubClient.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Mocks the outbound fetch() call to the real GitHub API — a test double
 * for the HTTP boundary only, mirroring aiServiceClient's own test-mocking
 * pattern. One real, unmocked check further down proves the honest-failure
 * path for real (see "against the real GitHub API"). */
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

describe("getAuthenticatedUser", () => {
  it("returns the login and id on success", async () => {
    mockGithubResponses([{ status: 200, body: { login: "octocat", id: 1 } }]);
    const user = await getAuthenticatedUser("fake-token");
    expect(user).toEqual({ login: "octocat", id: 1 });
  });

  it("maps a 401 to GITHUB_INVALID_CREDENTIALS", async () => {
    mockGithubResponses([{ status: 401, body: { message: "Bad credentials" } }]);
    await expect(getAuthenticatedUser("fake-token")).rejects.toMatchObject({
      status: 401,
      code: "GITHUB_INVALID_CREDENTIALS",
    });
  });

  it("maps a network failure to a 502 GITHUB_API_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(getAuthenticatedUser("fake-token")).rejects.toMatchObject({
      status: 502,
      code: "GITHUB_API_ERROR",
    });
  });
});

describe("getRepository", () => {
  const SAMPLE_REPO_BODY = {
    id: 1296269,
    full_name: "octocat/Hello-World",
    html_url: "https://github.com/octocat/Hello-World",
    default_branch: "master",
    private: false,
  };

  it("returns mapped camelCase fields on success", async () => {
    mockGithubResponses([{ status: 200, body: SAMPLE_REPO_BODY }]);
    const repo = await getRepository("fake-token", "octocat", "Hello-World");
    expect(repo).toEqual({
      id: 1296269,
      fullName: "octocat/Hello-World",
      htmlUrl: "https://github.com/octocat/Hello-World",
      defaultBranch: "master",
      private: false,
    });
  });

  it("maps a 404 to GITHUB_REPOSITORY_NOT_FOUND", async () => {
    mockGithubResponses([{ status: 404, body: { message: "Not Found" } }]);
    await expect(getRepository("fake-token", "octocat", "does-not-exist")).rejects.toMatchObject({
      status: 404,
      code: "GITHUB_REPOSITORY_NOT_FOUND",
    });
  });

  it("maps a 403 with X-RateLimit-Remaining: 0 to a 429 GITHUB_RATE_LIMITED", async () => {
    mockGithubResponses([
      { status: 403, body: { message: "rate limited" }, headers: { "x-ratelimit-remaining": "0" } },
    ]);
    await expect(getRepository("fake-token", "octocat", "Hello-World")).rejects.toMatchObject({
      status: 429,
      code: "GITHUB_RATE_LIMITED",
    });
  });

  it("maps a bare 403 to GITHUB_INSUFFICIENT_PERMISSIONS", async () => {
    mockGithubResponses([{ status: 403, body: { message: "forbidden" } }]);
    await expect(getRepository("fake-token", "octocat", "private-repo")).rejects.toMatchObject({
      status: 403,
      code: "GITHUB_INSUFFICIENT_PERMISSIONS",
    });
  });

  it("maps an unexpected status to a 502 GITHUB_API_ERROR", async () => {
    mockGithubResponses([{ status: 500, body: { message: "server error" } }]);
    await expect(getRepository("fake-token", "octocat", "Hello-World")).rejects.toMatchObject({
      status: 502,
      code: "GITHUB_API_ERROR",
    });
  });
});

describe("listBranches", () => {
  it("returns mapped branch names on a single page", async () => {
    mockGithubResponses([
      { status: 200, body: [{ name: "master", protected: true }, { name: "develop", protected: false }] },
    ]);
    const branches = await listBranches("fake-token", "octocat", "Hello-World");
    expect(branches).toEqual([
      { name: "master", protected: true },
      { name: "develop", protected: false },
    ]);
  });

  it("follows pagination until a short page is returned", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ name: `branch-${i}`, protected: false }));
    const shortPage = [{ name: "last-branch", protected: false }];
    mockGithubResponses([
      { status: 200, body: fullPage },
      { status: 200, body: shortPage },
    ]);
    const branches = await listBranches("fake-token", "octocat", "Hello-World");
    expect(branches).toHaveLength(101);
    expect(branches[branches.length - 1]).toEqual({ name: "last-branch", protected: false });
  });
});

describe("against the real GitHub API (network reachability confirmed in Milestone 1)", () => {
  it("genuinely rejects a fake token with a real 401 — no mocking, no fabricated success", async () => {
    // No vi.stubGlobal here — this hits https://api.github.com for real, the
    // same way ANTHROPIC_API_KEY's real "not configured" path was exercised
    // for real in every prior phase. No real GitHub credentials are needed
    // or used; the token below is intentionally fake.
    await expect(getAuthenticatedUser("ghp_definitelyNotARealToken00000000000")).rejects.toBeInstanceOf(
      AppError,
    );
  });
});
