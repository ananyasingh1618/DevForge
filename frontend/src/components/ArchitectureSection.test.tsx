import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArchitectureSection } from "./ArchitectureSection.js";
import { ApiError } from "../services/apiClient.js";
import * as prdApi from "../services/prdApi.js";
import * as architectureApi from "../services/architectureApi.js";
import type { PrdVersion } from "../types/prd.js";
import type { ArchitectureVersion } from "../types/architecture.js";

vi.mock("../services/prdApi.js");
vi.mock("../services/architectureApi.js");

const mockedPrdApi = vi.mocked(prdApi);
const mockedArchitectureApi = vi.mocked(architectureApi);

beforeEach(() => {
  vi.clearAllMocks();
});

function makePrdVersion(overrides: Partial<PrdVersion> = {}): PrdVersion {
  return {
    id: "pv1",
    projectId: "p1",
    version: 1,
    sourceRequirementsVersionId: "rv1",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: {
      overview: "A weekly personal budgeting app that helps households track shared spending.",
      problemStatement: "Households struggle to coordinate spending visibility across members.",
      goals: [],
      personas: [],
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      userWorkflows: [],
      edgeCases: [],
      successCriteria: [],
      constraints: [],
      assumptions: [],
      openQuestions: [],
    },
    ...overrides,
  };
}

function makeVersion(overrides: Partial<ArchitectureVersion> = {}): ArchitectureVersion {
  return {
    id: "v1",
    projectId: "p1",
    version: 1,
    sourcePrdVersionId: "pv1",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: {
      overview: "A single-page app backed by a small REST API and a relational database.",
      systemArchitecture: "A modular monolith: one backend service handling auth, logging, and stats.",
      technologyStack: ["React frontend", "Node/Express API", "PostgreSQL"],
      components: ["API service — validates and persists expense events"],
      dataModel: ["Expense belongs to a Household"],
      apiDesign: ["POST /expenses — log an expense"],
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

describe("ArchitectureSection — blocked state (no active PRD)", () => {
  it("shows the dependency message and renders no Generate control", async () => {
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [] });
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({ versions: [] });
    render(<ArchitectureSection projectId="p1" />);

    expect(await screen.findByText("PRD needed first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate/i })).not.toBeInTheDocument();
  });
});

describe("ArchitectureSection — list load failure", () => {
  it("shows an error state with retry", async () => {
    mockedPrdApi.listPrdVersionsRequest.mockRejectedValue(new Error("network down"));
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({ versions: [] });
    render(<ArchitectureSection projectId="p1" />);

    expect(await screen.findByText("Couldn't load the architecture.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("ArchitectureSection — empty state (PRD active, no architecture yet)", () => {
  it("shows a single Generate button naming the active PRD version", async () => {
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [makePrdVersion()] });
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({ versions: [] });
    render(<ArchitectureSection projectId="p1" />);

    expect(await screen.findByText("No architecture yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate architecture from PRD v1" }),
    ).toBeInTheDocument();
  });

  it("generates an architecture and shows it, and does not fabricate content on failure", async () => {
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [makePrdVersion()] });
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({ versions: [] });
    mockedArchitectureApi.generateArchitectureRequest.mockRejectedValue(
      new ApiError(503, "AI_PROVIDER_UNAVAILABLE", "No LLM provider is configured."),
    );
    render(<ArchitectureSection projectId="p1" />);
    await screen.findByText("No architecture yet");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Generate architecture from PRD v1" }));

    expect(await screen.findByText("No LLM provider is configured.")).toBeInTheDocument();
    // Still in the empty state — no fabricated success content rendered.
    expect(screen.getByText("No architecture yet")).toBeInTheDocument();
  });
});

describe("ArchitectureSection — populated state", () => {
  it("renders the active version's content and the version list", async () => {
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [makePrdVersion()] });
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({
      versions: [makeVersion()],
    });
    render(<ArchitectureSection projectId="p1" />);

    expect(
      await screen.findByText(
        "A single-page app backed by a small REST API and a relational database.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    // The active version has no "Make active" button.
    expect(screen.queryByRole("button", { name: "Make active" })).not.toBeInTheDocument();
  });

  it("lets the user switch to a non-active version and activate it", async () => {
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [makePrdVersion()] });
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({
      versions: [
        makeVersion({ id: "v2", version: 2, isActive: true }),
        makeVersion({ id: "v1", version: 1, isActive: false }),
      ],
    });
    mockedArchitectureApi.activateArchitectureVersionRequest.mockResolvedValue({
      version: makeVersion({ id: "v1", version: 1, isActive: true }),
    });
    render(<ArchitectureSection projectId="p1" />);
    await screen.findByText("v2");

    const user = userEvent.setup();
    const versionList = screen.getByText("Versions").closest("div")!;
    await user.click(within(versionList).getByText("v1"));

    const activateButton = await screen.findByRole("button", { name: "Make active" });
    await user.click(activateButton);

    expect(mockedArchitectureApi.activateArchitectureVersionRequest).toHaveBeenCalledWith(
      "p1",
      "v1",
    );
  });

  it("saves edited fields via PATCH and surfaces a server error if it fails", async () => {
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [makePrdVersion()] });
    mockedArchitectureApi.listArchitectureVersionsRequest.mockResolvedValue({
      versions: [makeVersion()],
    });
    mockedArchitectureApi.updateArchitectureVersionRequest.mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "Invalid request"),
    );
    render(<ArchitectureSection projectId="p1" />);
    await screen.findByText(
      "A single-page app backed by a small REST API and a relational database.",
    );

    const user = userEvent.setup();
    const overviewBox = screen.getByLabelText("Overview");
    await user.clear(overviewBox);
    await user.type(overviewBox, "An edited overview.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mockedArchitectureApi.updateArchitectureVersionRequest).toHaveBeenCalledWith(
      "p1",
      "v1",
      expect.objectContaining({ overview: "An edited overview." }),
    );
    expect(await screen.findByText("Invalid request")).toBeInTheDocument();
  });
});
