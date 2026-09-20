import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Badge, type BadgeTone } from "../components/Badge.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews.js";
import { SourceEvidence } from "../components/SourceEvidence.js";
import { IconAlertCircle, IconChevronDown, IconShieldCheck } from "../components/icons.js";
import { ApiError } from "../services/apiClient.js";
import { getProjectRequest } from "../services/projectsApi.js";
import { getRepositoryConnectionRequest } from "../services/repositoryApi.js";
import { getCodebaseIndexRequest } from "../services/codebaseIndexApi.js";
import { createReviewRequest, listReviewsRequest } from "../services/codeReviewApi.js";
import type { Project } from "../types/project.js";
import type {
  CodeReview,
  CodeReviewFinding,
  ReviewFindingCategory,
  ReviewFindingConfidence,
  ReviewFindingSeverity,
} from "../types/codeReview.js";

const EXAMPLE_SCOPES = [
  "Review the authentication implementation for security issues.",
  "Find reliability risks in the GitHub integration.",
  "Look for error-handling problems in the API.",
];

const SEVERITIES: ReviewFindingSeverity[] = ["critical", "high", "medium", "low", "info"];
const CATEGORIES: ReviewFindingCategory[] = [
  "bug",
  "security",
  "reliability",
  "performance",
  "maintainability",
  "validation",
  "error_handling",
  "testing",
  "architecture",
  "other",
];
const CONFIDENCES: ReviewFindingConfidence[] = ["high", "medium", "low"];

const SEVERITY_TONE: Record<ReviewFindingSeverity, BadgeTone> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "neutral",
  info: "neutral",
};

function SeverityBadge({ severity }: { severity: ReviewFindingSeverity }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]} dot>
      {severity}
    </Badge>
  );
}

