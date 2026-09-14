import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews.js";
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

const SEVERITY_STYLES: Record<ReviewFindingSeverity, string> = {
  critical: "bg-danger/15 text-danger",
  high: "bg-danger/10 text-danger",
  medium: "bg-accent/15 text-accent",
  low: "bg-surface-2 text-text-muted",
  info: "bg-surface-2 text-text-muted",
};

function SeverityBadge({ severity }: { severity: ReviewFindingSeverity }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SEVERITY_STYLES[severity]}`}>
      {severity}
    </span>
  );
}

function FindingCard({ finding }: { finding: CodeReviewFinding }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={finding.severity} />
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-muted capitalize">
          {finding.category.replace("_", " ")}
        </span>
        <span className="text-xs text-text-muted">confidence: {finding.confidence}</span>
        {!finding.actionable && <span className="text-xs text-text-muted">(observation)</span>}
      </div>
      <p className="mt-2 text-sm font-medium text-text">{finding.title}</p>
      <p className="mt-1 text-sm text-text-muted">{finding.description}</p>
      <p className="mt-2 text-sm text-text">
        <span className="font-medium">Recommendation: </span>
        {finding.recommendation}
      </p>
      {finding.sources.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {finding.sources.map((source) => (
            <li
              key={`${source.filePath}:${source.startLine}-${source.endLine}`}
              className="flex flex-wrap items-center gap-2 text-xs text-text-muted"
            >
              <span className="truncate font-mono text-text">{source.filePath}</span>
              {source.symbolName && <span>{source.symbolName}</span>}
              <span>
                L{source.startLine}–{source.endLine}
              </span>
            </li>
          ))}
        </ul>
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
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
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
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
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
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
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
        <p className="text-sm text-danger" role="alert">
          This review did not complete successfully.
        </p>
      )}
      {review.summary && (
        <div>
          <p className="text-xs font-medium text-text-muted">Summary</p>
          <p className="whitespace-pre-wrap text-sm text-text">{review.summary}</p>
        </div>
      )}
      <p className="text-xs text-text-muted">
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
    <div className="flex flex-col gap-4">
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
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
          />
          <p className="text-xs text-text-muted">
            Leave blank for a general review of bugs, security, reliability, performance, and
            maintainability.
          </p>
        </div>
        {runError && (
          <p className="text-sm text-danger" role="alert">
            {runError}
          </p>
        )}
        <div>
          <Button type="submit" loading={running}>
            {hasHistory ? "Run another review" : "Run review"}
          </Button>
        </div>
      </form>

      {running && (
        <LoadingState label="Finding relevant indexed code, preparing review context, analyzing potential issues, and validating findings…" />
      )}

      {!running && historyError && <ErrorState message={historyError} />}

      {!running && !historyError && history && history.length === 0 && (
        <EmptyState
          title="No reviews run yet"
          description="Describe what to review — DevForge searches the indexed codebase for relevant code and reports findings grounded in what it finds. It never modifies code."
          action={
            <div className="flex flex-col items-center gap-2">
              {EXAMPLE_SCOPES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setScope(example)}
                  className="text-sm text-accent hover:underline"
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

  return (
    <AppShell>
      {state.status === "loading" && <LoadingState label="Loading project…" />}

      {state.status === "not-found" && <ErrorState message="Project not found." />}

      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} />}

      {state.status !== "loading" && state.status !== "not-found" && state.status !== "error" && (
        <div>
          <Link
            to={`/projects/${state.project.id}`}
            className="text-sm text-text-muted hover:text-text"
          >
            &larr; {state.project.name}
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-text">Code Review</h1>
          <p className="mt-1 text-sm text-text-muted">
            Read-only — DevForge does not modify your code. Reviews report findings and
            recommendations grounded in indexed code it can find; it does not apply fixes, run
            commands, create commits, or take any action on the repository.
          </p>

          {state.status === "no-repository" && (
            <div className="mt-6">
              <EmptyState
                title="No repository connected"
                description="Connect a GitHub repository in Settings before running a code review."
                action={
                  <Link to={`/projects/${state.project.id}/settings`}>
                    <Button type="button" variant="secondary">
                      Go to Settings
                    </Button>
                  </Link>
                }
              />
            </div>
          )}

          {state.status === "no-index" && (
            <div className="mt-6">
              <EmptyState
                title="Codebase not indexed yet"
                description="Index the connected repository in Settings before running a code review."
                action={
                  <Link to={`/projects/${state.project.id}/settings`}>
                    <Button type="button" variant="secondary">
                      Go to Settings
                    </Button>
                  </Link>
                }
              />
            </div>
          )}

          {state.status === "ready" && (
            <div className="mt-6">
              <ReviewPanel projectId={state.project.id} />
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
