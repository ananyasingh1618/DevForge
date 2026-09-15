import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../components/AppShell.js";
import { Card } from "../components/Card.js";
import { Button } from "../components/Button.js";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews.js";
import { ApiError } from "../services/apiClient.js";
import { getEvaluationRunRequest, listEvaluationRunsRequest } from "../services/evaluationsApi.js";
import type { CaseResult, EvaluationRunDetail, EvaluationRunSummary } from "../types/evaluation.js";

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function StatusBadge({ passed }: { passed: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        passed ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
      }`}
    >
      {passed ? "Passed" : "Failed"}
    </span>
  );
}

function MetricsTable({ title, metrics }: { title: string; metrics: Record<string, number> }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-muted">{title}</p>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text sm:grid-cols-3">
        {Object.entries(metrics).map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-2">
            <span className="text-text-muted">{key}</span>
            <span className="font-mono">{key === "caseCount" ? value : fmtPct(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FailedCases({ cases }: { cases: CaseResult[] }) {
  const failed = cases.filter((c) => !c.passed);
  if (failed.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {failed.map((c) => (
        <li key={c.caseId} className="text-xs text-text-muted">
          <span className="font-mono text-text">{c.caseId}</span> (score {c.score.toFixed(2)}):{" "}
          {c.failureReasons.join(" ")}
        </li>
      ))}
    </ul>
  );
}

function RunDetail({ detail }: { detail: EvaluationRunDetail }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge passed={detail.passed} />
        <span className="text-xs text-text-muted">
          {detail.mode} · dataset {detail.datasetVersion} · evaluator {detail.evaluatorVersion} · commit{" "}
          {detail.gitCommit.slice(0, 8)} · {new Date(detail.createdAt).toLocaleString()}
        </span>
      </div>

      <div>
        <p className="text-xs font-medium text-text-muted">Regression gates</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {detail.reportJson.gates.map((g) => (
            <li key={g.name} className="text-xs">
              <span>{g.passed ? "✅" : "❌"}</span> <span className="text-text">{g.name}</span>{" "}
              <span className="text-text-muted">— {g.detail}</span>
            </li>
          ))}
        </ul>
      </div>

      <MetricsTable title="Retrieval" metrics={detail.retrievalMetrics} />
      <FailedCases cases={detail.reportJson.retrieval.cases} />

      <MetricsTable title="Codebase Q&A" metrics={detail.qaMetrics} />
      <FailedCases cases={detail.reportJson.qa.cases} />

      <MetricsTable title="Code Review" metrics={detail.reviewMetrics} />
      <FailedCases cases={detail.reportJson.review.cases} />
    </Card>
  );
}

function RunRow({
  run,
  expanded,
  detail,
  detailError,
  onToggle,
}: {
  run: EvaluationRunSummary;
  expanded: boolean;
  detail: EvaluationRunDetail | null;
  detailError: string | null;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-left hover:bg-surface-2"
      >
        <div className="flex items-center gap-2">
          <StatusBadge passed={run.passed} />
          <span className="text-sm text-text">
            {run.totalCases - run.failedCaseCount}/{run.totalCases} cases · {run.mode}
          </span>
        </div>
        <span className="text-xs text-text-muted">{new Date(run.createdAt).toLocaleString()}</span>
      </button>
      {expanded && detailError && <ErrorState message={detailError} />}
      {expanded && !detailError && !detail && <LoadingState label="Loading run detail…" />}
      {expanded && detail && <RunDetail detail={detail} />}
    </div>
  );
}

type PageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; runs: EvaluationRunSummary[] };

export function Evaluations() {
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, EvaluationRunDetail>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});

  const fetchRuns = useCallback(() => {
    listEvaluationRunsRequest()
      .then(({ runs }) => setState({ status: "ready", runs }))
      .catch((err: unknown) =>
        setState({ status: "error", message: err instanceof ApiError ? err.message : "Couldn't load evaluation runs." }),
      );
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  function toggle(runId: string) {
    const next = expandedId === runId ? null : runId;
    setExpandedId(next);
    if (next && !details[next]) {
      getEvaluationRunRequest(next)
        .then((detail) => setDetails((prev) => ({ ...prev, [next]: detail })))
        .catch((err: unknown) =>
          setDetailErrors((prev) => ({
            ...prev,
            [next]: err instanceof ApiError ? err.message : "Couldn't load this run's detail.",
          })),
        );
    }
  }

  const retry = useCallback(() => {
    setState({ status: "loading" });
    fetchRuns();
  }, [fetchRuns]);

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Evaluations</h1>
          <p className="mt-1 text-sm text-text-muted">
            Retrieval, Codebase Q&amp;A, and AI Code Review quality measurements against a fixed,
            version-controlled fixture dataset — not tied to any one project's repository. Run{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5">pnpm eval</code> to generate a new
            report.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={retry}>
          Refresh
        </Button>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {state.status === "loading" && <LoadingState label="Loading evaluation runs…" />}
        {state.status === "error" && <ErrorState message={state.message} onRetry={retry} />}
        {state.status === "ready" && state.runs.length === 0 && (
          <EmptyState
            title="No evaluation runs yet"
            description="Run `pnpm eval` from the repository root to generate the first report."
          />
        )}
        {state.status === "ready" &&
          state.runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              expanded={expandedId === run.id}
              detail={details[run.id] ?? null}
              detailError={detailErrors[run.id] ?? null}
              onToggle={() => toggle(run.id)}
            />
          ))}
      </div>
    </AppShell>
  );
}
