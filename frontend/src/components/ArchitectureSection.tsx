import { useCallback, useEffect, useState } from "react";
import { Button } from "./Button.js";
import { EmptyState, ErrorState, LoadingState } from "./StateViews.js";
import { ApiError } from "../services/apiClient.js";
import {
  activateArchitectureVersionRequest,
  generateArchitectureRequest,
  listArchitectureVersionsRequest,
  updateArchitectureVersionRequest,
} from "../services/architectureApi.js";
import { listPrdVersionsRequest } from "../services/prdApi.js";
import type { ArchitectureContent, ArchitectureVersion } from "../types/architecture.js";

function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function listToLines(items: string[]): string {
  return items.join("\n");
}

const arrayFields = [
  ["technologyStack", "Technology stack"],
  ["components", "Components"],
  ["dataModel", "Data model"],
  ["apiDesign", "API design"],
  ["dataFlows", "Data flows"],
  ["security", "Security"],
  ["scalability", "Scalability"],
  ["deployment", "Deployment"],
  ["tradeoffs", "Tradeoffs"],
  ["assumptions", "Assumptions"],
  ["openQuestions", "Open questions"],
] as const;

/**
 * Rendered with `key={version.id}` by the parent, so switching which
 * version is selected remounts this component with fresh state — same
 * technique PrdSection's VersionDetail uses, for the same reason (avoids an
 * effect+setState that eslint-plugin-react-hooks flags).
 */
