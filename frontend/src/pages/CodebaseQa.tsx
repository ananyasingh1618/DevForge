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
import { askQuestionRequest, listQuestionsRequest } from "../services/qaApi.js";
import type { Project } from "../types/project.js";
import type { QaResult } from "../types/qa.js";

const EXAMPLE_QUESTIONS = [
  "Where is authentication implemented?",
  "How does PRD generation work?",
  "Which files handle GitHub integration?",
];

function SourceRow({ source }: { source: QaResult["sources"][number] }) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
      {source.cited && (
        <span className="rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent">cited</span>
      )}
      <span className="truncate font-mono text-text">{source.filePath}</span>
      {source.symbolName && <span>{source.symbolName}</span>}
      <span>
        L{source.startLine}–{source.endLine}
      </span>
      <span>{source.score.toFixed(3)}</span>
    </li>
  );
}

function AnswerCard({ result }: { result: QaResult }) {
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-medium text-text-muted">Question</p>
        <p className="text-sm text-text">{result.question}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-text-muted">Answer</p>
        <p className="whitespace-pre-wrap text-sm text-text">{result.answer}</p>
        {result.insufficientEvidence && (
          <p className="mt-1 text-xs text-text-muted">
            DevForge indicated the indexed codebase didn't have enough evidence to fully answer
            this question.
          </p>
        )}
      </div>
      {result.sources.length > 0 && (
        <div>
          <p className="text-xs font-medium text-text-muted">Sources</p>
          <ul className="mt-1 flex flex-col gap-1">
            {result.sources.map((source) => (
              <SourceRow key={`${source.filePath}:${source.startLine}-${source.endLine}`} source={source} />
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-text-muted">
        {result.branch}@{result.commit.slice(0, 8)} · {new Date(result.createdAt).toLocaleString()}
      </p>
    </Card>
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

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="qa-question" className="text-sm font-medium text-text">
            Ask a question about this codebase
          </label>
          <input
            id="qa-question"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Where is authentication implemented?"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
          />
        </div>
        {askError && (
          <p className="text-sm text-danger" role="alert">
            {askError}
          </p>
        )}
        <div>
          <Button type="submit" loading={asking} disabled={question.trim().length === 0}>
            {history && history.length > 0 ? "Ask a follow-up question" : "Ask"}
          </Button>
        </div>
      </form>

      {asking && (
        <LoadingState label="Searching the indexed codebase, assembling context, and generating an answer…" />
      )}

      {!asking && historyError && <ErrorState message={historyError} />}

      {!asking && !historyError && history && history.length === 0 && (
        <EmptyState
          title="No questions asked yet"
          description="Ask a natural-language question about the connected repository — DevForge searches the indexed codebase for relevant code and grounds its answer in what it finds."
          action={
            <div className="flex flex-col items-center gap-2">
              {EXAMPLE_QUESTIONS.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuestion(example)}
                  className="text-sm text-accent hover:underline"
                >
                  {example}
                </button>
              ))}
            </div>
          }
        />
      )}

      {!asking && history && history.length > 0 && (
        <div className="flex flex-col gap-3">
          {history.map((result) => (
            <AnswerCard key={result.questionId} result={result} />
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
          <h1 className="mt-2 text-xl font-semibold text-text">Codebase Q&amp;A</h1>
          <p className="mt-1 text-sm text-text-muted">
            Read-only: DevForge answers from indexed code it can find — it does not modify code,
            open pull requests, or take any action on the repository.
          </p>

          {state.status === "no-repository" && (
            <div className="mt-6">
              <EmptyState
                title="No repository connected"
                description="Connect a GitHub repository in Settings before asking questions about its codebase."
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
                description="Index the connected repository in Settings before asking questions about its codebase."
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
              <QaPanel projectId={state.project.id} />
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
