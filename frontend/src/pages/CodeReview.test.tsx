import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CodeReview } from "./CodeReview.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";
import * as projectsApi from "../services/projectsApi.js";
import * as repositoryApi from "../services/repositoryApi.js";
import * as codebaseIndexApi from "../services/codebaseIndexApi.js";
import * as codeReviewApi from "../services/codeReviewApi.js";
import type { Project } from "../types/project.js";
import type { CodebaseIndex } from "../types/codebaseIndex.js";
import type { RepositoryConnection } from "../types/repository.js";
import type { CodeReview as CodeReviewType } from "../types/codeReview.js";

vi.mock("../services/authApi.js");
vi.mock("../services/projectsApi.js");
vi.mock("../services/repositoryApi.js");
vi.mock("../services/codebaseIndexApi.js");
vi.mock("../services/codeReviewApi.js");

const mockedAuthApi = vi.mocked(authApi);
const mockedProjectsApi = vi.mocked(projectsApi);
const mockedRepositoryApi = vi.mocked(repositoryApi);
const mockedCodebaseIndexApi = vi.mocked(codebaseIndexApi);
const mockedCodeReviewApi = vi.mocked(codeReviewApi);

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

function makeConnection(): RepositoryConnection {
  return {
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
  };
}

function makeIndex(overrides: Partial<CodebaseIndex> = {}): CodebaseIndex {
  return {
    id: "idx1",
    projectId: "p1",
    repositoryConnectionId: "conn1",
    branch: "master",
    commitSha: "abc123def456",
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

function makeReview(overrides: Partial<CodeReviewType> = {}): CodeReviewType {
  return {
    reviewId: "r1",
    scope: "Review add() for validation issues.",
    status: "completed",
    summary: "One finding related to input validation.",
    findingCount: 1,
    findings: [
      {
        id: "f1",
        title: "Missing input validation",
        description: "add() does not validate that its arguments are numbers.",
        severity: "medium",
        category: "validation",
        confidence: "medium",
        recommendation: "Validate argument types before performing arithmetic.",
        actionable: true,
        sources: [{ filePath: "src/app.ts", symbolName: "add", startLine: 1, endLine: 3, score: 0.91 }],
      },
    ],
    sources: [{ filePath: "src/app.ts", symbolName: "add", startLine: 1, endLine: 3, score: 0.91 }],
    branch: "master",
    commit: "abc123def456",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/p1/reviews"]}>
      <AuthProvider>
        <Routes>
          <Route path="/projects/:id/reviews" element={<CodeReview />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function mockReady() {
  mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
  mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
  mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: makeIndex() });
}

describe("CodeReview — blocked states", () => {
  it("shows a gate when no repository is connected, never calling the index or review endpoints", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: null });
    renderPage();

    expect(await screen.findByText("No repository connected")).toBeInTheDocument();
    expect(mockedCodebaseIndexApi.getCodebaseIndexRequest).not.toHaveBeenCalled();
    expect(mockedCodeReviewApi.listReviewsRequest).not.toHaveBeenCalled();
  });

  it("shows a gate when no codebase is indexed, linking to Settings", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
    renderPage();

    expect(await screen.findByText("Codebase not indexed yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Settings" })).toHaveAttribute("href", "/projects/p1/settings");
    expect(mockedCodeReviewApi.listReviewsRequest).not.toHaveBeenCalled();
  });

  it("shows a gate when the index exists but hasn't completed", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: makeIndex({ status: "indexing" }) });
    renderPage();

    expect(await screen.findByText("Codebase not indexed yet")).toBeInTheDocument();
  });
});

describe("CodeReview — empty state", () => {
  it("shows example scopes when no review has been run yet", async () => {
    mockReady();
    mockedCodeReviewApi.listReviewsRequest.mockResolvedValue({ reviews: [] });
    renderPage();

    expect(await screen.findByText("No reviews run yet")).toBeInTheDocument();
    expect(screen.getByText("Review the authentication implementation for security issues.")).toBeInTheDocument();
    expect(screen.getByText("Find reliability risks in the GitHub integration.")).toBeInTheDocument();
    expect(screen.getByText("Look for error-handling problems in the API.")).toBeInTheDocument();
  });

  it("clicking an example scope fills the input", async () => {
    mockReady();
    mockedCodeReviewApi.listReviewsRequest.mockResolvedValue({ reviews: [] });
    renderPage();
    await screen.findByText("No reviews run yet");

    const user = userEvent.setup();
    await user.click(screen.getByText("Find reliability risks in the GitHub integration."));

    expect(screen.getByLabelText("What should DevForge review? (optional)")).toHaveValue(
      "Find reliability risks in the GitHub integration.",
    );
  });

  it("shows the page's read-only disclaimer", async () => {
    mockReady();
    mockedCodeReviewApi.listReviewsRequest.mockResolvedValue({ reviews: [] });
    renderPage();
    await screen.findByText("No reviews run yet");

    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    expect(screen.getByText(/does not modify your code/)).toBeInTheDocument();
  });
});

