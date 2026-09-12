import { AppError } from "./errors.js";

const GITHUB_API_URL = "https://api.github.com";
const API_VERSION = "2022-11-28";

export type GithubUser = { login: string; id: number };

export type GithubRepository = {
  id: number;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
};

export type GithubBranch = { name: string; protected: boolean };

/**
 * Throws AppError directly (not a separate typed-exception layer, unlike
 * ai-service's providers) — this call happens directly inside the Node API,
 * not across an HTTP boundary into a different service whose error shape
 * needs translating, so there is no second mapping step to justify.
 */
function errorForResponse(res: Response, context: string): AppError {
  if (res.status === 401) {
    return new AppError(401, "GITHUB_INVALID_CREDENTIALS", "The GitHub token is invalid or expired.");
  }
  if (res.status === 404) {
    return new AppError(404, "GITHUB_REPOSITORY_NOT_FOUND", `${context}: repository not found.`);
  }
  if (res.status === 403) {
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      return new AppError(
        429,
        "GITHUB_RATE_LIMITED",
        "GitHub API rate limit exceeded. Try again later.",
      );
    }
    return new AppError(
      403,
      "GITHUB_INSUFFICIENT_PERMISSIONS",
      "The GitHub token does not have permission to access this repository.",
    );
  }
  return new AppError(502, "GITHUB_API_ERROR", `${context}: GitHub returned an unexpected ${res.status} response.`);
}

async function githubFetch(path: string, token: string): Promise<Response> {
  try {
    return await fetch(`${GITHUB_API_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "DevForge",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError(502, "GITHUB_API_ERROR", "Could not reach GitHub. Try again later.");
  }
}

export async function getAuthenticatedUser(token: string): Promise<GithubUser> {
  const res = await githubFetch("/user", token);
  if (!res.ok) {
    throw errorForResponse(res, "Authenticating with GitHub");
  }
  const body = (await res.json()) as { login: string; id: number };
  return { login: body.login, id: body.id };
}

export async function getRepository(
  token: string,
  owner: string,
  repo: string,
): Promise<GithubRepository> {
  const res = await githubFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token);
  if (!res.ok) {
    throw errorForResponse(res, `Fetching ${owner}/${repo}`);
  }
  const body = (await res.json()) as {
    id: number;
    full_name: string;
    html_url: string;
    default_branch: string;
    private: boolean;
  };
  return {
    id: body.id,
    fullName: body.full_name,
    htmlUrl: body.html_url,
    defaultBranch: body.default_branch,
    private: body.private,
  };
}

const MAX_BRANCH_PAGES = 10;
const BRANCHES_PER_PAGE = 100;

export async function listBranches(
  token: string,
  owner: string,
  repo: string,
): Promise<GithubBranch[]> {
  const branches: GithubBranch[] = [];
  for (let page = 1; page <= MAX_BRANCH_PAGES; page++) {
    const res = await githubFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=${BRANCHES_PER_PAGE}&page=${page}`,
      token,
    );
    if (!res.ok) {
      throw errorForResponse(res, `Listing branches for ${owner}/${repo}`);
    }
    const body = (await res.json()) as { name: string; protected: boolean }[];
    branches.push(...body.map((b) => ({ name: b.name, protected: b.protected })));
    if (body.length < BRANCHES_PER_PAGE) break;
  }
  return branches;
}
