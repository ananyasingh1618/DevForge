import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrdSection } from "./PrdSection.js";
import { ApiError } from "../services/apiClient.js";
import * as requirementsApi from "../services/requirementsApi.js";
import * as prdApi from "../services/prdApi.js";
import type { RequirementsVersion } from "../types/requirements.js";
import type { PrdVersion } from "../types/prd.js";

vi.mock("../services/requirementsApi.js");
vi.mock("../services/prdApi.js");

const mockedRequirementsApi = vi.mocked(requirementsApi);
const mockedPrdApi = vi.mocked(prdApi);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequirementsVersion(
  overrides: Partial<RequirementsVersion> = {},
): RequirementsVersion {
  return {
    id: "rv1",
    projectId: "p1",
    version: 1,
    ideaText: "A weekly personal budgeting app with shared household views.",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: {
      projectSummary: "A weekly personal budgeting app with shared household views.",
      users: ["Individual budgeters"],
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      constraints: [],
      assumptions: [],
      openQuestions: [],
    },
    ...overrides,
  };
}

function makeVersion(overrides: Partial<PrdVersion> = {}): PrdVersion {
  return {
    id: "v1",
    projectId: "p1",
    version: 1,
    sourceRequirementsVersionId: "rv1",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: {
      overview: "A weekly personal budgeting app that helps households track shared spending.",
      problemStatement: "Households struggle to coordinate spending visibility across members.",
      goals: ["Give households a shared weekly view of spending"],
      personas: ["Primary budgeter"],
      functionalRequirements: ["Log an expense against a weekly category"],
      nonFunctionalRequirements: ["Usable offline for logging"],
      userWorkflows: ["User opens app, selects category, logs expense"],
      edgeCases: ["Expense logged while offline syncs once reconnected"],
      successCriteria: ["80% of expenses logged within a day of purchase"],
      constraints: ["Must work offline for logging expenses"],
      assumptions: [],
      openQuestions: [],
    },
    ...overrides,
  };
}

describe("PrdSection — blocked state (no active requirements)", () => {
  it("shows the dependency message and renders no Generate control", async () => {
    mockedRequirementsApi.listRequirementsVersionsRequest.mockResolvedValue({ versions: [] });
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [] });
    render(<PrdSection projectId="p1" />);

    expect(await screen.findByText("Requirements needed first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate/i })).not.toBeInTheDocument();
  });
});

describe("PrdSection — list load failure", () => {
  it("shows an error state with retry", async () => {
    mockedRequirementsApi.listRequirementsVersionsRequest.mockRejectedValue(
      new Error("network down"),
    );
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [] });
    render(<PrdSection projectId="p1" />);

    expect(await screen.findByText("Couldn't load the PRD.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("PrdSection — empty state (requirements active, no PRD yet)", () => {
  it("shows a single Generate button naming the active requirements version", async () => {
    mockedRequirementsApi.listRequirementsVersionsRequest.mockResolvedValue({
      versions: [makeRequirementsVersion()],
    });
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [] });
    render(<PrdSection projectId="p1" />);

    expect(await screen.findByText("No PRD yet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate PRD from Requirements v1" }),
    ).toBeInTheDocument();
  });

  it("generates a PRD and shows it, and does not fabricate content on failure", async () => {
    mockedRequirementsApi.listRequirementsVersionsRequest.mockResolvedValue({
      versions: [makeRequirementsVersion()],
    });
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [] });
    mockedPrdApi.generatePrdRequest.mockRejectedValue(
      new ApiError(503, "AI_PROVIDER_UNAVAILABLE", "No LLM provider is configured."),
    );
    render(<PrdSection projectId="p1" />);
    await screen.findByText("No PRD yet");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Generate PRD from Requirements v1" }));

    expect(await screen.findByText("No LLM provider is configured.")).toBeInTheDocument();
    // Still in the empty state — no fabricated success content rendered.
    expect(screen.getByText("No PRD yet")).toBeInTheDocument();
  });
});

describe("PrdSection — populated state", () => {
  it("renders the active version's content and the version list", async () => {
    mockedRequirementsApi.listRequirementsVersionsRequest.mockResolvedValue({
      versions: [makeRequirementsVersion()],
    });
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [makeVersion()] });
    render(<PrdSection projectId="p1" />);

    expect(
      await screen.findByText(
        "A weekly personal budgeting app that helps households track shared spending.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    // The active version has no "Make active" button.
    expect(screen.queryByRole("button", { name: "Make active" })).not.toBeInTheDocument();
  });

  it("lets the user switch to a non-active version and activate it", async () => {
    mockedRequirementsApi.listRequirementsVersionsRequest.mockResolvedValue({
      versions: [makeRequirementsVersion()],
    });
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({
      versions: [
        makeVersion({ id: "v2", version: 2, isActive: true }),
        makeVersion({ id: "v1", version: 1, isActive: false }),
      ],
    });
    mockedPrdApi.activatePrdVersionRequest.mockResolvedValue({
      version: makeVersion({ id: "v1", version: 1, isActive: true }),
    });
    render(<PrdSection projectId="p1" />);
    await screen.findByText("v2");

    const user = userEvent.setup();
    const versionList = screen.getByText("Versions").closest("div")!;
    await user.click(within(versionList).getByText("v1"));

    const activateButton = await screen.findByRole("button", { name: "Make active" });
    await user.click(activateButton);

    expect(mockedPrdApi.activatePrdVersionRequest).toHaveBeenCalledWith("p1", "v1");
  });

  it("saves edited fields via PATCH and surfaces a server error if it fails", async () => {
    mockedRequirementsApi.listRequirementsVersionsRequest.mockResolvedValue({
      versions: [makeRequirementsVersion()],
    });
    mockedPrdApi.listPrdVersionsRequest.mockResolvedValue({ versions: [makeVersion()] });
    mockedPrdApi.updatePrdVersionRequest.mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "Invalid request"),
    );
    render(<PrdSection projectId="p1" />);
    await screen.findByText(
      "A weekly personal budgeting app that helps households track shared spending.",
    );

    const user = userEvent.setup();
    const overviewBox = screen.getByLabelText("Overview");
    await user.clear(overviewBox);
    await user.type(overviewBox, "An edited overview.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mockedPrdApi.updatePrdVersionRequest).toHaveBeenCalledWith(
      "p1",
      "v1",
      expect.objectContaining({ overview: "An edited overview." }),
    );
    expect(await screen.findByText("Invalid request")).toBeInTheDocument();
  });
});
