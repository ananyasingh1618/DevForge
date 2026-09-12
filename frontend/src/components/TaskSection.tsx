import { useCallback, useEffect, useState } from "react";
import { Button } from "./Button.js";
import { Card } from "./Card.js";
import { EmptyState, ErrorState, LoadingState } from "./StateViews.js";
import { ApiError } from "../services/apiClient.js";
import {
  activateTaskVersionRequest,
  generateTasksRequest,
  listTaskVersionsRequest,
  updateTaskVersionRequest,
} from "../services/tasksApi.js";
import { listEpicVersionsRequest } from "../services/epicsApi.js";
import type { TaskComplexity, TaskContent, TaskItem, TaskPriority, TaskType, TaskVersion } from "../types/tasks.js";

function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function listToLines(items: string[]): string {
  return items.join("\n");
}

const TASK_TYPES: TaskType[] = ["feature", "bug", "chore"];
const TASK_PRIORITIES: TaskPriority[] = ["high", "medium", "low"];
const TASK_COMPLEXITIES: TaskComplexity[] = ["small", "medium", "large"];

const arrayFields = [
  ["acceptanceCriteria", "Acceptance criteria"],
  ["dependencies", "Dependencies (other task ids)"],
] as const;

/**
 * One editable card per task — same reasoning as EpicSection's EpicCard:
 * content is entirely an item list, so each item gets its own card. No
 * add/remove-item control; structural changes happen by regenerating.
 */
function TaskCard({
  task,
  onChange,
}: {
  task: TaskItem;
  onChange: (updated: TaskItem) => void;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted">
          {task.id}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`task-${task.id}-title`} className="text-sm font-medium text-text">
          Title
        </label>
        <input
          id={`task-${task.id}-title`}
          type="text"
          value={task.title}
          onChange={(e) => onChange({ ...task, title: e.target.value })}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`task-${task.id}-description`} className="text-sm font-medium text-text">
          Description
        </label>
        <textarea
          id={`task-${task.id}-description`}
          rows={2}
          value={task.description}
          onChange={(e) => onChange({ ...task, description: e.target.value })}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`task-${task.id}-type`} className="text-sm font-medium text-text">
            Type
          </label>
          <select
            id={`task-${task.id}-type`}
            value={task.type}
            onChange={(e) => onChange({ ...task, type: e.target.value as TaskType })}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
          >
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`task-${task.id}-priority`} className="text-sm font-medium text-text">
            Priority
          </label>
          <select
            id={`task-${task.id}-priority`}
            value={task.priority}
            onChange={(e) => onChange({ ...task, priority: e.target.value as TaskPriority })}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`task-${task.id}-complexity`} className="text-sm font-medium text-text">
            Complexity
          </label>
          <select
            id={`task-${task.id}-complexity`}
            value={task.estimatedComplexity}
            onChange={(e) =>
              onChange({ ...task, estimatedComplexity: e.target.value as TaskComplexity })
            }
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
          >
            {TASK_COMPLEXITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`task-${task.id}-order`} className="text-sm font-medium text-text">
            Order
          </label>
          <input
            id={`task-${task.id}-order`}
            type="number"
            value={task.suggestedOrder}
            onChange={(e) => onChange({ ...task, suggestedOrder: Number(e.target.value) })}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`task-${task.id}-epicId`} className="text-sm font-medium text-text">
            Epic id
          </label>
          <input
            id={`task-${task.id}-epicId`}
            type="text"
            value={task.epicId}
            onChange={(e) => onChange({ ...task, epicId: e.target.value })}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`task-${task.id}-relatedComponent`}
            className="text-sm font-medium text-text"
          >
            Related component
          </label>
          <input
            id={`task-${task.id}-relatedComponent`}
            type="text"
            value={task.relatedComponent}
            onChange={(e) => onChange({ ...task, relatedComponent: e.target.value })}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {arrayFields.map(([field, label]) => (
          <div key={field} className="flex flex-col gap-1.5">
            <label htmlFor={`task-${task.id}-${field}`} className="text-sm font-medium text-text">
              {label}
            </label>
            <textarea
              id={`task-${task.id}-${field}`}
              rows={3}
              value={listToLines(task[field])}
              onChange={(e) => onChange({ ...task, [field]: linesToList(e.target.value) })}
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
  version: TaskVersion;
  onActivated: (version: TaskVersion) => void;
  onSaved: (version: TaskVersion) => void;
}) {
  const [draft, setDraft] = useState<TaskContent>(version.content);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);

  function updateTask(index: number, updated: TaskItem) {
    setDraft({ tasks: draft.tasks.map((t, i) => (i === index ? updated : t)) });
  }

  async function handleActivate() {
    setActivating(true);
    try {
      const { version: activated } = await activateTaskVersionRequest(projectId, version.id);
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
      const { version: saved } = await updateTaskVersionRequest(projectId, version.id, draft);
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
        {draft.tasks.map((task, index) => (
          <TaskCard key={task.id} task={task} onChange={(updated) => updateTask(index, updated)} />
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
  | { status: "ready"; activeEpicVersionNumber: number; versions: TaskVersion[] };

export function TaskSection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<SectionState>({ status: "loading" });
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Fetches the epics list and this section's own list independently —
  // TaskSection stays self-contained rather than being coupled to
  // EpicSection's state. Because at most one epic version is ever active
  // and there is no epic-deletion endpoint, "no active epics" is exactly
  // "the epic version list is empty".
  const fetchAll = useCallback(() => {
    Promise.all([listEpicVersionsRequest(projectId), listTaskVersionsRequest(projectId)])
      .then(([{ versions: epicVersions }, { versions }]) => {
        const activeEpics = epicVersions.find((v) => v.isActive);
        if (!activeEpics) {
          setState({ status: "blocked" });
          return;
        }
        setState({
          status: "ready",
          activeEpicVersionNumber: activeEpics.version,
          versions,
        });
        setSelectedVersionId((current) => {
          if (current && versions.some((v) => v.id === current)) return current;
          return versions.find((v) => v.isActive)?.id ?? versions[0]?.id ?? null;
        });
      })
      .catch(() => setState({ status: "error", message: "Couldn't load tasks." }));
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
      const { version } = await generateTasksRequest(projectId);
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

  function replaceVersion(updated: TaskVersion, deactivateOthers: boolean) {
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
    return <LoadingState label="Loading tasks…" />;
  }

  if (state.status === "error") {
    return <ErrorState message={state.message} onRetry={retry} />;
  }

  // No Generate control is ever rendered here — the dependency is
  // communicated, not offered as a control that would fail on click.
  if (state.status === "blocked") {
    return (
      <EmptyState
        title="Epics needed first"
        description="Generate and activate an epic version above, then come back here to generate tasks."
      />
    );
  }

  if (state.versions.length === 0) {
    return (
      <EmptyState
        title="No tasks yet"
        description={`Generate tasks from the active epics (v${state.activeEpicVersionNumber}).`}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button type="button" loading={generating} onClick={handleGenerate}>
              {`Generate tasks from Epics v${state.activeEpicVersionNumber}`}
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
          {`Regenerate from Epics v${state.activeEpicVersionNumber}`}
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
