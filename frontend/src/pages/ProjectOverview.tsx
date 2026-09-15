import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { ErrorState, LoadingState } from "../components/StateViews.js";
import { RequirementsSection } from "../components/RequirementsSection.js";
import { PrdSection } from "../components/PrdSection.js";
import { ArchitectureSection } from "../components/ArchitectureSection.js";
import { EpicSection } from "../components/EpicSection.js";
import { TaskSection } from "../components/TaskSection.js";
import { ApiError } from "../services/apiClient.js";
import { getProjectRequest } from "../services/projectsApi.js";
import type { Project } from "../types/project.js";

// Requirements (Phase 2), PRD (Phase 3), Architecture (Phase 4), Epics &
// Tasks (Phase 5), GitHub repository connection (Phase 6), AST parsing &
// codebase indexing (Phase 7 — file/symbol extraction, browsable in
// Settings), retrieval/semantic search (Phase 8 — code chunking, embeddings,
// ranked search, browsable via the "Search" link above), codebase Q&A
// (Phase 9 — a grounded, read-only Q&A layer over Phase 8 retrieval,
// browsable via the "Q&A" link above), and AI code review (Phase 10 — a
// read-only review layer over Phase 8 retrieval, browsable via the
// "Reviews" link above; it reports findings and recommendations grounded
// in retrieved evidence, it does not modify code or take any repository
// action) are all implemented. Nothing remains planned-but-unbuilt at this
// point, so the "Planned capabilities" section that used to list them here
// has been removed rather than left permanently empty.

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; project: Project };

export function ProjectOverview() {
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

      {state.status === "not-found" && (
        <ErrorState message="Project not found." />
      )}

      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} />}

      {state.status === "ready" && (
        <div>
          <div className="flex items-center justify-between gap-4">
            <Link to="/projects" className="text-sm text-text-muted hover:text-text">
              &larr; Projects
            </Link>
            <div className="flex items-center gap-4">
              <Link
                to={`/projects/${state.project.id}/search`}
                className="text-sm text-text-muted hover:text-text"
              >
                Search
              </Link>
              <Link
                to={`/projects/${state.project.id}/qa`}
                className="text-sm text-text-muted hover:text-text"
              >
                Q&amp;A
              </Link>
              <Link
                to={`/projects/${state.project.id}/reviews`}
                className="text-sm text-text-muted hover:text-text"
              >
                Reviews
              </Link>
              <Link
                to={`/projects/${state.project.id}/jobs`}
                className="text-sm text-text-muted hover:text-text"
              >
                Jobs
              </Link>
              <Link
                to={`/projects/${state.project.id}/settings`}
                className="text-sm text-text-muted hover:text-text"
              >
                Settings
              </Link>
            </div>
          </div>
          <div className="mt-2 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-text">{state.project.name}</h1>
              {state.project.description && (
                <p className="mt-1 text-sm text-text-muted">{state.project.description}</p>
              )}
            </div>
            <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-muted">
              {state.project.status}
            </span>
          </div>

          <h2 className="mt-10 text-sm font-medium text-text-muted">Requirements</h2>
          <div className="mt-3">
            <RequirementsSection projectId={state.project.id} />
          </div>

          <h2 className="mt-10 text-sm font-medium text-text-muted">PRD</h2>
          <div className="mt-3">
            <PrdSection projectId={state.project.id} />
          </div>

          <h2 className="mt-10 text-sm font-medium text-text-muted">Architecture</h2>
          <div className="mt-3">
            <ArchitectureSection projectId={state.project.id} />
          </div>

          <h2 className="mt-10 text-sm font-medium text-text-muted">Epics</h2>
          <div className="mt-3">
            <EpicSection projectId={state.project.id} />
          </div>

          <h2 className="mt-10 text-sm font-medium text-text-muted">Tasks</h2>
          <div className="mt-3">
            <TaskSection projectId={state.project.id} />
          </div>

        </div>
      )}
    </AppShell>
  );
}
