import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews.js";
import { ApiError } from "../services/apiClient.js";
import { getProjectRequest } from "../services/projectsApi.js";
import { cancelJobRequest, createJobRequest, listJobsRequest, retryJobRequest } from "../services/jobsApi.js";
import type { Job, JobType } from "../types/job.js";
import type { Project } from "../types/project.js";

// Polling only runs while at least one job is still queued/running (see
// hasActiveJob below) — a completed/failed/cancelled/timed-out project's
// job list is fetched once and then left alone, never polled forever.
const POLL_INTERVAL_MS = 3000;

const STATUS_STYLES: Record<Job["status"], string> = {
  queued: "bg-surface-2 text-text-muted",
  running: "bg-accent/15 text-accent",
  completed: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  cancelled: "bg-surface-2 text-text-muted",
  timed_out: "bg-danger/15 text-danger",
};

function StatusBadge({ status }: { status: Job["status"] }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function hasActiveJob(jobs: Job[]): boolean {
  return jobs.some((j) => j.status === "queued" || j.status === "running");
}

function JobRow({
  job,
  onCancel,
  onRetry,
  busy,
}: {
  job: Job;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  busy: boolean;
}) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium capitalize text-text">{job.type}</span>
          <StatusBadge status={job.status} />
          {job.retryCount > 0 && (
            <span className="text-xs text-text-muted">
              retry {job.retryCount}/{job.maxRetries}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {(job.status === "queued" || job.status === "running") && (
            <Button variant="secondary" onClick={() => onCancel(job.id)} disabled={busy}>
              Cancel
            </Button>
          )}
          {(job.status === "failed" || job.status === "timed_out") && job.retryCount < job.maxRetries && (
            <Button variant="secondary" onClick={() => onRetry(job.id)} disabled={busy}>
              Retry
            </Button>
          )}
        </div>
      </div>
      {job.errorMessage && <p className="text-xs text-danger">{job.errorMessage}</p>}
      <p className="text-xs text-text-muted">
        Created {new Date(job.createdAt).toLocaleString()}
        {job.completedAt && ` · finished ${new Date(job.completedAt).toLocaleString()}`}
        {job.cancelledAt && ` · cancelled ${new Date(job.cancelledAt).toLocaleString()}`}
      </p>
    </Card>
  );
}

function JobsPanel({ projectId }: { projectId: string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [creating, setCreating] = useState<JobType | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    return listJobsRequest(projectId)
      .then(({ jobs: fetched }) => {
        setJobs(fetched);
        setListError(null);
        return fetched;
      })
      .catch((err: unknown) => {
        setListError(err instanceof ApiError ? err.message : "Couldn't load jobs.");
        return null;
      });
  }, [projectId]);

  // Safe polling: schedules exactly one more poll only while at least one
  // job is still queued/running — a page full of only completed/failed/
  // cancelled jobs never polls again until the user starts a new job or
  // reloads the page. Both the initial mount and every "start a job"
  // action funnel through this one scheduler, so there is only ever one
  // pending timer at a time. A ref (not a direct self-reference in the
  // closure) avoids a temporal-dead-zone self-reference while still
  // letting the scheduled callback always call the latest version.
  const pollWhileActiveRef = useRef<() => void>(() => {});
  const pollWhileActive = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    void refresh().then((fetched) => {
      if (fetched && hasActiveJob(fetched)) {
        pollTimer.current = setTimeout(() => pollWhileActiveRef.current(), POLL_INTERVAL_MS);
      }
    });
  }, [refresh]);

  useEffect(() => {
    pollWhileActiveRef.current = pollWhileActive;
  }, [pollWhileActive]);

  useEffect(() => {
    pollWhileActive();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pollWhileActive is stable for a given projectId
  }, [projectId]);

  async function handleCreate(type: JobType) {
    setCreating(type);
    setActionError(null);
    try {
      const input = type === "qa" ? { question: "What does this codebase do?" } : type === "review" ? { scope: undefined } : {};
      await createJobRequest(projectId, type, input);
      pollWhileActive();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : `Couldn't start a ${type} job.`);
    } finally {
      setCreating(null);
    }
  }

  async function handleCancel(jobId: string) {
    setBusyJobId(jobId);
    setActionError(null);
    try {
      await cancelJobRequest(projectId, jobId);
      pollWhileActive();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't cancel this job.");
    } finally {
      setBusyJobId(null);
    }
  }

  async function handleRetry(jobId: string) {
    setBusyJobId(jobId);
    setActionError(null);
    try {
      await retryJobRequest(projectId, jobId);
      pollWhileActive();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Couldn't retry this job.");
    } finally {
      setBusyJobId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void handleCreate("indexing")} loading={creating === "indexing"} disabled={creating !== null}>
          Start indexing job
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handleCreate("qa")}
          loading={creating === "qa"}
          disabled={creating !== null}
        >
          Start Q&amp;A job
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handleCreate("review")}
          loading={creating === "review"}
          disabled={creating !== null}
        >
          Start review job
        </Button>
      </div>

      {actionError && (
        <p className="text-sm text-danger" role="alert">
          {actionError}
        </p>
      )}

      {jobs === null && !listError && <LoadingState label="Loading jobs…" />}

      {listError && <ErrorState message={listError} onRetry={() => void refresh()} />}

      {jobs !== null && !listError && jobs.length === 0 && (
        <EmptyState
          title="No jobs yet"
          description="Start an indexing, Q&A, or review job above — jobs run in the background and this page updates automatically while one is queued or running."
        />
      )}

      {jobs !== null && jobs.length > 0 && (
        <div className="flex flex-col gap-3">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} onCancel={handleCancel} onRetry={handleRetry} busy={busyJobId === job.id} />
          ))}
        </div>
      )}
    </div>
  );
}

type PageState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; project: Project };

export function Jobs() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<PageState>({ status: "loading" });

  const fetchState = useCallback(() => {
    if (!id) return;
    getProjectRequest(id)
      .then(({ project }) => setState({ status: "ready", project }))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: "Couldn't load this project." });
        }
      });
  }, [id]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  return (
    <AppShell>
      {state.status === "loading" && <LoadingState label="Loading project…" />}
      {state.status === "not-found" && <ErrorState message="Project not found." />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={fetchState} />}

      {state.status === "ready" && (
        <div>
          <Link to={`/projects/${state.project.id}`} className="text-sm text-text-muted hover:text-text">
            &larr; {state.project.name}
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-text">Jobs</h1>
          <p className="mt-1 text-sm text-text-muted">
            Background indexing, Q&amp;A, and review jobs for this project — queued and running
            jobs update automatically; nothing here runs indefinitely or blocks the rest of the
            app.
          </p>
          <div className="mt-6">
            <JobsPanel projectId={state.project.id} />
          </div>
        </div>
      )}
    </AppShell>
  );
}
