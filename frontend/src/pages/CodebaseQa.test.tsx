import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CodebaseQa } from "./CodebaseQa.js";
import { AuthProvider } from "../hooks/useAuth.js";
import { ApiError } from "../services/apiClient.js";
import * as authApi from "../services/authApi.js";
import * as projectsApi from "../services/projectsApi.js";
import * as repositoryApi from "../services/repositoryApi.js";
import * as codebaseIndexApi from "../services/codebaseIndexApi.js";
import * as qaApi from "../services/qaApi.js";
import type { Project } from "../types/project.js";
import type { CodebaseIndex } from "../types/codebaseIndex.js";
import type { RepositoryConnection } from "../types/repository.js";
import type { QaResult } from "../types/qa.js";

vi.mock("../services/authApi.js");
vi.mock("../services/projectsApi.js");
vi.mock("../services/repositoryApi.js");
vi.mock("../services/codebaseIndexApi.js");
vi.mock("../services/qaApi.js");

const mockedAuthApi = vi.mocked(authApi);
const mockedProjectsApi = vi.mocked(projectsApi);
const mockedRepositoryApi = vi.mocked(repositoryApi);
const mockedCodebaseIndexApi = vi.mocked(codebaseIndexApi);
const mockedQaApi = vi.mocked(qaApi);

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

function makeConnection(): RepositoryConnection {
  return {
    id: "conn1",
    projectId: "p1",
    githubOwner: "octocat",
    githubRepo: "Hello-World",
    githubRepoId: "1",
    githubAccountLogin: "octocat",
    repositoryUrl: "https://github.com/octocat/Hello-World",
    defaultBranch: "master",
    selectedBranch: "master",
    status: "verified",
    lastVerifiedAt: null,
    lastError: null,
    tokenLast4: "0000",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    fileCount: 1,
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

function makeQaResult(overrides: Partial<QaResult> = {}): QaResult {
  return {
    questionId: "q1",
    question: "Where is add() defined?",
    answer: "The add function is defined in src/app.ts.",
    insufficientEvidence: false,
    sources: [
      {
        filePath: "src/app.ts",
        symbolName: "add",
        startLine: 1,
        endLine: 3,
        score: 0.91,
        cited: true,
      },
    ],
    branch: "master",
    commit: "abc123def456",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/p1/qa"]}>
      <AuthProvider>
        <Routes>
          <Route path="/projects/:id/qa" element={<CodebaseQa />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function mockReady() {
  mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
  mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
  mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: makeIndex() });
}

describe("CodebaseQa — blocked states", () => {
  it("shows a gate when no repository is connected, never calling the index or Q&A endpoints", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: null });
    renderPage();

    expect(await screen.findByText("No repository connected")).toBeInTheDocument();
    expect(mockedCodebaseIndexApi.getCodebaseIndexRequest).not.toHaveBeenCalled();
    expect(mockedQaApi.listQuestionsRequest).not.toHaveBeenCalled();
  });

  it("shows a gate when no codebase is indexed, linking to Settings", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: null });
    renderPage();

    expect(await screen.findByText("Codebase not indexed yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Settings" })).toHaveAttribute("href", "/projects/p1/settings");
    expect(mockedQaApi.listQuestionsRequest).not.toHaveBeenCalled();
  });

  it("shows a gate when the index exists but hasn't completed", async () => {
    mockedProjectsApi.getProjectRequest.mockResolvedValue({ project: PROJECT });
    mockedRepositoryApi.getRepositoryConnectionRequest.mockResolvedValue({ connection: makeConnection() });
    mockedCodebaseIndexApi.getCodebaseIndexRequest.mockResolvedValue({ index: makeIndex({ status: "indexing" }) });
    renderPage();

    expect(await screen.findByText("Codebase not indexed yet")).toBeInTheDocument();
  });
});

describe("CodebaseQa — empty state", () => {
  it("shows example questions when no question has been asked yet", async () => {
    mockReady();
    mockedQaApi.listQuestionsRequest.mockResolvedValue({ questions: [] });
    renderPage();

    expect(await screen.findByText("No questions asked yet")).toBeInTheDocument();
    expect(screen.getByText("Where is authentication implemented?")).toBeInTheDocument();
    expect(screen.getByText("How does PRD generation work?")).toBeInTheDocument();
    expect(screen.getByText("Which files handle GitHub integration?")).toBeInTheDocument();
  });

  it("clicking an example question fills the input", async () => {
    mockReady();
    mockedQaApi.listQuestionsRequest.mockResolvedValue({ questions: [] });
    renderPage();
    await screen.findByText("No questions asked yet");

    const user = userEvent.setup();
    await user.click(screen.getByText("Where is authentication implemented?"));

    expect(screen.getByLabelText("Ask a question about this codebase")).toHaveValue(
      "Where is authentication implemented?",
    );
  });

  it("shows the page's read-only disclaimer", async () => {
    mockReady();
    mockedQaApi.listQuestionsRequest.mockResolvedValue({ questions: [] });
    renderPage();
    await screen.findByText("No questions asked yet");

    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    expect(screen.getByText(/does not modify code, open pull requests/)).toBeInTheDocument();
  });
});

