import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Projects } from "./Projects.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";
import * as projectsApi from "../services/projectsApi.js";

vi.mock("../services/authApi.js");
vi.mock("../services/projectsApi.js");

const mockedAuthApi = vi.mocked(authApi);
const mockedProjectsApi = vi.mocked(projectsApi);

function renderProjects() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Projects />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuthApi.meRequest.mockResolvedValue({
    user: { id: "1", email: "me@example.com", name: null, createdAt: new Date().toISOString() },
  });
});

describe("Projects page", () => {
  it("shows a loading state, then the empty state when there are no projects", async () => {
    mockedProjectsApi.listProjectsRequest.mockResolvedValue({ projects: [] });
    renderProjects();

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });

  it("renders a card for each project once loaded", async () => {
    mockedProjectsApi.listProjectsRequest.mockResolvedValue({
      projects: [
        {
          id: "p1",
          ownerId: "1",
          name: "DevForge",
          description: "AI software engineering platform",
          status: "planning",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    renderProjects();

    expect(await screen.findByText("DevForge")).toBeInTheDocument();
    expect(screen.getByText("AI software engineering platform")).toBeInTheDocument();
    expect(screen.getByText("planning")).toBeInTheDocument();
  });

  it("shows an error state with a retry option when the request fails", async () => {
    mockedProjectsApi.listProjectsRequest.mockRejectedValue(
      new ApiError(500, "INTERNAL_ERROR", "boom"),
    );
    renderProjects();

    expect(await screen.findByText("Couldn't load your projects.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
