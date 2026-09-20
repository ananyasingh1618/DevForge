import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { Badge } from "../components/Badge.js";
import { Card } from "../components/Card.js";
import { ErrorState } from "../components/StateViews.js";
import { SkeletonPage } from "../components/Skeleton.js";
import { IconDatabase, IconGithub } from "../components/icons.js";
import { ApiError } from "../services/apiClient.js";
import { getProjectRequest } from "../services/projectsApi.js";
import type { Project, ProjectStatus } from "../types/project.js";

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; project: Project };

const statusTone: Record<ProjectStatus, "neutral" | "success"> = {
  planning: "neutral",
  active: "success",
  archived: "neutral",
};

export function ProjectSettings() {
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

  const { project } = state;

  return (
    <AppShell projectId={project.id} projectName={project.name}>
      <div className="animate-fade-in flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Settings</h1>
          <p className="mt-1.5 text-sm text-text-muted">Project details and where to manage them.</p>
        </div>

        <Card className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-text">About this project</h2>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-text-muted">Name</dt>
              <dd className="mt-0.5 text-text">{project.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Status</dt>
              <dd className="mt-0.5">
                <Badge tone={statusTone[project.status]}>{project.status}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Description</dt>
              <dd className="mt-0.5 text-text">{project.description || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Created</dt>
              <dd className="mt-0.5 text-text">{new Date(project.createdAt).toLocaleString()}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-text-muted">Project ID</dt>
              <dd className="mt-0.5 font-mono text-xs text-text-muted">{project.id}</dd>
            </div>
          </dl>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text">Manage elsewhere</h2>
          <p className="text-sm text-text-muted">
            The GitHub connection and codebase index each have their own dedicated page, with more
            room for status detail and history.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              to={`/projects/${project.id}/repository`}
              className="flex flex-1 items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm text-text transition-colors hover:border-accent hover:bg-accent-soft"
            >
              <IconGithub className="h-4 w-4 text-text-muted" />
              Repository connection
            </Link>
            <Link
              to={`/projects/${project.id}/indexing`}
              className="flex flex-1 items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm text-text transition-colors hover:border-accent hover:bg-accent-soft"
            >
              <IconDatabase className="h-4 w-4 text-text-muted" />
              Codebase indexing
            </Link>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