describe("CodebaseQa — loading state", () => {
  it("shows a real, non-fabricated loading message while asking", async () => {
    mockReady();
    mockedQaApi.listQuestionsRequest.mockResolvedValue({ questions: [] });
    let resolveAsk: (value: QaResult) => void = () => {};
    mockedQaApi.askQuestionRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveAsk = resolve;
      }),
    );
    renderPage();
    await screen.findByText("No questions asked yet");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Ask a question about this codebase"), "Where is add() defined?");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(
      await screen.findByText("Searching the indexed codebase, assembling context, and generating an answer…"),
    ).toBeInTheDocument();

    resolveAsk(makeQaResult());
    expect(await screen.findByText("The add function is defined in src/app.ts.")).toBeInTheDocument();
  });
});

describe("CodebaseQa — results state", () => {
  it("renders a prior answer with its sources, citation badge, and branch/commit", async () => {
    mockReady();
    mockedQaApi.listQuestionsRequest.mockResolvedValue({ questions: [makeQaResult()] });
    renderPage();

    expect(await screen.findByText("The add function is defined in src/app.ts.")).toBeInTheDocument();
    expect(screen.getByText("Where is add() defined?")).toBeInTheDocument();
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("add")).toBeInTheDocument();
    expect(screen.getByText("L1–3")).toBeInTheDocument();
    expect(screen.getByText("cited")).toBeInTheDocument();
    expect(screen.getByText(/master@abc123de/)).toBeInTheDocument();
  });

  it("shows an insufficient-evidence note when the answer indicates one", async () => {
    mockReady();
    mockedQaApi.listQuestionsRequest.mockResolvedValue({
      questions: [
        makeQaResult({
          answer: "No relevant code was found in the indexed repository for this question.",
          insufficientEvidence: true,
          sources: [],
        }),
      ],
    });
    renderPage();

    expect(
      await screen.findByText("No relevant code was found in the indexed repository for this question."),
    ).toBeInTheDocument();
    expect(screen.getByText(/didn't have enough evidence/)).toBeInTheDocument();
  });

  it("supports asking a follow-up question, prepending it to the history", async () => {
    mockReady();
    mockedQaApi.listQuestionsRequest.mockResolvedValue({ questions: [makeQaResult({ questionId: "q1" })] });
    mockedQaApi.askQuestionRequest.mockResolvedValue(
      makeQaResult({ questionId: "q2", question: "How does PRD generation work?", answer: "Via ai-service." }),
    );
    renderPage();
    await screen.findByText("Where is add() defined?");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ask a follow-up question" }));
    // Button is disabled with an empty question, so type one first.
    await user.type(screen.getByLabelText("Ask a question about this codebase"), "How does PRD generation work?");
    await user.click(screen.getByRole("button", { name: "Ask a follow-up question" }));

    expect(await screen.findByText("Via ai-service.")).toBeInTheDocument();
    // Both the original and the follow-up remain visible.
    expect(screen.getByText("The add function is defined in src/app.ts.")).toBeInTheDocument();
  });
});

describe("CodebaseQa — error state", () => {
  it("shows the real error and never fabricates an answer on failure", async () => {
    mockReady();
    mockedQaApi.listQuestionsRequest.mockResolvedValue({ questions: [] });
    mockedQaApi.askQuestionRequest.mockRejectedValue(
      new ApiError(400, "NO_COMPLETED_INDEX", "Connect a repository and complete indexing before searching."),
    );
    renderPage();
    await screen.findByText("No questions asked yet");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Ask a question about this codebase"), "Where is add() defined?");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(
      await screen.findByText("Connect a repository and complete indexing before searching."),
    ).toBeInTheDocument();
    // Still showing the empty state — no fabricated answer rendered.
    expect(screen.getByText("No questions asked yet")).toBeInTheDocument();
  });

  it("shows a history-loading error distinctly from an ask error", async () => {
    mockReady();
    mockedQaApi.listQuestionsRequest.mockRejectedValue(new Error("network down"));
    renderPage();

    expect(await screen.findByText("Couldn't load question history.")).toBeInTheDocument();
  });
});

describe("CodebaseQa — no secret leakage", () => {
  it("never renders anything token- or key-shaped from a rendered answer/source", async () => {
    mockReady();
    mockedQaApi.listQuestionsRequest.mockResolvedValue({ questions: [makeQaResult()] });
    renderPage();
    await screen.findByText("The add function is defined in src/app.ts.");

    expect(document.body.textContent).not.toMatch(/ghp_[A-Za-z0-9]/);
    expect(document.body.textContent).not.toMatch(/sk-ant-[A-Za-z0-9]/);
  });
});
