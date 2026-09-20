import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Badge, type BadgeTone } from "../components/Badge.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { EmptyState, ErrorState, LoadingState } from "../components/StateViews.js";
import { IconFolder, IconPlus } from "../components/icons.js";
import { listProjectsRequest } from "../services/projectsApi.js";
import type { Project } from "../types/project.js";

const statusTone: Record<Project["status"], BadgeTone> = {
  planning: "neutral",
  active: "success",
  archived: "neutral",
};

export function Projects() {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; projects: Project[] }
  >({ status: "loading" });

  // Only sets state from the async continuation (.then/.catch), never
  // synchronously — so calling this directly from the mount effect below
  // doesn't trip the "no setState synchronously in an effect" rule.
  const fetchProjects = useCallback(() => {
    listProjectsRequest()
      .then(({ projects }) => setState({ status: "ready", projects }))
      .catch(() => setState({ status: "error", message: "Couldn't load your projects." }));
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Retry is a click handler, not an effect, so resetting to "loading"
  // synchronously here (for immediate spinner feedback) is fine.
  const retry = useCallback(() => {
    setState({ status: "loading" });
    fetchProjects();
  }, [fetchProjects]);

  return (
    <AppShell>
      <div className="animate-fade-in flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-text">Projects</h1>
            <p className="mt-1.5 text-sm text-text-muted">Every project you're building with DevForge.</p>
          </div>
          <Link to="/projects/new">
            <Button type="button">
              <IconPlus className="h-4 w-4" />
              New project
            </Button>
          </Link>
        </div>

        {state.status === "loading" && <LoadingState label="Loading projects…" />}
        {state.status === "error" && <ErrorState message={state.message} onRetry={retry} />}
        {state.status === "ready" && state.projects.length === 0 && (
          <EmptyState
            icon={<IconFolder className="h-5 w-5" />}
            title="No projects yet"
            description="Create your first project to start turning an idea into requirements, architecture and tasks."
            action={
              <Link to="/projects/new">
                <Button type="button">New project</Button>
              </Link>
            }
          />
        )}
        {state.status === "ready" && state.projects.length > 0 && (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {state.projects.map((project) => (
              <li key={project.id}>
                <Link to={`/projects/${project.id}`}>
                  <Card interactive className="h-full">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-medium text-text">{project.name}</h2>
                      <Badge tone={statusTone[project.status]}>{project.status}</Badge>
                    </div>
                    {project.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-text-muted">
                        {project.description}
                      </p>
                    )}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
