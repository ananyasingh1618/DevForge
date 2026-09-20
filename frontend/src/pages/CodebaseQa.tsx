import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Markdown } from "../components/Markdown.js";
import { SourceEvidence } from "../components/SourceEvidence.js";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews.js";
import { IconAlertTriangle, IconMessage, IconSparkles, IconTarget } from "../components/icons.js";
import { ApiError } from "../services/apiClient.js";
import { getProjectRequest } from "../services/projectsApi.js";
import { getRepositoryConnectionRequest } from "../services/repositoryApi.js";
import { getCodebaseIndexRequest } from "../services/codebaseIndexApi.js";
import { askQuestionRequest, listQuestionsRequest } from "../services/qaApi.js";
import type { Project } from "../types/project.js";
import type { QaResult } from "../types/qa.js";

const EXAMPLE_QUESTIONS = [
  "Where is authentication implemented?",
  "How does PRD generation work?",
  "Which files handle GitHub integration?",
];

function AnswerCard({ result }: { result: QaResult }) {
  const citedCount = result.sources.filter((s) => s.cited).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <div className="max-w-2xl rounded-2xl rounded-tr-sm bg-accent-soft px-4 py-2.5 text-sm text-text">
          {result.question}
        </div>
      </div>
      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <IconSparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <Markdown text={result.answer} />
            {result.insufficientEvidence && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
                DevForge indicated the indexed codebase didn't have enough evidence to fully
                answer this question.
              </p>
            )}
          </div>
        </div>
        {result.sources.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-text-muted">
                Evidence <span className="text-text-faint">({result.sources.length})</span>
              </p>
              <span className="flex items-center gap-1 text-[11px] text-text-faint">
                <IconTarget className="h-3 w-3" />
                {citedCount}/{result.sources.length} grounded the answer
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {result.sources.map((source) => (
                <SourceEvidence key={`${source.filePath}:${source.startLine}-${source.endLine}`} source={source} />
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-text-faint">
          {result.branch}@{result.commit.slice(0, 8)} · {new Date(result.createdAt).toLocaleString()}
        </p>
      </Card>
    </div>
  );
}

function QaPanel({ projectId }: { projectId: string }) {
  const [history, setHistory] = useState<QaResult[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  useEffect(() => {
    listQuestionsRequest(projectId)
      .then(({ questions }) => setHistory(questions))
      .catch((err: unknown) =>
        setHistoryError(err instanceof ApiError ? err.message : "Couldn't load question history."),
      );
  }, [projectId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = question.trim();
    if (trimmed.length === 0) return;
    setAsking(true);
    setAskError(null);
    try {
      const result = await askQuestionRequest(projectId, trimmed);
      setHistory((prev) => [result, ...(prev ?? [])]);
      setQuestion("");
    } catch (err) {
      setAskError(err instanceof ApiError ? err.message : "Couldn't get an answer. Please try again.");
    } finally {
      setAsking(false);
    }
  }

  const hasHistory = history !== null && history.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {!asking && !historyError && history && history.length === 0 && (
        <EmptyState
          icon={<IconMessage className="h-5 w-5" />}
          title="No questions asked yet"
          description="Ask a natural-language question about the connected repository — DevForge searches the indexed codebase for relevant code and grounds its answer in what it finds."
          action={
            <div className="flex flex-col items-stretch gap-2 sm:min-w-[22rem]">
              {EXAMPLE_QUESTIONS.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuestion(example)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm text-text transition-colors hover:border-accent hover:bg-accent-soft"
                >
                  {example}
                </button>
              ))}
            </div>
          }
        />
      )}

      {!historyError && hasHistory && (
        <div className="flex flex-col gap-6">
          {history.map((result) => (
            <AnswerCard key={result.questionId} result={result} />
          ))}
        </div>
      )}

      {asking && (
        <LoadingState label="Searching the indexed codebase, assembling context, and generating an answer…" />
      )}

      {!asking && historyError && <ErrorState message={historyError} />}

      {askError && (
        <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {askError}
        </p>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="sticky bottom-6 flex flex-col gap-2">
        <label htmlFor="qa-question" className="sr-only">
          Ask a question about this codebase
        </label>
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 shadow-[var(--shadow-popover)] focus-within:border-accent">
          <textarea
            id="qa-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about this codebase — e.g. Where is authentication implemented?"
            rows={2}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
          />
          <Button type="submit" loading={asking} disabled={question.trim().length === 0}>
            {hasHistory ? "Ask a follow-up question" : "Ask"}
          </Button>
        </div>
      </form>
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

export function CodebaseQa() {
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
          <h1 className="text-2xl font-semibold tracking-tight text-text">Codebase Q&amp;A</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-text-muted">
            Read-only: DevForge answers from indexed code it can find — it does not modify code,
            open pull requests, or take any action on the repository.
          </p>
        </div>

        {state.status === "no-repository" && (
          <EmptyState
            icon={<IconMessage className="h-5 w-5" />}
            title="No repository connected"
            description="Connect a GitHub repository before asking questions about its codebase."
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
            icon={<IconMessage className="h-5 w-5" />}
            title="Codebase not indexed yet"
            description="Index the connected repository before asking questions about its codebase."
            action={
              <Link to={`/projects/${state.project.id}/indexing`}>
                <Button type="button" variant="secondary">
                  Go to indexing
                </Button>
              </Link>
            }
          />
        )}

        {state.status === "ready" && <QaPanel projectId={state.project.id} />}
      </div>
    </AppShell>
  );
}
