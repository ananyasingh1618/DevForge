import { useCallback, useEffect, useState } from "react";
import { Button } from "./Button.js";
import { Card } from "./Card.js";
import { EmptyState, ErrorState, LoadingState } from "./StateViews.js";
import { ApiError } from "../services/apiClient.js";
import {
  activateRequirementsVersionRequest,
  analyzeRequirementsRequest,
  listRequirementsVersionsRequest,
  updateRequirementsVersionRequest,
} from "../services/requirementsApi.js";
import type { RequirementItem, RequirementsContent, RequirementsVersion } from "../types/requirements.js";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; versions: RequirementsVersion[] };

function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function listToLines(items: string[]): string {
  return items.join("\n");
}

const priorityStyles: Record<RequirementItem["priority"], string> = {
  high: "bg-danger/15 text-danger",
  medium: "bg-surface-2 text-text-muted",
  low: "bg-surface-2 text-text-muted",
};

function RequirementItemCard({ item }: { item: RequirementItem }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-text">
          {item.id}: {item.title}
        </span>
        <div className="flex shrink-0 gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityStyles[item.priority]}`}>
            {item.priority}
          </span>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted">
            {item.source}
          </span>
        </div>
      </div>
      <p className="mt-1 text-sm text-text-muted">{item.description}</p>
      {item.acceptanceCriteria.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-xs text-text-muted">
          {item.acceptanceCriteria.map((criterion, i) => (
            <li key={i}>{criterion}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IdeaForm({
  onSubmit,
  submitting,
  error,
  submitLabel,
}: {
  onSubmit: (idea: string) => void;
  submitting: boolean;
  error: string | null;
  submitLabel: string;
}) {
  const [idea, setIdea] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="requirements-idea" className="text-sm font-medium text-text">
        Project idea
      </label>
      <textarea
        id="requirements-idea"
        rows={4}
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="Describe the idea in a few sentences — what it does, who it's for..."
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
      />
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button
          type="button"
          loading={submitting}
          disabled={idea.trim().length < 10}
          onClick={() => onSubmit(idea.trim())}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Rendered with `key={version.id}` by the parent, so switching which
 * version is selected remounts this component with fresh state — the
 * idiomatic React way to reset local state from a prop change, instead of
 * an effect + setState (which eslint-plugin-react-hooks flags as a
 * cascading-render risk; see the matching comment in Projects.tsx from the
 * Foundation phase).
 */
function VersionDetail({
  projectId,
  version,
  onActivated,
  onSaved,
}: {
  projectId: string;
  version: RequirementsVersion;
  onActivated: (version: RequirementsVersion) => void;
  onSaved: (version: RequirementsVersion) => void;
}) {
  const [draft, setDraft] = useState<RequirementsContent>(version.content);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  async function handleActivate() {
    setActivating(true);
    try {
      const { version: activated } = await activateRequirementsVersionRequest(projectId, version.id);
      onActivated(activated);
    } catch {
      // The version list is unaffected by a failed activation; the button
      // simply re-enables, which is sufficient feedback here.
    } finally {
      setActivating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const { version: saved } = await updateRequirementsVersionRequest(projectId, version.id, draft);
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
        <label htmlFor="req-summary" className="text-sm font-medium text-text">
          Project summary
        </label>
        <textarea
          id="req-summary"
          rows={3}
          value={draft.projectSummary}
          onChange={(e) => setDraft({ ...draft, projectSummary: e.target.value })}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(
          [
            ["users", "Users"],
            ["features", "Features"],
            ["risks", "Risks"],
            ["constraints", "Constraints"],
            ["assumptions", "Assumptions"],
            ["openQuestions", "Open questions"],
          ] as const
        ).map(([field, label]) => (
          <div key={field} className="flex flex-col gap-1.5">
            <label htmlFor={`req-${field}`} className="text-sm font-medium text-text">
              {label}
            </label>
            <textarea
              id={`req-${field}`}
              rows={3}
              value={listToLines(draft[field])}
              onChange={(e) => setDraft({ ...draft, [field]: linesToList(e.target.value) })}
              placeholder="One per line"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
            />
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-medium text-text">
          Functional requirements ({draft.functionalRequirements.length})
        </h3>
        <div className="mt-2 flex flex-col gap-2">
          {draft.functionalRequirements.map((item) => (
            <RequirementItemCard key={item.id} item={item} />
          ))}
        </div>
      </div>

      {draft.nonFunctionalRequirements.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text">
            Non-functional requirements ({draft.nonFunctionalRequirements.length})
          </h3>
          <div className="mt-2 flex flex-col gap-2">
            {draft.nonFunctionalRequirements.map((item) => (
              <RequirementItemCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

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

export function RequirementsSection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [showNewAnalysis, setShowNewAnalysis] = useState(false);

  const fetchVersions = useCallback(() => {
    listRequirementsVersionsRequest(projectId)
      .then(({ versions }) => {
        setState({ status: "ready", versions });
        setSelectedVersionId((current) => {
          if (current && versions.some((v) => v.id === current)) return current;
          return versions.find((v) => v.isActive)?.id ?? versions[0]?.id ?? null;
        });
      })
      .catch(() => setState({ status: "error", message: "Couldn't load requirements." }));
  }, [projectId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const retryList = useCallback(() => {
    setState({ status: "loading" });
    fetchVersions();
  }, [fetchVersions]);

  const selectedVersion =
    state.status === "ready" ? state.versions.find((v) => v.id === selectedVersionId) : undefined;

  async function handleAnalyze(idea: string) {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const { version } = await analyzeRequirementsRequest(projectId, idea);
      setState((prev) =>
        prev.status === "ready"
          ? { status: "ready", versions: [version, ...prev.versions.map((v) => ({ ...v, isActive: false }))] }
          : { status: "ready", versions: [version] },
      );
      setSelectedVersionId(version.id);
      setShowNewAnalysis(false);
    } catch (err) {
      setAnalyzeError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  function replaceVersion(updated: RequirementsVersion, deactivateOthers: boolean) {
    setState((prev) =>
      prev.status === "ready"
        ? {
            status: "ready",
            versions: prev.versions.map((v) =>
              v.id === updated.id ? updated : deactivateOthers ? { ...v, isActive: false } : v,
            ),
          }
        : prev,
    );
  }

  if (state.status === "loading") {
    return <LoadingState label="Loading requirements…" />;
  }

  if (state.status === "error") {
    return <ErrorState message={state.message} onRetry={retryList} />;
  }

  if (state.versions.length === 0) {
    return (
      <EmptyState
        title="No requirements yet"
        description="Describe the project idea and DevForge will analyze it into structured, versioned requirements."
        action={
          <div className="mx-auto w-full max-w-md text-left">
            <IdeaForm
              onSubmit={handleAnalyze}
              submitting={analyzing}
              error={analyzeError}
              submitLabel="Analyze"
            />
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
          className="mt-4 w-full"
          onClick={() => setShowNewAnalysis((s) => !s)}
        >
          New analysis
        </Button>
      </div>

      <div className="min-w-0 flex-1">
        {showNewAnalysis && (
          <Card className="mb-6">
            <h3 className="text-sm font-medium text-text">Run a new analysis</h3>
            <p className="mt-1 text-xs text-text-muted">
              Creates a new version and makes it active. Existing versions are kept.
            </p>
            <div className="mt-3">
              <IdeaForm
                onSubmit={handleAnalyze}
                submitting={analyzing}
                error={analyzeError}
                submitLabel="Analyze"
              />
            </div>
          </Card>
        )}

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