function VersionDetail({
  projectId,
  version,
  onActivated,
  onSaved,
}: {
  projectId: string;
  version: ArchitectureVersion;
  onActivated: (version: ArchitectureVersion) => void;
  onSaved: (version: ArchitectureVersion) => void;
}) {
  const [draft, setDraft] = useState<ArchitectureContent>(version.content);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  async function handleActivate() {
    setActivating(true);
    try {
      const { version: activated } = await activateArchitectureVersionRequest(
        projectId,
        version.id,
      );
      onActivated(activated);
    } catch {
      // Matches PrdSection: the button simply re-enables on failure.
    } finally {
      setActivating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const { version: saved } = await updateArchitectureVersionRequest(
        projectId,
        version.id,
        draft,
      );
      onSaved(saved);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't save your changes. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-text-muted">
          Version {version.version}
          {version.isActive && " (active)"}
        </h3>
        {!version.isActive && (
          <Button type="button" variant="secondary" loading={activating} onClick={handleActivate}>
            Make active
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="arch-overview" className="text-sm font-medium text-text">
          Overview
        </label>
        <textarea
          id="arch-overview"
          rows={3}
          value={draft.overview}
          onChange={(e) => setDraft({ ...draft, overview: e.target.value })}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="arch-system-architecture" className="text-sm font-medium text-text">
          System architecture
        </label>
        <textarea
          id="arch-system-architecture"
          rows={3}
          value={draft.systemArchitecture}
          onChange={(e) => setDraft({ ...draft, systemArchitecture: e.target.value })}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {arrayFields.map(([field, label]) => (
          <div key={field} className="flex flex-col gap-1.5">
            <label htmlFor={`arch-${field}`} className="text-sm font-medium text-text">
              {label}
            </label>
            <textarea
              id={`arch-${field}`}
              rows={3}
              value={listToLines(draft[field])}
              onChange={(e) => setDraft({ ...draft, [field]: linesToList(e.target.value) })}
              placeholder="One per line"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
            />
          </div>
        ))}
      </div>

      {saveError && (
        <p className="text-sm text-danger" role="alert">
          {saveError}
        </p>
      )}
      <div>
        <Button type="button" loading={saving} onClick={handleSave}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

type SectionState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "blocked" }
  | { status: "ready"; activePrdVersionNumber: number; versions: ArchitectureVersion[] };

export function ArchitectureSection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<SectionState>({ status: "loading" });
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Fetches the PRD list and this section's own list independently —
  // ArchitectureSection stays self-contained rather than being coupled to
  // PrdSection's state. Because at most one PRD version is ever active and
  // there is no PRD-deletion endpoint, "no active PRD" is exactly "the PRD
  // version list is empty".
  const fetchAll = useCallback(() => {
    Promise.all([listPrdVersionsRequest(projectId), listArchitectureVersionsRequest(projectId)])
      .then(([{ versions: prdVersions }, { versions }]) => {
        const activePrd = prdVersions.find((v) => v.isActive);
        if (!activePrd) {
          setState({ status: "blocked" });
          return;
        }
        setState({
          status: "ready",
          activePrdVersionNumber: activePrd.version,
          versions,
        });
        setSelectedVersionId((current) => {
          if (current && versions.some((v) => v.id === current)) return current;
          return versions.find((v) => v.isActive)?.id ?? versions[0]?.id ?? null;
        });
      })
      .catch(() => setState({ status: "error", message: "Couldn't load the architecture." }));
  }, [projectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    fetchAll();
  }, [fetchAll]);

  const selectedVersion =
    state.status === "ready" ? state.versions.find((v) => v.id === selectedVersionId) : undefined;

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const { version } = await generateArchitectureRequest(projectId);
      setState((prev) =>
        prev.status === "ready"
          ? {
              ...prev,
              versions: [version, ...prev.versions.map((v) => ({ ...v, isActive: false }))],
            }
          : prev,
      );
      setSelectedVersionId(version.id);
    } catch (err) {
      setGenerateError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setGenerating(false);
    }
  }

  function replaceVersion(updated: ArchitectureVersion, deactivateOthers: boolean) {
    setState((prev) =>
      prev.status === "ready"
        ? {
            ...prev,
            versions: prev.versions.map((v) =>
              v.id === updated.id ? updated : deactivateOthers ? { ...v, isActive: false } : v,
            ),
          }
        : prev,
    );
  }

  if (state.status === "loading") {
    return <LoadingState label="Loading architecture…" />;
  }

  if (state.status === "error") {
    return <ErrorState message={state.message} onRetry={retry} />;
  }

  // No Generate control is ever rendered here — the dependency is
  // communicated, not offered as a control that would fail on click.
  if (state.status === "blocked") {
    return (
      <EmptyState
        title="PRD needed first"
        description="Generate and activate a PRD version above, then come back here to generate an architecture."
      />
    );
  }

  if (state.versions.length === 0) {
    return (
      <EmptyState
        title="No architecture yet"
        description={`Generate an architecture from the active PRD (v${state.activePrdVersionNumber}).`}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button type="button" loading={generating} onClick={handleGenerate}>
              {`Generate architecture from PRD v${state.activePrdVersionNumber}`}
            </Button>
            {generateError && (
              <p className="text-sm text-danger" role="alert">
                {generateError}
              </p>
            )}
          </div>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="w-full shrink-0 lg:w-56">
        <h3 className="text-sm font-medium text-text-muted">Versions</h3>
        <ul className="mt-2 flex flex-col gap-1">
          {state.versions.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => setSelectedVersionId(v.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                  v.id === selectedVersionId
                    ? "bg-surface-2 text-text"
                    : "text-text-muted hover:bg-surface-2 hover:text-text"
                }`}
              >
                <span>v{v.version}</span>
                {v.isActive && (
                  <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent">
                    active
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="secondary"
          loading={generating}
          className="mt-4 w-full"
          onClick={handleGenerate}
        >
          {`Regenerate from PRD v${state.activePrdVersionNumber}`}
        </Button>
        {generateError && (
          <p className="mt-2 text-sm text-danger" role="alert">
            {generateError}
          </p>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {selectedVersion && (
          <VersionDetail
            key={selectedVersion.id}
            projectId={projectId}
            version={selectedVersion}
            onActivated={(updated) => replaceVersion(updated, true)}
            onSaved={(updated) => replaceVersion(updated, false)}
          />
        )}
      </div>
    </div>
  );
}