describe("CodeReview — loading state", () => {
  it("shows a real, non-fabricated loading message that never implies code is being changed", async () => {
    mockReady();
    mockedCodeReviewApi.listReviewsRequest.mockResolvedValue({ reviews: [] });
    let resolveRun: (value: CodeReviewType) => void = () => {};
    mockedCodeReviewApi.createReviewRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve;
      }),
    );
    renderPage();
    await screen.findByText("No reviews run yet");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Run review" }));

    const loadingLabel = await screen.findByText(
      /Finding relevant indexed code, preparing review context, analyzing/,
    );
    expect(loadingLabel).toBeInTheDocument();
    // The loading message itself must describe the real retrieval/analysis
    // process, never imply code is being changed (the page's own read-only
    // disclaimer legitimately says "modify" elsewhere, so this checks only
    // the loading label's own text).
    expect(loadingLabel.textContent).not.toMatch(/modif/i);

    resolveRun(makeReview());
    expect(await screen.findByText("One finding related to input validation.")).toBeInTheDocument();
  });
});

describe("CodeReview — results state", () => {
  it("renders a prior review with its summary, finding badges, recommendation, and sources", async () => {
    mockReady();
    mockedCodeReviewApi.listReviewsRequest.mockResolvedValue({ reviews: [makeReview()] });
    renderPage();

    expect(await screen.findByText("One finding related to input validation.")).toBeInTheDocument();
    expect(screen.getByText("Review add() for validation issues.")).toBeInTheDocument();
    const findingTitle = screen.getByText("Missing input validation");
    const findingCard = findingTitle.closest("div")!.parentElement as HTMLElement;
    expect(within(findingCard).getByText("medium", { selector: "span" })).toBeInTheDocument();
    expect(within(findingCard).getByText("validation", { selector: "span" })).toBeInTheDocument();
    expect(within(findingCard).getByText(/Validate argument types/)).toBeInTheDocument();
    expect(within(findingCard).getByText("src/app.ts")).toBeInTheDocument();
    expect(within(findingCard).getByText("add")).toBeInTheDocument();
    expect(screen.getByText(/master@abc123de/)).toBeInTheDocument();
  });

  it("filters findings by severity", async () => {
    mockReady();
    mockedCodeReviewApi.listReviewsRequest.mockResolvedValue({
      reviews: [
        makeReview({
          findings: [
            {
              id: "f1",
              title: "High severity finding",
              description: "d1",
              severity: "high",
              category: "security",
              confidence: "high",
              recommendation: "r1",
              actionable: true,
              sources: [],
            },
            {
              id: "f2",
              title: "Low severity finding",
              description: "d2",
              severity: "low",
              category: "maintainability",
              confidence: "low",
              recommendation: "r2",
              actionable: true,
              sources: [],
            },
          ],
          findingCount: 2,
        }),
      ],
    });
    renderPage();
    await screen.findByText("High severity finding");
    expect(screen.getByText("Low severity finding")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Severity"), "high");

    expect(screen.getByText("High severity finding")).toBeInTheDocument();
    expect(screen.queryByText("Low severity finding")).not.toBeInTheDocument();
  });

  it("shows a 'no relevant code found' result with zero findings honestly", async () => {
    mockReady();
    mockedCodeReviewApi.listReviewsRequest.mockResolvedValue({
      reviews: [
        makeReview({
          summary: "No relevant code was found in the indexed repository for this scope.",
          findingCount: 0,
          findings: [],
          sources: [],
        }),
      ],
    });
    renderPage();

    expect(
      await screen.findByText("No relevant code was found in the indexed repository for this scope."),
    ).toBeInTheDocument();
    expect(document.body.textContent).toContain("0 findings");
  });

  it("supports running another review, prepending it to the history", async () => {
    mockReady();
    mockedCodeReviewApi.listReviewsRequest.mockResolvedValue({ reviews: [makeReview({ reviewId: "r1" })] });
    mockedCodeReviewApi.createReviewRequest.mockResolvedValue(
      makeReview({ reviewId: "r2", scope: "Review error handling.", summary: "No issues found." }),
    );
    renderPage();
    await screen.findByText("Review add() for validation issues.");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Run another review" }));

    expect(await screen.findByText("No issues found.")).toBeInTheDocument();
    // Both the original and the new review remain visible.
    expect(screen.getByText("One finding related to input validation.")).toBeInTheDocument();
  });
});

describe("CodeReview — error state", () => {
  it("shows the real error and never fabricates a review on failure", async () => {
    mockReady();
    mockedCodeReviewApi.listReviewsRequest.mockResolvedValue({ reviews: [] });
    mockedCodeReviewApi.createReviewRequest.mockRejectedValue(
      new ApiError(400, "NO_COMPLETED_INDEX", "Connect a repository and complete indexing before searching."),
    );
    renderPage();
    await screen.findByText("No reviews run yet");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Run review" }));

    expect(
      await screen.findByText("Connect a repository and complete indexing before searching."),
    ).toBeInTheDocument();
    // Still showing the empty state — no fabricated review rendered.
    expect(screen.getByText("No reviews run yet")).toBeInTheDocument();
  });

  it("shows a history-loading error distinctly from a run error", async () => {
    mockReady();
    mockedCodeReviewApi.listReviewsRequest.mockRejectedValue(new Error("network down"));
    renderPage();

    expect(await screen.findByText("Couldn't load review history.")).toBeInTheDocument();
  });
});

describe("CodeReview — no secret leakage", () => {
  it("never renders anything token- or key-shaped from a rendered review", async () => {
    mockReady();
    mockedCodeReviewApi.listReviewsRequest.mockResolvedValue({ reviews: [makeReview()] });
    renderPage();
    await screen.findByText("One finding related to input validation.");

    expect(document.body.textContent).not.toMatch(/ghp_[A-Za-z0-9]/);
    expect(document.body.textContent).not.toMatch(/sk-ant-[A-Za-z0-9]/);
  });
});
