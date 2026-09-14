import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProjectOverview } from "./ProjectOverview.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";
import * as projectsApi from "../services/projectsApi.js";
import * as requirementsApi from "../services/requirementsApi.js";
import * as prdApi from "../services/prdApi.js";
import * as architectureApi from "../services/architectureApi.js";
import * as epicsApi from "../services/epicsApi.js";
import * as tasksApi from "../services/tasksApi.js";

vi.mock("../services/authApi.js");
vi.mock("../services/projectsApi.js");
vi.mock("../services/requirementsApi.js");
vi.mock("../services/prdApi.js");
vi.mock("../services/architectureApi.js");
vi.mock("../services/epicsApi.js");
vi.mock("../services/tasksApi.js");

const mockedAuthApi = vi.mocked(authApi);
const mockedProjectsApi = vi.mocked(projectsApi);
const mockedRequirementsApi = vi.mocked(requirementsApi);
const mockedPrdApi = vi.mocked(prdApi);
const mockedArchitectureApi = vi.mocked(architectureApi);
const mockedEpicsApi = vi.mocked(epicsApi);
const mockedTasksApi = vi.mocked(tasksApi);

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
  mockedRequirementsApi.listRequirementsVersionsRequest.mockResolvedValue({ versions: [] });
  mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [] });
  mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({ versions: [] });
  mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [] });
  mockedTasksApi.listTaskVersionsRequest.mockResolvedValue({ versions: [] });
});

describe("ProjectOverview page", () => {
  it("renders the project and the not-yet-implemented capability list", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({
      project: {
        id: "p1",
        ownerId: "1",
        name: "DevForge",
        description: "AI software engineering platform",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    renderOverview("p1");

    expect(await screen.findByText("DevForge")).toBeInTheDocument();
    expect(screen.getByText("AI software engineering platform")).toBeInTheDocument();
    // Requirements (Phase 2), PRD (Phase 3), Architecture (Phase 4), Epics &
    // Tasks (Phase 5), codebase indexing (Phase 7), retrieval (Phase 8), and
    // codebase Q&A (Phase 9) are implemented and must not appear in the
    // "Not yet implemented" grid alongside genuinely unbuilt capabilities.
    expect(await screen.findByText("No requirements yet")).toBeInTheDocument();
    expect(await screen.findByText("Requirements needed first")).toBeInTheDocument();
    expect(await screen.findByText("PRD needed first")).toBeInTheDocument();
    expect(await screen.findByText("Architecture needed first")).toBeInTheDocument();
    expect(await screen.findByText("Epics needed first")).toBeInTheDocument();
    expect(screen.getAllByText("Not yet implemented")).toHaveLength(1);
    expect(screen.getByText("Reviews")).toBeInTheDocument();
    expect(screen.queryByText("Codebase Q&A")).not.toBeInTheDocument();
    expect(screen.queryByText("Repository indexing")).not.toBeInTheDocument();
  });

  it("shows a not-found message for a 404 (missing or someone else's project)", async () => {
    mockedProjectsApi.getProjectRequest.mockRejectedValue(
      new ApiError(404, "NOT_FOUND", "Project not found"),
    );
    renderOverview("does-not-exist");

    expect(await screen.findByText("Project not found.")).toBeInTheDocument();
  });
});
