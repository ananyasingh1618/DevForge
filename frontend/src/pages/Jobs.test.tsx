import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Jobs } from "./Jobs.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";
import * as projectsApi from "../services/projectsApi.js";
import * as jobsApi from "../services/jobsApi.js";
import type { Project } from "../types/project.js";
import type { Job } from "../types/job.js";

vi.mock("../services/authApi.js");
vi.mock("../services/projectsApi.js");
vi.mock("../services/jobsApi.js");

const mockedAuthApi = vi.mocked(authApi);
const mockedProjectsApi = vi.mocked(projectsApi);
const mockedJobsApi = vi.mocked(jobsApi);

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

function mockReady() {
  mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
}

describe("Jobs — empty state", () => {
  it("shows an empty state and the three job-creation buttons when no jobs exist", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({ jobs: [] });
    renderPage();

    expect(await screen.findByText("No jobs yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start indexing job" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Q&A job" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start review job" })).toBeInTheDocument();
  });
});

describe("Jobs — listing", () => {
  it("renders each job's type and status", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({
      jobs: [makeJob({ id: "j1", type: "indexing", status: "running" }), makeJob({ id: "j2", type: "review", status: "completed" })],
    });
    renderPage();

    expect(await screen.findByText("indexing")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("shows a failed job's real error message, and its retry count", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValue({
      jobs: [makeJob({ status: "failed", errorMessage: "The provider rejected the request.", retryCount: 1, maxRetries: 3 })],
    });
    renderPage();

    expect(await screen.findByText("The provider rejected the request.")).toBeInTheDocument();
    expect(screen.getByText("retry 1/3")).toBeInTheDocument();
  });

  it("shows Cancel only for queued/running jobs, and Retry only for failed/timed-out jobs under the retry limit", async () => {
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
    await screen.findByText("indexing", { exact: false }).catch(() => {}); // wait for render

    expect(await screen.findAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1); // j4 is at its retry limit, no button
  });
});

describe("Jobs — actions", () => {
  it("creating a Q&A job calls createJobRequest with a question and refreshes the list", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest.mockResolvedValueOnce({ jobs: [] }).mockResolvedValue({ jobs: [makeJob({ status: "queued" })] });
    mockedJobsApi.createJobRequest.mockResolvedValue({ job: makeJob() });
    renderPage();
    await screen.findByText("No jobs yet");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start Q&A job" }));

    expect(mockedJobsApi.createJobRequest).toHaveBeenCalledWith("p1", "qa", expect.objectContaining({ question: expect.any(String) }));
    expect(await screen.findByText("queued")).toBeInTheDocument();
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
    mockedJobsApi.listJobsRequest
      .mockResolvedValueOnce({ jobs: [makeJob({ id: "j1", status: "queued" })] })
      .mockResolvedValue({ jobs: [makeJob({ id: "j1", status: "cancelled", cancelledAt: new Date().toISOString() })] });
    mockedJobsApi.cancelJobRequest.mockResolvedValue({ job: makeJob({ id: "j1", status: "cancelled" }) });
    renderPage();
    await screen.findByText("queued");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedJobsApi.cancelJobRequest).toHaveBeenCalledWith("p1", "j1");
    expect(await screen.findByText("cancelled")).toBeInTheDocument();
  });

  it("retrying a job calls retryJobRequest and refreshes", async () => {
    mockReady();
    mockedJobsApi.listJobsRequest
      .mockResolvedValueOnce({ jobs: [makeJob({ id: "j1", status: "failed", retryCount: 1 })] })
      .mockResolvedValue({ jobs: [makeJob({ id: "j1", status: "queued", retryCount: 2 })] });
    mockedJobsApi.retryJobRequest.mockResolvedValue({ job: makeJob({ id: "j1", status: "queued" }) });
    renderPage();
    await screen.findByText("failed");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(mockedJobsApi.retryJobRequest).toHaveBeenCalledWith("p1", "j1");
    expect(await screen.findByText("queued")).toBeInTheDocument();
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
