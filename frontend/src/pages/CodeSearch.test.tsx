import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CodeSearch } from "./CodeSearch.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";
import * as projectsApi from "../services/projectsApi.js";
import * as repositoryApi from "../services/repositoryApi.js";
import * as codebaseIndexApi from "../services/codebaseIndexApi.js";
import * as retrievalApi from "../services/retrievalApi.js";
import type { Project } from "../types/project.js";
import type { CodebaseIndex } from "../types/codebaseIndex.js";
import type { SearchResult } from "../types/retrieval.js";

vi.mock("../services/authApi.js");
vi.mock("../services/projectsApi.js");
vi.mock("../services/repositoryApi.js");
vi.mock("../services/codebaseIndexApi.js");
vi.mock("../services/retrievalApi.js");

const mockedAuthApi = vi.mocked(authApi);
const mockedProjectsApi = vi.mocked(projectsApi);
const mockedRepositoryApi = vi.mocked(repositoryApi);
const mockedCodebaseIndexApi = vi.mocked(codebaseIndexApi);
const mockedRetrievalApi = vi.mocked(retrievalApi);

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuthApi.meRequest.mockResolvedValue({
    user: { id: "u1", email: "dev@example.com", name: null, createdAt: new Date().toISOString() },
  });
});

const PROJECT: Project = {
  id: "p1",
  ownerId: "u1",
  name: "Demo Project",
  description: null,
  status: "active",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeIndex(overrides: Partial<CodebaseIndex> = {}): CodebaseIndex {
  return {
    id: "idx1",
    projectId: "p1",
    repositoryConnectionId: "conn1",
    branch: "master",
    commitSha: "abc123",
    status: "completed",
    truncated: false,
    fileCount: 1,
    parsedFileCount: 1,
    failedFileCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkId: "chunk1",
    filePath: "src/app.ts",
    symbolName: "add",
    symbolType: "function",
    content: "function add(a, b) {\n  return a + b;\n}",
    startLine: 1,
    endLine: 3,
    language: "typescript",
    branch: "master",
    commitSha: "abc123",
    score: 0.87,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/p1/search"]}>
      <AuthProvider>
        <Routes>
          <Route path="/projects/:id/search" element={<CodeSearch />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("CodeSearch — no repository state", () => {
  it("shows a gate explaining a repository connection is required", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: null });
    renderPage();

    expect(await screen.findByText("No repository connected")).toBeInTheDocument();
    expect(mockedCodebaseIndexApi.getCodebaseIndexRequest).not.toHaveBeenCalled();
  });
});

describe("CodeSearch — no index state", () => {
  it("shows a gate explaining indexing is required, linking to the Indexing page", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({
      connection: {
        id: "conn1",
        projectId: "p1",
        githubOwner: "octocat",
        githubRepo: "Hello-World",
        githubRepoId: "1",
        githubAccountLogin: "octocat",
        repositoryUrl: "https://github.com/octocat/Hello-World",
        defaultBranch: "master",
        selectedBranch: "master",
        status: "verified",
        lastVerifiedAt: null,
        lastError: null,
        tokenLast4: "0000",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
    renderPage();

    expect(await screen.findByText("Codebase not indexed yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to indexing" })).toHaveAttribute(
      "href",
      "/projects/p1/indexing",
    );
  });
});

describe("CodeSearch — ready state", () => {
  function mockReady() {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({
      connection: {
        id: "conn1",
        projectId: "p1",
        githubOwner: "octocat",
        githubRepo: "Hello-World",
        githubRepoId: "1",
        githubAccountLogin: "octocat",
        repositoryUrl: "https://github.com/octocat/Hello-World",
        defaultBranch: "master",
        selectedBranch: "master",
        status: "verified",
        lastVerifiedAt: null,
        lastError: null,
        tokenLast4: "0000",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: makeIndex() });
  }

  it("shows the search form", async () => {
    mockReady();
    renderPage();
    expect(await screen.findByLabelText("Search query")).toBeInTheDocument();
    expect(screen.getByLabelText("Branch (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Commit (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Result limit")).toBeInTheDocument();
  });

  it("submits the query, branch, commit, and limit fields", async () => {
    mockReady();
    mockedRetrievalApi.searchRequest.mockResolvedValue({ results: [] });
    renderPage();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Search query"), "how do we validate a session");
    await user.type(screen.getByLabelText("Branch (optional)"), "develop");
    await user.type(screen.getByLabelText("Commit (optional)"), "deadbeef");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(mockedRetrievalApi.searchRequest).toHaveBeenCalledWith("p1", {
      query: "how do we validate a session",
      branch: "develop",
      commit: "deadbeef",
      limit: 10,
    });
  });

  it("shows results with file, symbol, location, and score", async () => {
    mockReady();
    mockedRetrievalApi.searchRequest.mockResolvedValue({ results: [makeResult()] });
    renderPage();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Search query"), "add two numbers");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("function add")).toBeInTheDocument();
    expect(screen.getByText("L1–3")).toBeInTheDocument();
    expect(screen.getByText("0.870")).toBeInTheDocument();
    expect(screen.getByText(/function add\(a, b\)/)).toBeInTheDocument();
  });

  it("shows a real empty state, not nothing, for a genuinely empty result set", async () => {
    mockReady();
    mockedRetrievalApi.searchRequest.mockResolvedValue({ results: [] });
    renderPage();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Search query"), "something obscure");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("No matching code found")).toBeInTheDocument();
  });

  it("shows the real error and never fabricates results on failure", async () => {
    mockReady();
    mockedRetrievalApi.searchRequest.mockRejectedValue(
      new ApiError(400, "INDEX_COMMIT_MISMATCH", "The current index is for branch \"master\" at commit \"abc123\"."),
    );
    renderPage();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Search query"), "add two numbers");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText('The current index is for branch "master" at commit "abc123".'),
    ).toBeInTheDocument();
    expect(screen.queryByText("No matching code found")).not.toBeInTheDocument();
  });
});
