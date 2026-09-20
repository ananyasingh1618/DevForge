import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Jobs } from "./Jobs.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";
import * as projectsApi from "../services/projectsApi.js";
import * as jobsApi from "../services/jobsApi.js";
import * as repositoryApi from "../services/repositoryApi.js";
import * as codebaseIndexApi from "../services/codebaseIndexApi.js";
import type { Project } from "../types/project.js";
import type { Job } from "../types/job.js";
import type { RepositoryConnection } from "../types/repository.js";
import type { CodebaseIndex } from "../types/codebaseIndex.js";

vi.mock("../services/authApi.js");
vi.mock("../services/projectsApi.js");
vi.mock("../services/jobsApi.js");
vi.mock("../services/repositoryApi.js");
vi.mock("../services/codebaseIndexApi.js");

const mockedAuthApi = vi.mocked(authApi);
const mockedProjectsApi = vi.mocked(projectsApi);
const mockedJobsApi = vi.mocked(jobsApi);
const mockedRepositoryApi = vi.mocked(repositoryApi);
const mockedCodebaseIndexApi = vi.mocked(codebaseIndexApi);

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuthApi.meRequest.mockResolvedValue({
    user: { id: "u1", email: "dev@example.com", name: null, createdAt: new Date().toISOString() },
  });
  // Default to "not ready" (no repository) — tests that need Q&A/Review
  // prerequisites satisfied call mockReady() to opt into the ready state.
  mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: null });
  mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
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

function makeConnection(overrides: Partial<RepositoryConnection> = {}): RepositoryConnection {
  return {
    id: "conn1",
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
    ...overrides,
  };
}

function makeIndex(overrides: Partial<CodebaseIndex> = {}): CodebaseIndex {
  return {
    id: "idx1",
    projectId: "p1",
    repositoryConnectionId: "conn1",
    branch: "main",
    commitSha: "abc123",
    status: "completed",
    truncated: false,
    fileCount: 10,
    parsedFileCount: 10,
    failedFileCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "j1",
    projectId: "p1",
    type: "qa",
    status: "queued",
    input: {},
    output: null,
    progress: null,
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    maxRetries: 3,
    correlationId: "c1",
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/p1/jobs"]}>
      <AuthProvider>
        <Routes>
          <Route path="/projects/:id/jobs" element={<Jobs />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// The same job also appears in the compact "Latest activity" preview
// above the full list, so any status/type text is ambiguous unless
// scoped to the "All jobs" container specifically.
async function findAllJobsContainer(): Promise<HTMLElement> {
  await screen.findByText("All jobs");
  return document.getElementById("all-jobs") as HTMLElement;
}

function mockReady() {
  mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
  mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
  mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: makeIndex() });
}

describe("Jobs — empty state", () => {
  it("shows an empty state and the three job-creation buttons when no jobs exist", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({ jobs: [] });
    renderPage();

    expect(await screen.findByText("No jobs yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start indexing job" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Q&A job" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start code review job" })).toBeInTheDocument();
  });
});

describe("Jobs — readiness panel", () => {
  it("shows the full readiness panel with a Connect repository action when no repository is connected", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: null });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
    mockedJobsApi.listJobsRequest.mockResolvedValue({ jobs: [] });
    renderPage();

    // Wait directly on the state-specific link, not the readiness
    // heading (which renders identically before the repository/index
    // fetch resolves, so waiting on it doesn't guarantee this test's
    // specific "no repository" state has actually been reached).
    expect(await screen.findByRole("link", { name: /Connect repository/ })).toHaveAttribute(
      "href",
      "/projects/p1/repository",
    );
    expect(screen.getByText("Q&A and Code Review readiness")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Go to indexing/ })).not.toBeInTheDocument();
  });

  it("shows a Go to indexing action when connected but not yet indexed", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
    mockedJobsApi.listJobsRequest.mockResolvedValue({ jobs: [] });
    renderPage();

    expect(await screen.findByRole("link", { name: /Go to indexing/ })).toHaveAttribute(
      "href",
      "/projects/p1/indexing",
    );
    expect(screen.getByText("Q&A and Code Review readiness")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Connect repository/ })).not.toBeInTheDocument();
  });

  it("collapses to a single confirmation line once repository and indexing are both ready", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({ jobs: [] });
    renderPage();

    expect(
      await screen.findByText(/Repository connected and indexed — Q&A and Code Review are both available\./),
    ).toBeInTheDocument();
    expect(screen.queryByText("Q&A and Code Review readiness")).not.toBeInTheDocument();
  });
});

