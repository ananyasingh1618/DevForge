import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { RepositoryConnectionSection } from "./RepositoryConnectionSection.js";
import { ApiError } from "../services/apiClient.js";
import * as repositoryApi from "../services/repositoryApi.js";
import * as codebaseIndexApi from "../services/codebaseIndexApi.js";
import type { RepositoryConnection } from "../types/repository.js";

vi.mock("../services/repositoryApi.js");
vi.mock("../services/codebaseIndexApi.js");

const mockedRepositoryApi = vi.mocked(repositoryApi);
const mockedCodebaseIndexApi = vi.mocked(codebaseIndexApi);

beforeEach(() => {
  vi.clearAllMocks();
  mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
});

function makeConnection(overrides: Partial<RepositoryConnection> = {}): RepositoryConnection {
  return {
    id: "conn1",
    projectId: "p1",
    githubOwner: "octocat",
    githubRepo: "Hello-World",
    githubRepoId: "1296269",
    githubAccountLogin: "octocat",
    repositoryUrl: "https://github.com/octocat/Hello-World",
    defaultBranch: "master",
    selectedBranch: "master",
    status: "verified",
    lastVerifiedAt: new Date().toISOString(),
    lastError: null,
    tokenLast4: "7890",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("RepositoryConnectionSection — disconnected state", () => {
  it("shows the dependency-free empty state with a connect form", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: null });
    render(
      <MemoryRouter>
        <RepositoryConnectionSection projectId="p1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("No repository connected")).toBeInTheDocument();
    expect(screen.getByLabelText("Owner")).toBeInTheDocument();
    expect(screen.getByLabelText("Repository")).toBeInTheDocument();
    expect(screen.getByLabelText("Personal access token")).toBeInTheDocument();
  });

  it("connects and shows the connected view, and does not fabricate success on failure", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: null });
    mockedRepositoryApi.connectRepositoryRequest.mockRejectedValue(
      new ApiError(
        503,
        "GITHUB_INTEGRATION_NOT_CONFIGURED",
        "GitHub integration is not configured.",
      ),
    );
    render(
      <MemoryRouter>
        <RepositoryConnectionSection projectId="p1" />
      </MemoryRouter>,
    );
    await screen.findByText("No repository connected");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Owner"), "octocat");
    await user.type(screen.getByLabelText("Repository"), "Hello-World");
    await user.type(screen.getByLabelText("Personal access token"), "ghp_faketoken1234567890");
    await user.click(screen.getByRole("button", { name: "Connect repository" }));

    expect(await screen.findByText("GitHub integration is not configured.")).toBeInTheDocument();
    // Still disconnected — no fabricated success content rendered.
    expect(screen.getByText("No repository connected")).toBeInTheDocument();
  });
});

describe("RepositoryConnectionSection — list load failure", () => {
  it("shows an error state with retry", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockRejectedValue(new Error("network down"));
    render(
      <MemoryRouter>
        <RepositoryConnectionSection projectId="p1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Couldn't load the repository connection.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("RepositoryConnectionSection — connected state", () => {
  it("renders repository details, status, and masked token", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({
      connection: makeConnection(),
    });
    mockedRepositoryApi.listRepositoryBranchesRequest.mockResolvedValue({
      branches: [
        { name: "master", protected: true },
        { name: "develop", protected: false },
      ],
    });
    render(
      <MemoryRouter>
        <RepositoryConnectionSection projectId="p1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("octocat/Hello-World")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/octocat/Hello-World")).toBeInTheDocument();
    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(screen.getByText("octocat")).toBeInTheDocument();
    expect(screen.getByText("•••• 7890")).toBeInTheDocument();
    // The raw token must never be rendered anywhere.
    expect(screen.queryByText(/ghp_/)).not.toBeInTheDocument();
  });

  it("reverifies access and shows the real error on failure", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({
      connection: makeConnection(),
    });
    mockedRepositoryApi.listRepositoryBranchesRequest.mockResolvedValue({ branches: [] });
    mockedRepositoryApi.verifyRepositoryAccessRequest.mockRejectedValue(
      new ApiError(401, "GITHUB_INVALID_CREDENTIALS", "The GitHub token is invalid or expired."),
    );
    render(
      <MemoryRouter>
        <RepositoryConnectionSection projectId="p1" />
      </MemoryRouter>,
    );
    await screen.findByText("octocat/Hello-World");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reverify access" }));

    expect(await screen.findByText("The GitHub token is invalid or expired.")).toBeInTheDocument();
  });

  it("lets the user change the selected branch", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({
      connection: makeConnection(),
    });
    mockedRepositoryApi.listRepositoryBranchesRequest.mockResolvedValue({
      branches: [
        { name: "master", protected: true },
        { name: "develop", protected: false },
      ],
    });
    mockedRepositoryApi.updateRepositoryBranchRequest.mockResolvedValue({
      connection: makeConnection({ selectedBranch: "develop" }),
    });
    render(
      <MemoryRouter>
        <RepositoryConnectionSection projectId="p1" />
      </MemoryRouter>,
    );
    await screen.findByText("octocat/Hello-World");

    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Branch"), "develop");

    expect(mockedRepositoryApi.updateRepositoryBranchRequest).toHaveBeenCalledWith("p1", "develop");
  });

  it("disconnects and returns to the disconnected state", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({
      connection: makeConnection(),
    });
    mockedRepositoryApi.listRepositoryBranchesRequest.mockResolvedValue({ branches: [] });
    mockedRepositoryApi.disconnectRepositoryRequest.mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <RepositoryConnectionSection projectId="p1" />
      </MemoryRouter>,
    );
    await screen.findByText("octocat/Hello-World");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    expect(await screen.findByText("No repository connected")).toBeInTheDocument();
  });
});
