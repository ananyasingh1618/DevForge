import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { ErrorState, LoadingState } from "../components/StateViews.js";
import { RepositoryConnectionSection } from "../components/RepositoryConnectionSection.js";
import { CodebaseIndexSection } from "../components/CodebaseIndexSection.js";
import { ApiError } from "../services/apiClient.js";
import { getProjectRequest } from "../services/projectsApi.js";
import type { Project } from "../types/project.js";

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; project: Project };

export function ProjectSettings() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // Only sets state from the async continuation, never synchronously — see
  // the matching comment in Projects.tsx.
  const fetchProject = useCallback(() => {
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
    fetchProject();
  }, [fetchProject]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    fetchProject();
  }, [fetchProject]);

  return (
    <AppShell>
      {state.status === "loading" && <LoadingState label="Loading project…" />}

      {state.status === "not-found" && <ErrorState message="Project not found." />}

      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} />}

      {state.status === "ready" && (
        <div>
          <Link
            to={`/projects/${state.project.id}`}
            className="text-sm text-text-muted hover:text-text"
          >
            &larr; {state.project.name}
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-text">Project settings</h1>

          <h2 className="mt-10 text-sm font-medium text-text-muted">GitHub repository</h2>
          <div className="mt-3">
            <RepositoryConnectionSection projectId={state.project.id} />
          </div>

          <h2 className="mt-10 text-sm font-medium text-text-muted">Codebase index</h2>
          <div className="mt-3">
            <CodebaseIndexSection projectId={state.project.id} />
          </div>
        </div>
      )}
    </AppShell>
  );
}
