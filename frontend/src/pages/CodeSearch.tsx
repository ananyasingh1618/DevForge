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
import { searchRequest } from "../services/retrievalApi.js";
import type { Project } from "../types/project.js";
import type { SearchResult } from "../types/retrieval.js";

function ResultCard({ result }: { result: SearchResult }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-sm text-text">{result.filePath}</span>
        <span className="shrink-0 text-xs text-text-muted">{result.score.toFixed(3)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
        {result.symbolName && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5">
            {result.symbolType} {result.symbolName}
          </span>
        )}
        <span>
          L{result.startLine}–{result.endLine}
        </span>
        <span>{result.language}</span>
        <span>
          {result.branch}@{result.commitSha.slice(0, 8)}
        </span>
      </div>
      <pre className="overflow-x-auto rounded-md bg-surface-2 p-3 text-xs text-text">
        <code>{result.content}</code>
      </pre>
    </Card>
  );
}

function SearchForm({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [commit, setCommit] = useState("");
  const [limit, setLimit] = useState(10);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    setError(null);
    try {
      const { results: found } = await searchRequest(projectId, {
        query: query.trim(),
        branch: branch.trim() || undefined,
        commit: commit.trim() || undefined,
        limit,
      });
      setResults(found);
    } catch (err) {
      setResults(null);
      setError(err instanceof ApiError ? err.message : "Search failed. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="search-query" className="text-sm font-medium text-text">
            Search query
          </label>
          <input
            id="search-query"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. where do we validate a session token?"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="search-branch" className="text-sm font-medium text-text">
              Branch (optional)
            </label>
            <input
              id="search-branch"
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="defaults to the indexed branch"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="search-commit" className="text-sm font-medium text-text">
              Commit (optional)
            </label>
            <input
              id="search-commit"
              type="text"
              value={commit}
              onChange={(e) => setCommit(e.target.value)}
              placeholder="defaults to the indexed commit"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="search-limit" className="text-sm font-medium text-text">
              Result limit
            </label>
            <input
              id="search-limit"
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus-visible:outline-none"
            />
          </div>
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" loading={searching} disabled={query.trim().length === 0}>
            Search
          </Button>
        </div>
      </form>

      {results && results.length === 0 && (
        <EmptyState
          title="No matching code found"
          description="Try a different query, or confirm the repository has been indexed with the code you expect."
        />
      )}

      {results && results.length > 0 && (
        <div className="flex flex-col gap-3">
          {results.map((result) => (
            <ResultCard key={result.chunkId} result={result} />
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

export function CodeSearch() {
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
          <h1 className="mt-2 text-xl font-semibold text-text">Code search</h1>

          {state.status === "no-repository" && (
            <div className="mt-6">
              <EmptyState
                title="No repository connected"
                description="Connect a GitHub repository in Settings before searching its codebase."
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
                description="Index the connected repository in Settings before searching its codebase."
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
              <SearchForm projectId={state.project.id} />
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
