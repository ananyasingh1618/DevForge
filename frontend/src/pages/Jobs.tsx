import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Badge, type BadgeTone } from "../components/Badge.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews.js";
import {
  IconActivity,
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconCircleDot,
  IconDatabase,
  IconGithub,
  IconMessage,
  IconShieldCheck,
} from "../components/icons.js";
import { ApiError } from "../services/apiClient.js";
import { getProjectRequest } from "../services/projectsApi.js";
import { cancelJobRequest, createJobRequest, listJobsRequest, retryJobRequest } from "../services/jobsApi.js";
import { getRepositoryConnectionRequest } from "../services/repositoryApi.js";
import { getCodebaseIndexRequest } from "../services/codebaseIndexApi.js";
import type { Job, JobType } from "../types/job.js";
import type { Project } from "../types/project.js";
import type { RepositoryConnection } from "../types/repository.js";
import type { CodebaseIndex } from "../types/codebaseIndex.js";

// Polling only runs while at least one job is still queued/running (see
// hasActiveJob below) — a completed/failed/cancelled/timed-out project's
// job list is fetched once and then left alone, never polled forever.
const POLL_INTERVAL_MS = 3000;

const STATUS_TONE: Record<Job["status"], BadgeTone> = {
  queued: "neutral",
  running: "accent",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
  timed_out: "danger",
};

// Fixed display labels for each job type — never derived from `job.type`
// via CSS text-transform (that previously rendered "qa" as "Qa"; an
// acronym needs an explicit label, not a capitalize() pass).
const TYPE_LABEL: Record<JobType, string> = {
  indexing: "Indexing",
  qa: "Q&A",
  review: "Code Review",
  evaluation: "Evaluation",
};

const TYPE_ICON: Record<JobType, typeof IconDatabase> = {
  indexing: IconDatabase,
  qa: IconMessage,
  review: IconShieldCheck,
  evaluation: IconActivity,
};

const RESULT_LINK: Record<JobType, string | null> = {
  indexing: "indexing",
  qa: "qa",
  review: "reviews",
  evaluation: null,
};

function StatusBadge({ status }: { status: Job["status"] }) {
  return <Badge tone={STATUS_TONE[status]}>{status.replace("_", " ")}</Badge>;
}

function hasActiveJob(jobs: Job[]): boolean {
  return jobs.some((j) => j.status === "queued" || j.status === "running");
}

