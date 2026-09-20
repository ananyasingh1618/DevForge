import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { ErrorState } from "../components/StateViews.js";
import { SkeletonPage } from "../components/Skeleton.js";
import { CodebaseIndexSection } from "../components/CodebaseIndexSection.js";
import { IconSearch } from "../components/icons.js";
import { ApiError } from "../services/apiClient.js";
import { getProjectRequest } from "../services/projectsApi.js";
import type { Project } from "../types/project.js";

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; project: Project };

export function Indexing() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });

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

  if (state.status === "loading") {
    return (
      <AppShell projectId={id}>
        <SkeletonPage />
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-text">Indexing</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-text-muted">
              Parses the connected repository's selected branch into browsable files and symbols
              — required before Q&amp;A or Code Review can ground an answer in real code.
            </p>
          </div>
          <Link
            to={`/projects/${state.project.id}/search`}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <IconSearch className="h-4 w-4" />
            Search this codebase
          </Link>
        </div>
        <CodebaseIndexSection projectId={state.project.id} />
      </div>
    </AppShell>
  );
}
