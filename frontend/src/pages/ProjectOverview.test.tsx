import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProjectOverview } from "./ProjectOverview.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";
import * as projectsApi from "../services/projectsApi.js";
import * as repositoryApi from "../services/repositoryApi.js";
import * as codebaseIndexApi from "../services/codebaseIndexApi.js";
import * as jobsApi from "../services/jobsApi.js";
import * as requirementsApi from "../services/requirementsApi.js";
import * as qaApi from "../services/qaApi.js";
import * as codeReviewApi from "../services/codeReviewApi.js";
import type { Project } from "../types/project.js";
import type { Job } from "../types/job.js";

vi.mock("../services/authApi.js");
vi.mock("../services/projectsApi.js");
vi.mock("../services/repositoryApi.js");
vi.mock("../services/codebaseIndexApi.js");
vi.mock("../services/jobsApi.js");
vi.mock("../services/requirementsApi.js");
vi.mock("../services/qaApi.js");
vi.mock("../services/codeReviewApi.js");

const mockedAuthApi = vi.mocked(authApi);
const mockedProjectsApi = vi.mocked(projectsApi);
const mockedRepositoryApi = vi.mocked(repositoryApi);
const mockedCodebaseIndexApi = vi.mocked(codebaseIndexApi);
const mockedJobsApi = vi.mocked(jobsApi);
const mockedRequirementsApi = vi.mocked(requirementsApi);
const mockedQaApi = vi.mocked(qaApi);
const mockedCodeReviewApi = vi.mocked(codeReviewApi);

const PROJECT: Project = {
  id: "p1",
  ownerId: "1",
  name: "CoffeeTracker",
  description: "AI software engineering platform",
  status: "active",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "j1",
    projectId: "p1",
    type: "indexing",
    status: "completed",
    input: {},
    output: null,
    progress: null,
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    maxRetries: 3,
    correlationId: "c1",
    startedAt: null,
    completedAt: new Date().toISOString(),
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderOverview(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${id}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/projects/:id" element={<ProjectOverview />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuthApi.meRequest.mockResolvedValue({
    user: { id: "1", email: "me@example.com", name: null, createdAt: new Date().toISOString() },
  });
  mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: null });
  mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
  mockedJobsApi.listJobsRequest.mockResolvedValue({ jobs: [] });
  mockedRequirementsApi.listRequirementsVersionsRequest.mockResolvedValue({ versions: [] });
  mockedQaApi.listQuestionsRequest.mockResolvedValue({ questions: [] });
  mockedCodeReviewApi.listReviewsRequest.mockResolvedValue({ reviews: [] });
});

describe("ProjectOverview page", () => {
  it("renders the project, its status, and primary/secondary actions", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    renderOverview("p1");

    expect(await screen.findByRole("heading", { name: /CoffeeTracker/ })).toBeInTheDocument();
    expect(screen.getByText("AI software engineering platform")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Analyze Project/ })).toHaveAttribute(
      "href",
      "/projects/p1/requirements",
    );
    expect(screen.getByRole("link", { name: /Ask Codebase/ })).toHaveAttribute("href", "/projects/p1/qa");
  });

  it("shows real repository/indexing status and recent activity when present", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({
      connection: {
        id: "rc1",
        projectId: "p1",
        githubOwner: "octocat",
        githubRepo: "Hello-World",
        githubRepoId: "1",
        githubAccountLogin: "octocat",
        repositoryUrl: "https://github.com/octocat/Hello-World",
        defaultBranch: "main",
        selectedBranch: "main",
        status: "verified",
        lastVerifiedAt: new Date().toISOString(),
        lastError: null,
        tokenLast4: "7890",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({
      index: {
        id: "idx1",
        projectId: "p1",
        repositoryConnectionId: "rc1",
        branch: "main",
        commitSha: "abc123",
        status: "completed",
        truncated: false,
        fileCount: 10,
        parsedFileCount: 8,
        failedFileCount: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    mockedJobsApi.listJobsRequest.mockResolvedValue({ jobs: [makeJob()] });

    renderOverview("p1");

    expect((await screen.findAllByText(/octocat\/Hello-World/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("8/10 files parsed").length).toBeGreaterThan(0);
    expect(screen.getByText(/indexing job completed/)).toBeInTheDocument();
  });

  it("shows a not-found message for a 404 (missing or someone else's project)", async () => {
    mockedProjectsApi.getProjectRequest.mockRejectedValue(
      new ApiError(404, "NOT_FOUND", "Project not found"),
    );
    renderOverview("does-not-exist");

    expect(await screen.findByText("Project not found.")).toBeInTheDocument();
  });
});
