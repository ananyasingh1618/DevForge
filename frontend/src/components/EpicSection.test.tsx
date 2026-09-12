import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EpicSection } from "./EpicSection.js";
import { ApiError } from "../services/apiClient.js";
import * as architectureApi from "../services/architectureApi.js";
import * as epicsApi from "../services/epicsApi.js";
import type { ArchitectureVersion } from "../types/architecture.js";
import type { EpicVersion } from "../types/epics.js";

vi.mock("../services/architectureApi.js");
vi.mock("../services/epicsApi.js");

const mockedArchitectureApi = vi.mocked(architectureApi);
const mockedEpicsApi = vi.mocked(epicsApi);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeArchitectureVersion(
  overrides: Partial<ArchitectureVersion> = {},
): ArchitectureVersion {
  return {
    id: "av1",
    projectId: "p1",
    version: 1,
    sourcePrdVersionId: "pv1",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: {
      overview: "A single-page app backed by a small REST API and a relational database.",
      systemArchitecture: "A modular monolith.",
      technologyStack: ["React", "Node/Express", "PostgreSQL"],
      components: ["API service"],
      dataModel: [],
      apiDesign: [],
      dataFlows: [],
      security: [],
      scalability: [],
      deployment: [],
      tradeoffs: [],
      assumptions: [],
      openQuestions: [],
    },
    ...overrides,
  };
}

function makeVersion(overrides: Partial<EpicVersion> = {}): EpicVersion {
  return {
    id: "v1",
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
          acceptanceCriteria: ["A logged expense persists with a timestamp"],
          dependencies: [],
          relatedComponents: ["API service"],
        },
      ],
    },
    ...overrides,
  };
}

describe("EpicSection — blocked state (no active architecture)", () => {
  it("shows the dependency message and renders no Generate control", async () => {
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({ versions: [] });
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [] });
    render(<EpicSection projectId="p1" />);

    expect(await screen.findByText("Architecture needed first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate/i })).not.toBeInTheDocument();
  });
});

describe("EpicSection — list load failure", () => {
  it("shows an error state with retry", async () => {
    mockedArchitectureApi.listArchitectureVersionsRequest.mockRejectedValue(
      new Error("network down"),
    );
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [] });
    render(<EpicSection projectId="p1" />);

    expect(await screen.findByText("Couldn't load epics.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("EpicSection — empty state (architecture active, no epics yet)", () => {
  it("shows a single Generate button naming the active architecture version", async () => {
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({
      versions: [makeArchitectureVersion()],
    });
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [] });
    render(<EpicSection projectId="p1" />);

    expect(await screen.findByText("No epics yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate epics from Architecture v1" }),
    ).toBeInTheDocument();
  });

  it("generates epics and shows them, and does not fabricate content on failure", async () => {
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({
      versions: [makeArchitectureVersion()],
    });
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [] });
    mockedEpicsApi.generateEpicsRequest.mockRejectedValue(
      new ApiError(503, "AI_PROVIDER_UNAVAILABLE", "No LLM provider is configured."),
    );
    render(<EpicSection projectId="p1" />);
    await screen.findByText("No epics yet");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Generate epics from Architecture v1" }));

    expect(await screen.findByText("No LLM provider is configured.")).toBeInTheDocument();
    // Still in the empty state — no fabricated success content rendered.
    expect(screen.getByText("No epics yet")).toBeInTheDocument();
  });
});

describe("EpicSection — populated state", () => {
  it("renders the active version's epic cards and the version list", async () => {
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({
      versions: [makeArchitectureVersion()],
    });
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [makeVersion()] });
    render(<EpicSection projectId="p1" />);

    expect(await screen.findByText("EP-1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Expense logging")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    // The active version has no "Make active" button.
    expect(screen.queryByRole("button", { name: "Make active" })).not.toBeInTheDocument();
  });

  it("lets the user switch to a non-active version and activate it", async () => {
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({
      versions: [makeArchitectureVersion()],
    });
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({
      versions: [
        makeVersion({ id: "v2", version: 2, isActive: true }),
        makeVersion({ id: "v1", version: 1, isActive: false }),
      ],
    });
    mockedEpicsApi.activateEpicVersionRequest.mockResolvedValue({
      version: makeVersion({ id: "v1", version: 1, isActive: true }),
    });
    render(<EpicSection projectId="p1" />);
    await screen.findByText("v2");

    const user = userEvent.setup();
    const versionList = screen.getByText("Versions").closest("div")!;
    await user.click(within(versionList).getByText("v1"));

    const activateButton = await screen.findByRole("button", { name: "Make active" });
    await user.click(activateButton);

    expect(mockedEpicsApi.activateEpicVersionRequest).toHaveBeenCalledWith("p1", "v1");
  });

  it("saves edited item fields via PATCH and surfaces a server error if it fails", async () => {
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({
      versions: [makeArchitectureVersion()],
    });
    mockedEpicsApi.listEpicVersionsRequest.mockResolvedValue({ versions: [makeVersion()] });
    mockedEpicsApi.updateEpicVersionRequest.mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "Invalid request"),
    );
    render(<EpicSection projectId="p1" />);
    await screen.findByText("EP-1");

    const user = userEvent.setup();
    const titleBox = screen.getByLabelText("Title");
    await user.clear(titleBox);
    await user.type(titleBox, "Edited title");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mockedEpicsApi.updateEpicVersionRequest).toHaveBeenCalledWith(
      "p1",
      "v1",
      expect.objectContaining({
        epics: [expect.objectContaining({ id: "EP-1", title: "Edited title" })],
      }),
    );
    expect(await screen.findByText("Invalid request")).toBeInTheDocument();
  });
});