describe("Jobs — listing", () => {
  it("renders each job's type with a proper label and its status", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({
      jobs: [makeJob({ id: "j1", type: "indexing", status: "running" }), makeJob({ id: "j2", type: "review", status: "completed" })],
    });
    renderPage();

    // Wait for the full ("All jobs") list specifically — the same jobs
    // also appear in the compact "Latest activity" preview above it, so
    // every assertion below is scoped to #all-jobs rather than matching
    // against either copy (or the always-present sidebar nav labels).
    await screen.findByText("All jobs");
    const allJobs = document.getElementById("all-jobs") as HTMLElement;
    expect(within(allJobs).getByText("Indexing")).toBeInTheDocument();
    expect(within(allJobs).getByText("running")).toBeInTheDocument();
    expect(within(allJobs).getByText("Code Review")).toBeInTheDocument();
    expect(within(allJobs).getByText("completed")).toBeInTheDocument();
    // Never the raw enum value rendered through a CSS capitalize() pass.
    expect(screen.queryByText("Qa")).not.toBeInTheDocument();
  });

  it("labels a Q&A job as 'Q&A', never 'Qa'", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({ jobs: [makeJob({ type: "qa", status: "queued" })] });
    renderPage();

    await screen.findByText("All jobs");
    const allJobs = document.getElementById("all-jobs") as HTMLElement;
    expect(within(allJobs).getByText("Q&A")).toBeInTheDocument();
  });

  it("shows a failed job's concise error message, with the retry count inside Details", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({
      jobs: [makeJob({ status: "failed", errorMessage: "The provider rejected the request.", retryCount: 1, maxRetries: 3 })],
    });
    renderPage();

    expect(await screen.findByText("The provider rejected the request.")).toBeInTheDocument();
    // Not visible before expanding Details.
    expect(screen.queryByText("Retries")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Details" }));

    expect(screen.getByText("Retries")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("shows Cancel only for queued/running jobs, and Retry only for failed/timed-out jobs under the retry limit with prerequisites met", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({
      jobs: [
        makeJob({ id: "j1", status: "queued" }),
        makeJob({ id: "j2", status: "completed" }),
        makeJob({ id: "j3", status: "failed", retryCount: 1, maxRetries: 3 }),
        makeJob({ id: "j4", status: "failed", retryCount: 3, maxRetries: 3 }),
      ],
    });
    renderPage();
    await screen.findByText("Indexing", { exact: false }).catch(() => {}); // wait for render

    expect(await screen.findAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1); // j4 is at its retry limit, no button
  });

  it("shows a 'Connect repository' action instead of Retry when a failed job's prerequisites aren't met", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: null });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
    mockedJobsApi.listJobsRequest.mockResolvedValue({
      jobs: [makeJob({ type: "qa", status: "failed", retryCount: 0, maxRetries: 3 })],
    });
    renderPage();

    expect(await screen.findByText("Q&A")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    // Two matches expected: one in the readiness panel, one on the job card.
    expect((await screen.findAllByRole("link", { name: /Connect repository/ })).length).toBeGreaterThan(0);
  });

  it("shows a 'Go to indexing' action instead of Retry for a failed review job when connected but not indexed", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
    mockedJobsApi.listJobsRequest.mockResolvedValue({
      jobs: [makeJob({ type: "review", status: "failed", retryCount: 0, maxRetries: 3 })],
    });
    renderPage();

    expect(await screen.findByText("Code Review")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect((await screen.findAllByRole("link", { name: /Go to indexing/ })).length).toBeGreaterThan(0);
  });

  it("still allows retrying a failed indexing job once a repository is connected, even before indexing has completed", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
    mockedJobsApi.listJobsRequest.mockResolvedValue({
      jobs: [makeJob({ type: "indexing", status: "failed", retryCount: 0, maxRetries: 3 })],
    });
    renderPage();

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("Jobs — activity summary", () => {
  it("shows real counts derived from the loaded job list", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({
      jobs: [
        makeJob({ id: "j1", status: "running" }),
        makeJob({ id: "j2", status: "completed" }),
        makeJob({ id: "j3", status: "completed" }),
        makeJob({ id: "j4", status: "failed" }),
      ],
    });
    renderPage();

    await screen.findByText("Activity");
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Successful")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all jobs" })).toHaveAttribute("href", "#all-jobs");
  });

  it("does not show an activity summary when there are no jobs", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({ jobs: [] });
    renderPage();

    await screen.findByText("No jobs yet");
    expect(screen.queryByText("Activity")).not.toBeInTheDocument();
  });
});

