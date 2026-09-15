import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Evaluations } from "./Evaluations.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";
import * as evaluationsApi from "../services/evaluationsApi.js";
import type { EvaluationRunDetail, EvaluationRunSummary } from "../types/evaluation.js";

vi.mock("../services/authApi.js");
vi.mock("../services/evaluationsApi.js");

const mockedAuthApi = vi.mocked(authApi);
const mockedEvaluationsApi = vi.mocked(evaluationsApi);

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuthApi.meRequest.mockResolvedValue({
    user: { id: "u1", email: "dev@example.com", name: null, createdAt: new Date().toISOString() },
  });
});

function makeSummary(overrides: Partial<EvaluationRunSummary> = {}): EvaluationRunSummary {
  return {
    id: "run1",
    datasetVersion: "2026.09.15-1",
    evaluatorVersion: "1.0.0",
    mode: "mock",
    gitCommit: "abc123def456",
    passed: true,
    totalCases: 24,
    failedCaseCount: 2,
    retrievalMetrics: { recallAtK: 0.889, caseCount: 9 },
    qaMetrics: { citationRecall: 1, caseCount: 6 },
    reviewMetrics: { findingRecall: 1, caseCount: 9 },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDetail(overrides: Partial<EvaluationRunDetail> = {}): EvaluationRunDetail {
  return {
    ...makeSummary(),
    reportJson: {
      retrieval: {
        cases: [
          { caseId: "retrieval-fire-and-forget-notifications", feature: "retrieval", passed: false, score: 0, failureReasons: ["None of expectedChunkIds appeared in top 5."] },
        ],
      },
      qa: {
        cases: [
          { caseId: "qa-notification-failures", feature: "qa", passed: false, score: 0, failureReasons: ["Cited chunk(s) not among retrieved sources."] },
        ],
      },
      review: { cases: [] },
      gates: [
        { name: "No invalid review citations", passed: true, detail: "citationValidityRate = 1" },
        { name: "Retrieval recall@K stays at or above 75%", passed: true, detail: "recallAtK = 0.889" },
      ],
    },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/evaluations"]}>
      <AuthProvider>
        <Routes>
          <Route path="/evaluations" element={<Evaluations />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Evaluations — empty state", () => {
  it("shows an empty state when no runs exist yet", async () => {
    mockedEvaluationsApi.listEvaluationRunsRequest.mockResolvedValue({ runs: [] });
    renderPage();

    expect(await screen.findByText("No evaluation runs yet")).toBeInTheDocument();
  });
});

describe("Evaluations — list state", () => {
  it("renders a run's summary status, case count, and mode", async () => {
    mockedEvaluationsApi.listEvaluationRunsRequest.mockResolvedValue({ runs: [makeSummary()] });
    renderPage();

    expect(await screen.findByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("22/24 cases · mock")).toBeInTheDocument();
  });

  it("renders a failed run distinctly from a passed one", async () => {
    mockedEvaluationsApi.listEvaluationRunsRequest.mockResolvedValue({
      runs: [makeSummary({ id: "run1", passed: true }), makeSummary({ id: "run2", passed: false, failedCaseCount: 10 })],
    });
    renderPage();

    expect(await screen.findByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});

describe("Evaluations — baseline comparison (Phase 12)", () => {
  it("shows a comparison against the previous run when one exists, with a regression indicator", async () => {
    const older = makeSummary({
      id: "run-older",
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      retrievalMetrics: { recallAtK: 1, precisionAtK: 0.6, caseCount: 14 },
      qaMetrics: { invalidCitationRate: 0, caseCount: 7 },
      reviewMetrics: { findingRecall: 1, caseCount: 11 },
    });
    const newer = makeSummary({
      id: "run-newer",
      createdAt: new Date().toISOString(),
      passed: false,
      retrievalMetrics: { recallAtK: 0.8, precisionAtK: 0.6, caseCount: 14 },
      qaMetrics: { invalidCitationRate: 0, caseCount: 7 },
      reviewMetrics: { findingRecall: 1, caseCount: 11 },
    });
    mockedEvaluationsApi.listEvaluationRunsRequest.mockResolvedValue({ runs: [newer, older] });
    mockedEvaluationsApi.getEvaluationRunRequest.mockResolvedValue(makeDetail(newer));
    renderPage();
    await screen.findByText("Failed");

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: /22\/24 cases/ })[0]!);

    expect(await screen.findByText(/Vs\. previous run/)).toBeInTheDocument();
    // recallAtK regressed from 100% to 80% — must show a regression indicator.
    expect(screen.getByText("Retrieval recall@K")).toBeInTheDocument();
    expect(screen.getByText(/regression/)).toBeInTheDocument();
  });

  it("shows no comparison for the oldest (only) run", async () => {
    mockedEvaluationsApi.listEvaluationRunsRequest.mockResolvedValue({ runs: [makeSummary()] });
    mockedEvaluationsApi.getEvaluationRunRequest.mockResolvedValue(makeDetail());
    renderPage();
    await screen.findByText("Passed");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /22\/24 cases/ }));
    await screen.findByText("Regression gates");

    expect(screen.queryByText(/Vs\. previous run/)).not.toBeInTheDocument();
  });
});

