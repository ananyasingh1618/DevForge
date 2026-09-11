import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProjectOverview } from "./ProjectOverview.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";
import * as projectsApi from "../services/projectsApi.js";
import * as requirementsApi from "../services/requirementsApi.js";

vi.mock("../services/authApi.js");
vi.mock("../services/projectsApi.js");
vi.mock("../services/requirementsApi.js");

const mockedAuthApi = vi.mocked(authApi);
const mockedProjectsApi = vi.mocked(projectsApi);
const mockedRequirementsApi = vi.mocked(requirementsApi);

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
    // Requirements is implemented (Phase 2) and must not appear in the
    // "Not yet implemented" grid alongside genuinely unbuilt capabilities.
    expect(await screen.findByText("No requirements yet")).toBeInTheDocument();
    expect(screen.getAllByText("Not yet implemented")).toHaveLength(6);
    expect(screen.getByText("Codebase Q&A")).toBeInTheDocument();
  });

  it("shows a not-found message for a 404 (missing or someone else's project)", async () => {
    mockedProjectsApi.getProjectRequest.mockRejectedValue(
      new ApiError(404, "NOT_FOUND", "Project not found"),
    );
    renderOverview("does-not-exist");

    expect(await screen.findByText("Project not found.")).toBeInTheDocument();
  });
});
