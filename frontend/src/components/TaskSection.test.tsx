import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskSection } from "./TaskSection.js";
import { ApiError } from "../services/apiClient.js";
import * as epicsApi from "../services/epicsApi.js";
import * as tasksApi from "../services/tasksApi.js";
import type { EpicVersion } from "../types/epics.js";
import type { TaskVersion } from "../types/tasks.js";

vi.mock("../services/epicsApi.js");
vi.mock("../services/tasksApi.js");

const mockedEpicsApi = vi.mocked(epicsApi);
const mockedTasksApi = vi.mocked(tasksApi);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeEpicVersion(overrides: Partial<EpicVersion> = {}): EpicVersion {
  return {
    id: "ev1",
    projectId: "p1",
    version: 1,
    sourceArchitectureVersionId: "av1",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: {
      epics: [
        {
          id: "EP-1",
          title: "Expense logging",
          description: "Let users log expenses against weekly categories.",
          objective: "Users can record an expense quickly.",
          businessValue: "Core value proposition.",
          scope: "Expense creation and category assignment.",
          acceptanceCriteria: [],
          dependencies: [],
          relatedComponents: [],
        },
      ],
    },
    ...overrides,
  };
}

function makeVersion(overrides: Partial<TaskVersion> = {}): TaskVersion {
  return {
    id: "v1",
    projectId: "p1",
    version: 1,
    sourceEpicVersionId: "ev1",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: {
      tasks: [
        {
          id: "T-1",
          title: "Add POST /expenses endpoint",
          description: "Create an endpoint that persists a new expense.",
          type: "feature",
          priority: "high",
          acceptanceCriteria: ["Posting a valid expense returns 201"],
          dependencies: [],
          epicId: "EP-1",
          relatedComponent: "API service",
          estimatedComplexity: "small",
          suggestedOrder: 1,
        },
      ],
    },
    ...overrides,
  };
}

describe("TaskSection — blocked state (no active epics)", () => {
  it("shows the dependency message and renders no Generate control", async () => {
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [] });
    mockedTasksApi.listTaskVersionsRequest.mockResolvedValue({ versions: [] });
    render(<TaskSection projectId="p1" />);

    expect(await screen.findByText("Epics needed first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate/i })).not.toBeInTheDocument();
  });
});

describe("TaskSection — list load failure", () => {
  it("shows an error state with retry", async () => {
    mockedEpicsApi.listEpicVersionsRequest.mockRejectedValue(new Error("network down"));
    mockedTasksApi.listTaskVersionsRequest.mockResolvedValue({ versions: [] });
    render(<TaskSection projectId="p1" />);

    expect(await screen.findByText("Couldn't load tasks.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("TaskSection — empty state (epics active, no tasks yet)", () => {
  it("shows a single Generate button naming the active epic version", async () => {
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [makeEpicVersion()] });
    mockedTasksApi.listTaskVersionsRequest.mockResolvedValue({ versions: [] });
    render(<TaskSection projectId="p1" />);

    expect(await screen.findByText("No tasks yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate tasks from Epics v1" }),
    ).toBeInTheDocument();
  });

  it("generates tasks and shows them, and does not fabricate content on failure", async () => {
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [makeEpicVersion()] });
    mockedTasksApi.listTaskVersionsRequest.mockResolvedValue({ versions: [] });
    mockedTasksApi.generateTasksRequest.mockRejectedValue(
      new ApiError(503, "AI_PROVIDER_UNAVAILABLE", "No LLM provider is configured."),
    );
    render(<TaskSection projectId="p1" />);
    await screen.findByText("No tasks yet");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Generate tasks from Epics v1" }));

    expect(await screen.findByText("No LLM provider is configured.")).toBeInTheDocument();
    // Still in the empty state — no fabricated success content rendered.
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
  });
});

describe("TaskSection — populated state", () => {
  it("renders the active version's task cards and the version list", async () => {
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [makeEpicVersion()] });
    mockedTasksApi.listTaskVersionsRequest.mockResolvedValue({ versions: [makeVersion()] });
    render(<TaskSection projectId="p1" />);

    expect(await screen.findByText("T-1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Add POST /expenses endpoint")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    // The active version has no "Make active" button.
    expect(screen.queryByRole("button", { name: "Make active" })).not.toBeInTheDocument();
  });

  it("lets the user switch to a non-active version and activate it", async () => {
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [makeEpicVersion()] });
    mockedTasksApi.listTaskVersionsRequest.mockResolvedValue({
      versions: [
        makeVersion({ id: "v2", version: 2, isActive: true }),
        makeVersion({ id: "v1", version: 1, isActive: false }),
      ],
    });
    mockedTasksApi.activateTaskVersionRequest.mockResolvedValue({
      version: makeVersion({ id: "v1", version: 1, isActive: true }),
    });
    render(<TaskSection projectId="p1" />);
    await screen.findByText("v2");

    const user = userEvent.setup();
    const versionList = screen.getByText("Versions").closest("div")!;
    await user.click(within(versionList).getByText("v1"));

    const activateButton = await screen.findByRole("button", { name: "Make active" });
    await user.click(activateButton);

    expect(mockedTasksApi.activateTaskVersionRequest).toHaveBeenCalledWith("p1", "v1");
  });

  it("saves edited item fields via PATCH and surfaces a server error if it fails", async () => {
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [makeEpicVersion()] });
    mockedTasksApi.listTaskVersionsRequest.mockResolvedValue({ versions: [makeVersion()] });
    mockedTasksApi.updateTaskVersionRequest.mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "Invalid request"),
    );
    render(<TaskSection projectId="p1" />);
    await screen.findByText("T-1");

    const user = userEvent.setup();
    const titleBox = screen.getByLabelText("Title");
    await user.clear(titleBox);
    await user.type(titleBox, "Edited title");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mockedTasksApi.updateTaskVersionRequest).toHaveBeenCalledWith(
      "p1",
      "v1",
      expect.objectContaining({
        tasks: [expect.objectContaining({ id: "T-1", title: "Edited title" })],
      }),
    );
    expect(await screen.findByText("Invalid request")).toBeInTheDocument();
  });

  it("lets the user change a task's type via the select control", async () => {
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [makeEpicVersion()] });
    mockedTasksApi.listTaskVersionsRequest.mockResolvedValue({ versions: [makeVersion()] });
    mockedTasksApi.updateTaskVersionRequest.mockResolvedValue({ version: makeVersion() });
    render(<TaskSection projectId="p1" />);
    await screen.findByText("T-1");

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Type"), "chore");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mockedTasksApi.updateTaskVersionRequest).toHaveBeenCalledWith(
      "p1",
      "v1",
      expect.objectContaining({
        tasks: [expect.objectContaining({ id: "T-1", type: "chore" })],
      }),
    );
  });
});
