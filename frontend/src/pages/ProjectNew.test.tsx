import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ProjectNew } from "./ProjectNew.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";
import * as projectsApi from "../services/projectsApi.js";

vi.mock("../services/authApi.js");
vi.mock("../services/projectsApi.js");

const mockedAuthApi = vi.mocked(authApi);
const mockedProjectsApi = vi.mocked(projectsApi);

function renderProjectNew() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ProjectNew />
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

describe("ProjectNew page", () => {
  it("requires a name before submitting", async () => {
    renderProjectNew();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(mockedProjectsApi.createProjectRequest).not.toHaveBeenCalled();
  });

  it("creates a project with the entered name and description", async () => {
    mockedProjectsApi.createProjectRequest.mockResolvedValue({
      project: {
        id: "p1",
        ownerId: "1",
        name: "DevForge",
        description: "desc",
        status: "planning",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    renderProjectNew();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Name"), "DevForge");
    await user.type(screen.getByLabelText("Description (optional)"), "desc");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(mockedProjectsApi.createProjectRequest).toHaveBeenCalledWith({
      name: "DevForge",
      description: "desc",
    });
  });

  it("shows the server error message on failure", async () => {
    mockedProjectsApi.createProjectRequest.mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "Name must be 100 characters or fewer"),
    );
    renderProjectNew();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Name"), "x".repeat(101));
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(
      await screen.findByText("Name must be 100 characters or fewer"),
    ).toBeInTheDocument();
  });
});
