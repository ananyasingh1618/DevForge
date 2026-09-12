import { useCallback, useEffect, useState } from "react";
import { Button } from "./Button.js";
import { Card } from "./Card.js";
import { EmptyState, ErrorState, LoadingState } from "./StateViews.js";
import { ApiError } from "../services/apiClient.js";
import {
  activateEpicVersionRequest,
  generateEpicsRequest,
  listEpicVersionsRequest,
  updateEpicVersionRequest,
} from "../services/epicsApi.js";
import { listArchitectureVersionsRequest } from "../services/architectureApi.js";
import type { EpicContent, EpicItem, EpicVersion } from "../types/epics.js";

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
  ["acceptanceCriteria", "Acceptance criteria"],
  ["dependencies", "Dependencies (other epic ids)"],
  ["relatedComponents", "Related components"],
] as const;

/**
 * One editable card per epic — content is entirely an item list (no flat
 * document fields to edit, unlike PrdSection/ArchitectureSection), so each
 * item gets its own card with every field editable. No add/remove-item
 * control: structural changes happen by regenerating a new version, the
 * same documented scope boundary Phase 2 used for requirement items.
 */
function EpicCard({
  epic,
  onChange,
}: {
  epic: EpicItem;
  onChange: (updated: EpicItem) => void;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted">
          {epic.id}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`epic-${epic.id}-title`} className="text-sm font-medium text-text">
          Title
        </label>
        <input
          id={`epic-${epic.id}-title`}
          type="text"
          value={epic.title}
          onChange={(e) => onChange({ ...epic, title: e.target.value })}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
        />
      </div>

      {(
        [
          ["description", "Description"],
          ["objective", "Objective"],
          ["businessValue", "Business value"],
          ["scope", "Scope"],
        ] as const
      ).map(([field, label]) => (
        <div key={field} className="flex flex-col gap-1.5">
          <label htmlFor={`epic-${epic.id}-${field}`} className="text-sm font-medium text-text">
            {label}
          </label>
          <textarea
            id={`epic-${epic.id}-${field}`}
            rows={2}
            value={epic[field]}
            onChange={(e) => onChange({ ...epic, [field]: e.target.value })}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
          />
        </div>
      ))}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {arrayFields.map(([field, label]) => (
          <div key={field} className="flex flex-col gap-1.5">
            <label htmlFor={`epic-${epic.id}-${field}`} className="text-sm font-medium text-text">
              {label}
            </label>
            <textarea
              id={`epic-${epic.id}-${field}`}
              rows={3}
              value={listToLines(epic[field])}
              onChange={(e) => onChange({ ...epic, [field]: linesToList(e.target.value) })}
              placeholder="One per line"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Rendered with `key={version.id}` by the parent, so switching which
 * version is selected remounts this component with fresh state — same
 * technique every prior artifact's VersionDetail uses.
 */
function VersionDetail({
  projectId,
  version,
  onActivated,
  onSaved,
}: {
  projectId: string;
  version: EpicVersion;
  onActivated: (version: EpicVersion) => void;
  onSaved: (version: EpicVersion) => void;
}) {
  const [draft, setDraft] = useState<EpicContent>(version.content);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  function updateEpic(index: number, updated: EpicItem) {
    setDraft({ epics: draft.epics.map((e, i) => (i === index ? updated : e)) });
  }

  async function handleActivate() {
    setActivating(true);
    try {
      const { version: activated } = await activateEpicVersionRequest(projectId, version.id);
      onActivated(activated);
    } catch {
      // Matches every prior VersionDetail: the button simply re-enables on failure.
    } finally {
      setActivating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const { version: saved } = await updateEpicVersionRequest(projectId, version.id, draft);
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

      <div className="flex flex-col gap-4">
        {draft.epics.map((epic, index) => (
          <EpicCard key={epic.id} epic={epic} onChange={(updated) => updateEpic(index, updated)} />
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
  | { status: "ready"; activeArchitectureVersionNumber: number; versions: EpicVersion[] };

export function EpicSection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<SectionState>({ status: "loading" });
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Fetches the architecture list and this section's own list independently
  // — EpicSection stays self-contained rather than being coupled to
  // ArchitectureSection's state. Because at most one architecture version is
  // ever active and there is no architecture-deletion endpoint, "no active
  // architecture" is exactly "the architecture version list is empty".
  const fetchAll = useCallback(() => {
    Promise.all([listArchitectureVersionsRequest(projectId), listEpicVersionsRequest(projectId)])
      .then(([{ versions: architectureVersions }, { versions }]) => {
        const activeArchitecture = architectureVersions.find((v) => v.isActive);
        if (!activeArchitecture) {
          setState({ status: "blocked" });
          return;
        }
        setState({
          status: "ready",
          activeArchitectureVersionNumber: activeArchitecture.version,
          versions,
        });
        setSelectedVersionId((current) => {
          if (current && versions.some((v) => v.id === current)) return current;
          return versions.find((v) => v.isActive)?.id ?? versions[0]?.id ?? null;
        });
      })
      .catch(() => setState({ status: "error", message: "Couldn't load epics." }));
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
      const { version } = await generateEpicsRequest(projectId);
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

  function replaceVersion(updated: EpicVersion, deactivateOthers: boolean) {
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
    return <LoadingState label="Loading epics…" />;
  }

  if (state.status === "error") {
    return <ErrorState message={state.message} onRetry={retry} />;
  }

  // No Generate control is ever rendered here — the dependency is
  // communicated, not offered as a control that would fail on click.
  if (state.status === "blocked") {
    return (
      <EmptyState
        title="Architecture needed first"
        description="Generate and activate an architecture version above, then come back here to generate epics."
      />
    );
  }

  if (state.versions.length === 0) {
    return (
      <EmptyState
        title="No epics yet"
        description={`Generate epics from the active architecture (v${state.activeArchitectureVersionNumber}).`}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button type="button" loading={generating} onClick={handleGenerate}>
              {`Generate epics from Architecture v${state.activeArchitectureVersionNumber}`}
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
          {`Regenerate from Architecture v${state.activeArchitectureVersionNumber}`}
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
