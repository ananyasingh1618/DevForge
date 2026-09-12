import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodebaseIndexSection } from "./CodebaseIndexSection.js";
import { ApiError } from "../services/apiClient.js";
import * as repositoryApi from "../services/repositoryApi.js";
import * as codebaseIndexApi from "../services/codebaseIndexApi.js";
import type { RepositoryConnection } from "../types/repository.js";
import type { CodebaseIndex, CodeSymbol, IndexedFile } from "../types/codebaseIndex.js";

vi.mock("../services/repositoryApi.js");
vi.mock("../services/codebaseIndexApi.js");

const mockedRepositoryApi = vi.mocked(repositoryApi);
const mockedCodebaseIndexApi = vi.mocked(codebaseIndexApi);

beforeEach(() => {
  vi.clearAllMocks();
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

function makeIndex(overrides: Partial<CodebaseIndex> = {}): CodebaseIndex {
  return {
    id: "idx1",
    projectId: "p1",
    repositoryConnectionId: "conn1",
    branch: "master",
    commitSha: "abc123def456",
    status: "completed",
    truncated: false,
    fileCount: 2,
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

describe("CodebaseIndexSection — no repository state", () => {
  it("shows a gate explaining a repository must be connected first", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: null });
    render(<CodebaseIndexSection projectId="p1" />);

    expect(await screen.findByText("No repository connected")).toBeInTheDocument();
    expect(mockedCodebaseIndexApi.getCodebaseIndexRequest).not.toHaveBeenCalled();
  });
});

describe("CodebaseIndexSection — error state", () => {
  it("shows an error with retry when loading the connection fails", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockRejectedValue(new Error("network down"));
    render(<CodebaseIndexSection projectId="p1" />);

    expect(await screen.findByText("Couldn't load the codebase index.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("CodebaseIndexSection — ready state (connected, not yet indexed)", () => {
  it("shows a Start indexing control and never claims success before the server confirms it", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
    mockedCodebaseIndexApi.startIndexingRequest.mockRejectedValue(
      new ApiError(401, "GITHUB_INVALID_CREDENTIALS", "The GitHub token is invalid or expired."),
    );
    render(<CodebaseIndexSection projectId="p1" />);

    expect(await screen.findByText("Ready to index the connected repository's selected branch.")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start indexing" }));

    expect(await screen.findByText("The GitHub token is invalid or expired.")).toBeInTheDocument();
    // Still showing the ready prompt — no fabricated indexed state rendered.
    expect(screen.getByText("Ready to index the connected repository's selected branch.")).toBeInTheDocument();
  });

  it("shows the indexed state once starting succeeds", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
    mockedCodebaseIndexApi.startIndexingRequest.mockResolvedValue({ index: makeIndex() });
    mockedCodebaseIndexApi.listIndexedFilesRequest.mockResolvedValue({ files: [] });
    render(<CodebaseIndexSection projectId="p1" />);

    await screen.findByText("Ready to index the connected repository's selected branch.");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start indexing" }));

    expect(await screen.findByText("master")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });
});

describe("CodebaseIndexSection — indexed state", () => {
  function makeFile(overrides: Partial<IndexedFile> = {}): IndexedFile {
    return {
      id: "file1",
      indexId: "idx1",
      path: "src/app.ts",
      language: "typescript",
      sizeBytes: 42,
      contentHash: "sha-app",
      parseStatus: "parsed",
      parseError: null,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("renders index details and never labels a failed run as 'Last indexed'", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({
      index: makeIndex({ status: "failed", error: "The GitHub token is invalid or expired.", fileCount: 0 }),
    });
    render(<CodebaseIndexSection projectId="p1" />);

    expect(await screen.findByText("failed")).toBeInTheDocument();
    expect(screen.getByText("The GitHub token is invalid or expired.")).toBeInTheDocument();
    expect(screen.getByText("Last run")).toBeInTheDocument();
    expect(screen.queryByText("Last indexed")).not.toBeInTheDocument();
    // A failed index never renders the files browser.
    expect(mockedCodebaseIndexApi.listIndexedFilesRequest).not.toHaveBeenCalled();
  });

  it("lists indexed files and lazily loads a file's symbols on expand", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: makeIndex() });
    mockedCodebaseIndexApi.listIndexedFilesRequest.mockResolvedValue({ files: [makeFile()] });
    const symbols: CodeSymbol[] = [
      { id: "sym1", fileId: "file1", name: "add", type: "function", startLine: 1, endLine: 3, parentId: null, signature: "(a, b)" },
    ];
    mockedCodebaseIndexApi.listFileSymbolsRequest.mockResolvedValue({ symbols });
    render(<CodebaseIndexSection projectId="p1" />);

    expect(await screen.findByText("src/app.ts")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByText("src/app.ts"));

    expect(await screen.findByText(/add/)).toBeInTheDocument();
    expect(mockedCodebaseIndexApi.listFileSymbolsRequest).toHaveBeenCalledWith("p1", "file1");
  });

  it("shows a parse error inline for a parse_error file", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: makeIndex({ failedFileCount: 1 }) });
    mockedCodebaseIndexApi.listIndexedFilesRequest.mockResolvedValue({
      files: [makeFile({ id: "file2", path: "bad.js", parseStatus: "parse_error", parseError: "Syntax error.", language: "javascript" })],
    });
    render(<CodebaseIndexSection projectId="p1" />);

    expect(await screen.findByText("bad.js")).toBeInTheDocument();
    expect(screen.getByText("Syntax error.")).toBeInTheDocument();
  });

  it("reindexes and shows the updated result, and does not fabricate success on failure", async () => {
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: makeIndex() });
    mockedCodebaseIndexApi.listIndexedFilesRequest.mockResolvedValue({ files: [] });
    mockedCodebaseIndexApi.reindexRepositoryRequest.mockRejectedValue(
      new ApiError(502, "PARSER_SERVICE_UNREACHABLE", "Could not reach the AI service's parser."),
    );
    render(<CodebaseIndexSection projectId="p1" />);

    await screen.findByText("master");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reindex" }));

    expect(await screen.findByText("Could not reach the AI service's parser.")).toBeInTheDocument();
  });
});