describe("Evaluations — detail state", () => {
  it("expands a run to show regression gates, metrics, and failed-case detail", async () => {
    mockedEvaluationsApi.listEvaluationRunsRequest.mockResolvedValue({ runs: [makeSummary()] });
    mockedEvaluationsApi.getEvaluationRunRequest.mockResolvedValue(makeDetail());
    renderPage();
    await screen.findByText("Passed");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /22\/24 cases/ }));

    expect(await screen.findByText("Regression gates")).toBeInTheDocument();
    expect(screen.getByText("No invalid review citations")).toBeInTheDocument();
    expect(screen.getByText("retrieval-fire-and-forget-notifications")).toBeInTheDocument();
    expect(screen.getByText("qa-notification-failures")).toBeInTheDocument();
    expect(mockedEvaluationsApi.getEvaluationRunRequest).toHaveBeenCalledWith("run1");
  });

  it("collapses the detail again on a second click without re-fetching", async () => {
    mockedEvaluationsApi.listEvaluationRunsRequest.mockResolvedValue({ runs: [makeSummary()] });
    mockedEvaluationsApi.getEvaluationRunRequest.mockResolvedValue(makeDetail());
    renderPage();
    await screen.findByText("Passed");

    const user = userEvent.setup();
    const toggleButton = screen.getByRole("button", { name: /22\/24 cases/ });
    await user.click(toggleButton);
    await screen.findByText("Regression gates");
    await user.click(toggleButton);

    expect(screen.queryByText("Regression gates")).not.toBeInTheDocument();
    expect(mockedEvaluationsApi.getEvaluationRunRequest).toHaveBeenCalledTimes(1);
  });

  it("shows a distinct error when a run's detail fails to load", async () => {
    mockedEvaluationsApi.listEvaluationRunsRequest.mockResolvedValue({ runs: [makeSummary()] });
    mockedEvaluationsApi.getEvaluationRunRequest.mockRejectedValue(new ApiError(404, "NOT_FOUND", "Evaluation run not found"));
    renderPage();
    await screen.findByText("Passed");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /22\/24 cases/ }));

    expect(await screen.findByText("Evaluation run not found")).toBeInTheDocument();
  });
});

describe("Evaluations — error state", () => {
  it("shows a real error when the run list fails to load, with a working retry", async () => {
    mockedEvaluationsApi.listEvaluationRunsRequest
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "Something went wrong"))
      .mockResolvedValueOnce({ runs: [makeSummary()] });
    renderPage();

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Passed")).toBeInTheDocument();
  });
});

describe("Evaluations — no secret leakage", () => {
  it("never renders anything token- or key-shaped from a rendered run", async () => {
    mockedEvaluationsApi.listEvaluationRunsRequest.mockResolvedValue({ runs: [makeSummary()] });
    mockedEvaluationsApi.getEvaluationRunRequest.mockResolvedValue(makeDetail());
    renderPage();
    await screen.findByText("Passed");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /22\/24 cases/ }));
    await screen.findByText("Regression gates");

    expect(document.body.textContent).not.toMatch(/ghp_[A-Za-z0-9]/);
    expect(document.body.textContent).not.toMatch(/sk-ant-[A-Za-z0-9]/);
  });
});