function formatDuration(startedAt: string | null, endAt: string | null): string | null {
  if (!startedAt || !endAt) return null;
  const ms = new Date(endAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/** Real readiness, derived only from the repository connection and
 * codebase index this project actually has — never invented. Indexing
 * itself only needs a connected repository; Q&A and Code Review also
 * need a *completed* index, since both ground their results in it. */
type Readiness = {
  repositoryConnected: boolean;
  indexingComplete: boolean;
};

function readinessFor(type: JobType, readiness: Readiness): boolean {
  if (type === "indexing") return readiness.repositoryConnected;
  if (type === "qa" || type === "review") return readiness.repositoryConnected && readiness.indexingComplete;
  return true; // evaluation jobs run against a fixed fixture dataset, not this project's repo
}

function ReadinessRow({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          met ? "bg-success-soft text-success" : "bg-surface-3 text-text-faint"
        }`}
      >
        {met ? <IconCheck className="h-3 w-3" /> : <IconCircleDot className="h-3 w-3" />}
      </span>
      <span className={met ? "text-text" : "text-text-muted"}>{label}</span>
    </div>
  );
}

/** The readiness/empty-state panel — explains why Q&A and Code Review are
 * gated, shows only real connection/indexing state, and points at the
 * one concrete next step. Collapses to a single confirmation line once
 * everything is actually ready, instead of taking up permanent space. */
function ReadinessPanel({ projectId, readiness }: { projectId: string; readiness: Readiness }) {
  const qaReady = readiness.repositoryConnected && readiness.indexingComplete;

  if (qaReady) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-success/25 bg-success-soft px-3.5 py-2.5 text-sm text-success">
        <IconCheck className="h-4 w-4 shrink-0" />
        Repository connected and indexed — Q&amp;A and Code Review are both available.
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-text">Q&amp;A and Code Review readiness</h2>
        <p className="mt-1 text-xs text-text-muted">
          Both require a connected repository and a completed index so their results are grounded
          in real code.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <ReadinessRow met={readiness.repositoryConnected} label="Repository connected" />
        <ReadinessRow met={readiness.indexingComplete} label="Indexing complete" />
        <ReadinessRow met={qaReady} label="Q&A available" />
        <ReadinessRow met={qaReady} label="Code Review available" />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3.5">
        {!readiness.repositoryConnected && (
          <Link to={`/projects/${projectId}/repository`}>
            <Button type="button" size="sm">
              <IconGithub className="h-3.5 w-3.5" />
              Connect repository
            </Button>
          </Link>
        )}
        {readiness.repositoryConnected && !readiness.indexingComplete && (
          <Link to={`/projects/${projectId}/indexing`}>
            <Button type="button" size="sm">
              <IconDatabase className="h-3.5 w-3.5" />
              Go to indexing
            </Button>
          </Link>
        )}
        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-faint">
          <span className="flex items-center gap-1">
            <span className="font-mono text-text-muted">1</span> Connect a repository
          </span>
          <IconArrowRight className="h-3 w-3" />
          <span className="flex items-center gap-1">
            <span className="font-mono text-text-muted">2</span> Run indexing
          </span>
          <IconArrowRight className="h-3 w-3" />
          <span className="flex items-center gap-1">
            <span className="font-mono text-text-muted">3</span> Ask questions or start a code review
          </span>
        </div>
      </div>
    </Card>
  );
}

function statusBucket(status: Job["status"]): "running" | "successful" | "failed" | "other" {
  if (status === "queued" || status === "running") return "running";
  if (status === "completed") return "successful";
  if (status === "failed" || status === "timed_out") return "failed";
  return "other";
}

/** A compact summary in place of repeating every job as a full card up
 * front — real counts derived from the currently-loaded job list (never
 * a separate, possibly-stale backend count), plus the few most recent
 * jobs. "View all jobs" jumps down to the full list rather than linking
 * anywhere else, since that full list already lives on this same page. */
function ActivitySummary({ jobs, projectId }: { jobs: Job[]; projectId: string }) {
  const total = jobs.length;
  const running = jobs.filter((j) => statusBucket(j.status) === "running").length;
  const successful = jobs.filter((j) => statusBucket(j.status) === "successful").length;
  const failed = jobs.filter((j) => statusBucket(j.status) === "failed").length;

  const latest = [...jobs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Activity</h2>
        <a href="#all-jobs" className="text-xs font-medium text-accent hover:underline">
          View all jobs
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface-2/50 px-3 py-2.5">
          <p className="text-xs text-text-muted">Total</p>
          <p className="mt-0.5 text-xl font-semibold text-text">{total}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface-2/50 px-3 py-2.5">
          <p className="text-xs text-text-muted">Running</p>
          <p className="mt-0.5 text-xl font-semibold text-accent">{running}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface-2/50 px-3 py-2.5">
          <p className="text-xs text-text-muted">Successful</p>
          <p className="mt-0.5 text-xl font-semibold text-success">{successful}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface-2/50 px-3 py-2.5">
          <p className="text-xs text-text-muted">Failed</p>
          <p className="mt-0.5 text-xl font-semibold text-danger">{failed}</p>
        </div>
      </div>

      {latest.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border pt-3.5">
          <p className="mb-1 text-xs font-medium text-text-muted">Latest activity</p>
          {latest.map((job) => {
            const Icon = TYPE_ICON[job.type];
            const resultPath = RESULT_LINK[job.type];
            const rowContent = (
              <>
                <Icon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                <span className="min-w-0 flex-1 truncate text-text">{TYPE_LABEL[job.type]}</span>
                <StatusBadge status={job.status} />
                <span className="shrink-0 text-text-faint">{new Date(job.createdAt).toLocaleString()}</span>
              </>
            );
            const rowClass = "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs";
            return job.status === "completed" && resultPath ? (
              <Link key={job.id} to={`/projects/${projectId}/${resultPath}`} className={`${rowClass} transition-colors hover:bg-surface-2`}>
                {rowContent}
              </Link>
            ) : (
              <div key={job.id} className={rowClass}>
                {rowContent}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function JobRow({
  projectId,
  job,
  readiness,
  onCancel,
  onRetry,
  busy,
}: {
  projectId: string;
  job: Job;
  readiness: Readiness;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  busy: boolean;
}) {
  const Icon = TYPE_ICON[job.type];
  const endAt = job.completedAt ?? job.cancelledAt;
  const duration = formatDuration(job.startedAt, endAt);
  const resultPath = RESULT_LINK[job.type];
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isFailed = job.status === "failed" || job.status === "timed_out";
  const underRetryLimit = job.retryCount < job.maxRetries;
  const prereqsMet = readinessFor(job.type, readiness);
  const canRetry = isFailed && underRetryLimit && prereqsMet;
  // When retry would just fail again for the same root-cause reason, point
  // at the fix instead of offering a doomed retry.
  const blockedAction: "connect" | "index" | null =
    isFailed && underRetryLimit && !prereqsMet
      ? !readiness.repositoryConnected
        ? "connect"
        : "index"
      : null;

  return (
    <Card className={`flex flex-col gap-2.5 ${isFailed ? "border-danger/20" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              isFailed ? "bg-danger-soft text-danger" : "bg-surface-2 text-text-muted"
            }`}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-text">{TYPE_LABEL[job.type]}</span>
              <StatusBadge status={job.status} />
            </div>
            {isFailed && job.errorMessage && (
              <p className="mt-0.5 line-clamp-2 max-w-md text-xs text-danger">{job.errorMessage}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {job.status === "completed" && resultPath && (
            <Link
              to={`/projects/${projectId}/${resultPath}`}
              className="flex h-9 items-center rounded-lg px-3 text-sm font-medium text-accent hover:bg-accent-soft"
            >
              View results
            </Link>
          )}
          {(job.status === "queued" || job.status === "running") && (
            <Button variant="secondary" onClick={() => onCancel(job.id)} disabled={busy}>
              Cancel
            </Button>
          )}
          {canRetry && (
            <Button variant="secondary" onClick={() => onRetry(job.id)} disabled={busy}>
              Retry
            </Button>
          )}
          {blockedAction === "connect" && (
            <Link to={`/projects/${projectId}/repository`}>
              <Button type="button" variant="secondary">
                Connect repository
              </Button>
            </Link>
          )}
          {blockedAction === "index" && (
            <Link to={`/projects/${projectId}/indexing`}>
              <Button type="button" variant="secondary">
                Go to indexing
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-text-muted">
          {new Date(job.createdAt).toLocaleString()}
          {duration && ` · ${duration}`}
        </p>
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          aria-expanded={detailsOpen}
          className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-text-faint hover:text-accent"
        >
          {detailsOpen ? "Hide details" : "Details"}
          <IconChevronDown className={`h-3 w-3 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
        </button>
      </div>
      {detailsOpen && (
        <dl className="grid grid-cols-1 gap-2 border-t border-border pt-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-text-faint">Job ID</dt>
            <dd className="mt-0.5 font-mono text-text-muted">{job.id}</dd>
          </div>
          <div>
            <dt className="text-text-faint">Correlation ID</dt>
            <dd className="mt-0.5 font-mono text-text-muted">{job.correlationId}</dd>
          </div>
          <div>
            <dt className="text-text-faint">Retries</dt>
            <dd className="mt-0.5 text-text-muted">
              {job.retryCount}/{job.maxRetries}
            </dd>
          </div>
          {job.errorCode && (
            <div>
              <dt className="text-text-faint">Error code</dt>
              <dd className="mt-0.5 font-mono text-danger">{job.errorCode}</dd>
            </div>
          )}
          {job.completedAt && (
            <div>
              <dt className="text-text-faint">Finished</dt>
              <dd className="mt-0.5 text-text-muted">{new Date(job.completedAt).toLocaleString()}</dd>
            </div>
          )}
          {job.cancelledAt && (
            <div>
              <dt className="text-text-faint">Cancelled</dt>
              <dd className="mt-0.5 text-text-muted">{new Date(job.cancelledAt).toLocaleString()}</dd>
            </div>
          )}
          {job.errorMessage && (
            <div className="sm:col-span-2">
              <dt className="text-text-faint">Error message</dt>
              <dd className="mt-0.5 text-danger">{job.errorMessage}</dd>
            </div>
          )}
        </dl>
      )}
    </Card>
  );
}

function JobsPanel({ projectId }: { projectId: string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [creating, setCreating] = useState<JobType | null>(null);
  const [connection, setConnection] = useState<RepositoryConnection | null>(null);
  const [index, setIndex] = useState<CodebaseIndex | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getRepositoryConnectionRequest(projectId)
      .then(({ connection: c }) => setConnection(c))
      .catch(() => setConnection(null));
    getCodebaseIndexRequest(projectId)
      .then(({ index: i }) => setIndex(i))
      .catch(() => setIndex(null));
  }, [projectId]);

  const readiness: Readiness = {
    repositoryConnected: connection !== null,
    indexingComplete: index?.status === "completed",
  };

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
    <div className="flex flex-col gap-5">
      <ReadinessPanel projectId={projectId} readiness={readiness} />

      <Card className="flex flex-wrap gap-2">
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
          Start code review job
        </Button>
      </Card>

      {actionError && (
        <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {actionError}
        </p>
      )}

      {jobs === null && !listError && <LoadingState label="Loading jobs…" />}

      {listError && <ErrorState message={listError} onRetry={() => void refresh()} />}

      {jobs !== null && !listError && jobs.length > 0 && <ActivitySummary jobs={jobs} projectId={projectId} />}

      {jobs !== null && !listError && jobs.length === 0 && (
        <EmptyState
          icon={<IconActivity className="h-5 w-5" />}
          title="No jobs yet"
          description="Start an indexing, Q&A, or code review job above — jobs run in the background and this page updates automatically while one is queued or running."
        />
      )}

      {jobs !== null && jobs.length > 0 && (
        <div id="all-jobs" className="flex flex-col gap-3 scroll-mt-6">
          <h2 className="text-sm font-semibold text-text">All jobs</h2>
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              projectId={projectId}
              job={job}
              readiness={readiness}
              onCancel={handleCancel}
              onRetry={handleRetry}
              busy={busyJobId === job.id}
            />
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

  if (state.status === "loading") {
    return (
      <AppShell projectId={id}>
        <LoadingState label="Loading project…" />
      </AppShell>
    );
  }

  if (state.status === "not-found") {
    return (
      <AppShell>
        <ErrorState message="Project not found." />
      </AppShell>
    );
  }

  if (state.status === "error") {
    return (
      <AppShell projectId={id}>
        <ErrorState message={state.message} onRetry={fetchState} />
      </AppShell>
    );
  }

  return (
    <AppShell projectId={state.project.id} projectName={state.project.name}>
      <div className="animate-fade-in flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Jobs</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-text-muted">
            Background indexing, Q&amp;A, and code review jobs for this project — queued and
            running jobs update automatically; nothing here runs indefinitely or blocks the rest
            of the app.
          </p>
        </div>
        <JobsPanel projectId={state.project.id} />
      </div>
    </AppShell>
  );
}