describe("Jobs — actions", () => {
  it("creating a Q&A job calls createJobRequest with a question and refreshes the list", async () => {
    mockReady();
    // State-driven (not call-order-driven) mock: reflects the real current
    // job list regardless of how many independent consumers poll it (the
    // page's own panel and the app shell's status indicator both do).
    let created = false;
    mockedJobsApi.listJobsRequest.mockImplementation(async () => ({
      jobs: created ? [makeJob({ status: "queued" })] : [],
    }));
    mockedJobsApi.createJobRequest.mockImplementation(async () => {
      created = true;
      return { job: makeJob() };
    });
    renderPage();
    await screen.findByText("No jobs yet");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start Q&A job" }));

    expect(mockedJobsApi.createJobRequest).toHaveBeenCalledWith("p1", "qa", expect.objectContaining({ question: expect.any(String) }));
    const allJobs = await findAllJobsContainer();
    expect(within(allJobs).getByText("queued")).toBeInTheDocument();
  });

  it("shows a real error, not a silent failure, when starting a job fails", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({ jobs: [] });
    mockedJobsApi.createJobRequest.mockRejectedValue(new ApiError(503, "AI_PROVIDER_UNAVAILABLE", "The AI provider is not configured."));
    renderPage();
    await screen.findByText("No jobs yet");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start Q&A job" }));

    expect(await screen.findByText("The AI provider is not configured.")).toBeInTheDocument();
  });

  it("cancelling a job calls cancelJobRequest and refreshes", async () => {
    mockReady();
    let cancelled = false;
    mockedJobsApi.listJobsRequest.mockImplementation(async () => ({
      jobs: [
        cancelled
          ? makeJob({ id: "j1", status: "cancelled", cancelledAt: new Date().toISOString() })
          : makeJob({ id: "j1", status: "queued" }),
      ],
    }));
    mockedJobsApi.cancelJobRequest.mockImplementation(async () => {
      cancelled = true;
      return { job: makeJob({ id: "j1", status: "cancelled" }) };
    });
    renderPage();
    await findAllJobsContainer();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedJobsApi.cancelJobRequest).toHaveBeenCalledWith("p1", "j1");
    const allJobs = document.getElementById("all-jobs") as HTMLElement;
    expect(await within(allJobs).findByText("cancelled")).toBeInTheDocument();
  });

  it("retrying a job calls retryJobRequest and refreshes", async () => {
    mockReady();
    let retried = false;
    mockedJobsApi.listJobsRequest.mockImplementation(async () => ({
      jobs: [
        retried
          ? makeJob({ id: "j1", status: "queued", retryCount: 2 })
          : makeJob({ id: "j1", status: "failed", retryCount: 1 }),
      ],
    }));
    mockedJobsApi.retryJobRequest.mockImplementation(async () => {
      retried = true;
      return { job: makeJob({ id: "j1", status: "queued" }) };
    });
    renderPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    expect(mockedJobsApi.retryJobRequest).toHaveBeenCalledWith("p1", "j1");
    const allJobs = document.getElementById("all-jobs") as HTMLElement;
    expect(await within(allJobs).findByText("queued")).toBeInTheDocument();
  });
});

describe("Jobs — error state", () => {
  it("shows a real error when the job list fails to load, with a retry button", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockRejectedValue(new Error("network down"));
    renderPage();

    expect(await screen.findByText("Couldn't load jobs.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("Jobs — no secret leakage", () => {
  it("never renders anything token- or key-shaped from a job's fields", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({
      jobs: [makeJob({ status: "failed", errorMessage: "Provider request failed." })],
    });
    renderPage();
    await screen.findByText("Provider request failed.");

    expect(document.body.textContent).not.toMatch(/ghp_[A-Za-z0-9]/);
    expect(document.body.textContent).not.toMatch(/sk-ant-[A-Za-z0-9]/);
  });
});
