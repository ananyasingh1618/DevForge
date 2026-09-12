import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Card } from "../components/Card.js";
import { ErrorState, LoadingState } from "../components/StateViews.js";
import { RequirementsSection } from "../components/RequirementsSection.js";
import { PrdSection } from "../components/PrdSection.js";
import { ArchitectureSection } from "../components/ArchitectureSection.js";
import { ApiError } from "../services/apiClient.js";
import { getProjectRequest } from "../services/projectsApi.js";
import type { Project } from "../types/project.js";

// Requirements (Phase 2), PRD (Phase 3), and Architecture (Phase 4) are
// implemented and rendered above this grid, not listed here anymore.
const upcomingCapabilities = [
  {
    title: "Tasks",
    description: "Epics, user stories and a dependency-aware task board.",
  },
  {
    title: "Repository",
    description: "GitHub connection, repository ingestion and AST-aware code indexing.",
  },
  {
    title: "Codebase Q&A",
    description: "Cited, evidence-backed answers about the connected repository.",
  },
  {
    title: "Reviews",
    description: "AI-assisted PR/diff review: bugs, security, performance and quality findings.",
  },
] as const;

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
          <Link to="/projects" className="text-sm text-text-muted hover:text-text">
            &larr; Projects
          </Link>
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

          <h2 className="mt-10 text-sm font-medium text-text-muted">
            Planned capabilities for this project
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {upcomingCapabilities.map((capability) => (
              <Card key={capability.title} className="opacity-80">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium text-text">{capability.title}</h3>
                  <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted">
                    Not yet implemented
                  </span>
                </div>
                <p className="mt-2 text-sm text-text-muted">{capability.description}</p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}