function FindingCard({ finding }: { finding: CodeReviewFinding }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-surface-2/60 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={finding.severity} />
        <Badge>{finding.category.replace("_", " ")}</Badge>
        <span className="text-xs text-text-muted">confidence: {finding.confidence}</span>
        {!finding.actionable && <span className="text-xs text-text-faint">(observation)</span>}
      </div>
      <p className="mt-2.5 text-sm font-medium text-text">{finding.title}</p>
      <p className="mt-1 text-sm text-text-muted">{finding.description}</p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-accent"
        aria-expanded={open}
      >
        <IconChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Hide details" : "Show recommendation & sources"}
      </button>

      {open && (
        <div className="mt-2.5 flex flex-col gap-2.5 border-t border-border pt-2.5">
          <p className="text-sm text-text">
            <span className="font-medium">Recommendation: </span>
            {finding.recommendation}
          </p>
          {finding.sources.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {finding.sources.map((source) => (
                <SourceEvidence key={`${source.filePath}:${source.startLine}-${source.endLine}`} source={source} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Filters = {
  severity: ReviewFindingSeverity | "all";
  category: ReviewFindingCategory | "all";
  confidence: ReviewFindingConfidence | "all";
};

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-severity" className="text-xs font-medium text-text-muted">
          Severity
        </label>
        <select
          id="filter-severity"
          value={filters.severity}
          onChange={(e) => onChange({ ...filters, severity: e.target.value as Filters["severity"] })}
          className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
        >
          <option value="all">All</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-category" className="text-xs font-medium text-text-muted">
          Category
        </label>
        <select
          id="filter-category"
          value={filters.category}
          onChange={(e) => onChange({ ...filters, category: e.target.value as Filters["category"] })}
          className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
        >
          <option value="all">All</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-confidence" className="text-xs font-medium text-text-muted">
          Confidence
        </label>
        <select
          id="filter-confidence"
          value={filters.confidence}
          onChange={(e) => onChange({ ...filters, confidence: e.target.value as Filters["confidence"] })}
          className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
        >
          <option value="all">All</option>
          {CONFIDENCES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function SeverityOverview({ findings }: { findings: CodeReviewFinding[] }) {
  const counts = SEVERITIES.map((severity) => ({
    severity,
    count: findings.filter((f) => f.severity === severity).length,
  })).filter((s) => s.count > 0);

  if (counts.length === 0) return null;

  const total = findings.length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        {counts.map(({ severity, count }) => (
          <span
            key={severity}
            className={
              severity === "critical" || severity === "high"
                ? "bg-danger"
                : severity === "medium"
                  ? "bg-warning"
                  : "bg-text-faint"
            }
            style={{ width: `${(count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {counts.map(({ severity, count }) => (
          <span key={severity} className="flex items-center gap-1 text-xs text-text-muted">
            <SeverityBadge severity={severity} />
            {count}
          </span>
        ))}
      </div>
    </div>
  );
}

function ReviewCard({ review, filters }: { review: CodeReview; filters: Filters }) {
  const filteredFindings = review.findings.filter(
    (f) =>
      (filters.severity === "all" || f.severity === filters.severity) &&
      (filters.category === "all" || f.category === filters.category) &&
      (filters.confidence === "all" || f.confidence === filters.confidence),
  );

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-medium text-text-muted">Scope</p>
        <p className="text-sm text-text">{review.scope}</p>
      </div>
      {review.status === "failed" && (
        <p className="flex items-center gap-1.5 text-sm text-danger" role="alert">
          <IconAlertCircle className="h-4 w-4 shrink-0" />
          This review did not complete successfully.
        </p>
      )}
      {review.summary && (
        <div>
          <p className="text-xs font-medium text-text-muted">Summary</p>
          <p className="whitespace-pre-wrap text-sm text-text">{review.summary}</p>
        </div>
      )}
      <SeverityOverview findings={review.findings} />
      <p className="text-xs text-text-faint">
        {review.findingCount} finding{review.findingCount === 1 ? "" : "s"} · {review.branch}@
        {review.commit.slice(0, 8)} · {new Date(review.createdAt).toLocaleString()}
      </p>
      {review.findingCount > 0 && filteredFindings.length === 0 && (
        <p className="text-sm text-text-muted">No findings match the current filters.</p>
      )}
      {filteredFindings.length > 0 && (
        <div className="flex flex-col gap-2">
          {filteredFindings.map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ReviewPanel({ projectId }: { projectId: string }) {
  const [history, setHistory] = useState<CodeReview[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [scope, setScope] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ severity: "all", category: "all", confidence: "all" });

  useEffect(() => {
    listReviewsRequest(projectId)
      .then(({ reviews }) => setHistory(reviews))
      .catch((err: unknown) =>
        setHistoryError(err instanceof ApiError ? err.message : "Couldn't load review history."),
      );
  }, [projectId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setRunError(null);
    try {
      const result = await createReviewRequest(projectId, scope);
      setHistory((prev) => [result, ...(prev ?? [])]);
      setScope("");
    } catch (err) {
      setRunError(err instanceof ApiError ? err.message : "Couldn't complete the review. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  const hasHistory = history !== null && history.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="review-scope" className="text-sm font-medium text-text">
              What should DevForge review? (optional)
            </label>
            <input
              id="review-scope"
              type="text"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="e.g. Review the authentication implementation for security issues."
              className="h-10 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text placeholder:text-text-muted focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
            />
            <p className="text-xs text-text-muted">
              Leave blank for a general review of bugs, security, reliability, performance, and
              maintainability.
            </p>
          </div>
          {runError && (
            <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {runError}
            </p>
          )}
          <div>
            <Button type="submit" loading={running}>
              {hasHistory ? "Run another review" : "Run review"}
            </Button>
          </div>
        </form>
      </Card>

      {running && (
        <LoadingState label="Finding relevant indexed code, preparing review context, analyzing potential issues, and validating findings…" />
      )}

      {!running && historyError && <ErrorState message={historyError} />}

      {!running && !historyError && history && history.length === 0 && (
        <EmptyState
          icon={<IconShieldCheck className="h-5 w-5" />}
          title="No reviews run yet"
          description="Describe what to review — DevForge searches the indexed codebase for relevant code and reports findings grounded in what it finds. It never modifies code."
          action={
            <div className="flex flex-col items-stretch gap-2 sm:min-w-[22rem]">
              {EXAMPLE_SCOPES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setScope(example)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm text-text transition-colors hover:border-accent hover:bg-accent-soft"
                >
                  {example}
                </button>
              ))}
            </div>
          }
        />
      )}

      {!running && hasHistory && (
        <>
          <FilterBar filters={filters} onChange={setFilters} />
          <div className="flex flex-col gap-3">
            {(history ?? []).map((review) => (
              <ReviewCard key={review.reviewId} review={review} filters={filters} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type PageState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "no-repository"; project: Project }
  | { status: "no-index"; project: Project }
  | { status: "ready"; project: Project };

export function CodeReview() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<PageState>({ status: "loading" });

  const fetchState = useCallback(() => {
    if (!id) return;
    getProjectRequest(id)
      .then(async ({ project }) => {
        const { connection } = await getRepositoryConnectionRequest(id);
        if (!connection) {
          setState({ status: "no-repository", project });
          return;
        }
        const { index } = await getCodebaseIndexRequest(id);
        if (!index || index.status !== "completed") {
          setState({ status: "no-index", project });
          return;
        }
        setState({ status: "ready", project });
      })
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

  const retry = useCallback(() => {
    setState({ status: "loading" });
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
        <ErrorState message={state.message} onRetry={retry} />
      </AppShell>
    );
  }

  return (
    <AppShell projectId={state.project.id} projectName={state.project.name}>
      <div className="animate-fade-in flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Code Review</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-text-muted">
            Read-only — DevForge does not modify your code. Reviews report findings and
            recommendations grounded in indexed code it can find; it does not apply fixes, run
            commands, create commits, or take any action on the repository.
          </p>
        </div>

        {state.status === "no-repository" && (
          <EmptyState
            icon={<IconShieldCheck className="h-5 w-5" />}
            title="No repository connected"
            description="Connect a GitHub repository before running a code review."
            action={
              <Link to={`/projects/${state.project.id}/repository`}>
                <Button type="button" variant="secondary">
                  Connect a repository
                </Button>
              </Link>
            }
          />
        )}

        {state.status === "no-index" && (
          <EmptyState
            icon={<IconShieldCheck className="h-5 w-5" />}
            title="Codebase not indexed yet"
            description="Index the connected repository before running a code review."
            action={
              <Link to={`/projects/${state.project.id}/indexing`}>
                <Button type="button" variant="secondary">
                  Go to indexing
                </Button>
              </Link>
            }
          />
        )}

        {state.status === "ready" && <ReviewPanel projectId={state.project.id} />}
      </div>
    </AppShell>
  );
}
