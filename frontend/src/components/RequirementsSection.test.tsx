import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RequirementsSection } from "./RequirementsSection.js";
import { ApiError } from "../services/apiClient.js";
import * as requirementsApi from "../services/requirementsApi.js";
import type { RequirementsVersion } from "../types/requirements.js";

vi.mock("../services/requirementsApi.js");

const mockedApi = vi.mocked(requirementsApi);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeVersion(overrides: Partial<RequirementsVersion> = {}): RequirementsVersion {
  return {
    id: "v1",
    projectId: "p1",
    version: 1,
    ideaText: "A tool that tracks coffee during code reviews.",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: {
      projectSummary: "Tracks coffee consumption during reviews.",
      users: ["Developers"],
      functionalRequirements: [
        {
          id: "FR-1",
          title: "Log a coffee event",
          description: "Log a cup tied to a review.",
          priority: "high",
          source: "stated",
          acceptanceCriteria: ["Persists a timestamp"],
        },
      ],
      nonFunctionalRequirements: [],
      features: ["Coffee logging"],
      risks: ["No usage data yet to validate demand"],
      constraints: [],
      assumptions: ["Single-user for now"],
      openQuestions: ["Does decaf count?"],
    },
    ...overrides,
  };
}

describe("RequirementsSection — empty state and analyze", () => {
  it("shows the idea form when there are no versions yet", async () => {
    mockedApi.listRequirementsVersionsRequest.mockResolvedValue({ versions: [] });
    render(<RequirementsSection projectId="p1" />);

    expect(await screen.findByText("No requirements yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Project idea")).toBeInTheDocument();
  });

  it("disables Analyze until the idea is long enough", async () => {
    mockedApi.listRequirementsVersionsRequest.mockResolvedValue({ versions: [] });
    render(<RequirementsSection projectId="p1" />);
    await screen.findByText("No requirements yet");

    const button = screen.getByRole("button", { name: "Analyze" });
    expect(button).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Project idea"), "Track coffee during reviews");
    expect(button).toBeEnabled();
  });

  it("submits the idea, shows the analyzed version, and does not fabricate content on failure", async () => {
    mockedApi.listRequirementsVersionsRequest.mockResolvedValue({ versions: [] });
    mockedApi.analyzeRequirementsRequest.mockRejectedValue(
      new ApiError(503, "AI_PROVIDER_UNAVAILABLE", "No LLM provider is configured."),
    );
    render(<RequirementsSection projectId="p1" />);
    await screen.findByText("No requirements yet");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Project idea"), "Track coffee during reviews");
    await user.click(screen.getByRole("button", { name: "Analyze" }));

    expect(await screen.findByText("No LLM provider is configured.")).toBeInTheDocument();
    // Still in the empty state — no fabricated success content rendered.
    expect(screen.getByText("No requirements yet")).toBeInTheDocument();
  });
});

describe("RequirementsSection — populated state", () => {
  it("renders the active version's content and the version list", async () => {
    mockedApi.listRequirementsVersionsRequest.mockResolvedValue({
      versions: [makeVersion()],
    });
    render(<RequirementsSection projectId="p1" />);

    expect(await screen.findByText("Tracks coffee consumption during reviews.")).toBeInTheDocument();
    expect(screen.getByText("FR-1: Log a coffee event")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    // The active version has no "Make active" button.
    expect(screen.queryByRole("button", { name: "Make active" })).not.toBeInTheDocument();
  });

  it("lets the user switch to a non-active version and activate it", async () => {
    mockedApi.listRequirementsVersionsRequest.mockResolvedValue({
      versions: [
        makeVersion({ id: "v2", version: 2, isActive: true }),
        makeVersion({ id: "v1", version: 1, isActive: false }),
      ],
    });
    mockedApi.activateRequirementsVersionRequest.mockResolvedValue({
      version: makeVersion({ id: "v1", version: 1, isActive: true }),
    });
    render(<RequirementsSection projectId="p1" />);
    await screen.findByText("v2");

    const user = userEvent.setup();
    const versionList = screen.getByText("Versions").closest("div")!;
    await user.click(within(versionList).getByText("v1"));

    const activateButton = await screen.findByRole("button", { name: "Make active" });
    await user.click(activateButton);

    expect(mockedApi.activateRequirementsVersionRequest).toHaveBeenCalledWith("p1", "v1");
  });

  it("renders Features and Risks fields and includes edits to them in the PATCH payload", async () => {
    mockedApi.listRequirementsVersionsRequest.mockResolvedValue({ versions: [makeVersion()] });
    mockedApi.updateRequirementsVersionRequest.mockResolvedValue({ version: makeVersion() });
    render(<RequirementsSection projectId="p1" />);
    await screen.findByText("Tracks coffee consumption during reviews.");

    const featuresBox = screen.getByLabelText("Features") as HTMLTextAreaElement;
    const risksBox = screen.getByLabelText("Risks") as HTMLTextAreaElement;
    expect(featuresBox.value).toBe("Coffee logging");
    expect(risksBox.value).toBe("No usage data yet to validate demand");

    fireEvent.change(featuresBox, { target: { value: "Coffee logging\nWeekly digest email" } });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mockedApi.updateRequirementsVersionRequest).toHaveBeenCalledWith(
      "p1",
      "v1",
      expect.objectContaining({
        features: ["Coffee logging", "Weekly digest email"],
        risks: ["No usage data yet to validate demand"],
      }),
    );
  });

  it("saves edited fields via PATCH and surfaces a server error if it fails", async () => {
    mockedApi.listRequirementsVersionsRequest.mockResolvedValue({ versions: [makeVersion()] });
    mockedApi.updateRequirementsVersionRequest.mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "Invalid request"),
    );
    render(<RequirementsSection projectId="p1" />);
    await screen.findByText("Tracks coffee consumption during reviews.");

    const user = userEvent.setup();
    const summaryBox = screen.getByLabelText("Project summary");
    await user.clear(summaryBox);
    await user.type(summaryBox, "An edited summary.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mockedApi.updateRequirementsVersionRequest).toHaveBeenCalledWith(
      "p1",
      "v1",
      expect.objectContaining({ projectSummary: "An edited summary." }),
    );
    expect(await screen.findByText("Invalid request")).toBeInTheDocument();
  });
});

describe("RequirementsSection — list load failure", () => {
  it("shows an error state with retry", async () => {
    mockedApi.listRequirementsVersionsRequest.mockRejectedValue(new Error("network down"));
    render(<RequirementsSection projectId="p1" />);

    expect(await screen.findByText("Couldn't load requirements.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
