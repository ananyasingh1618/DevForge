import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell.js";
import { ErrorState } from "../components/StateViews.js";
import { SkeletonPage } from "../components/Skeleton.js";
import { RequirementsSection } from "../components/RequirementsSection.js";
import { PrdSection } from "../components/PrdSection.js";
import { ArchitectureSection } from "../components/ArchitectureSection.js";
import { EpicSection } from "../components/EpicSection.js";
import { TaskSection } from "../components/TaskSection.js";
import { ApiError } from "../services/apiClient.js";
import { getProjectRequest } from "../services/projectsApi.js";
import type { Project } from "../types/project.js";

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; project: Project };

const SECTIONS = [
  { id: "requirements", title: "Requirements", description: "Structured requirements analyzed from your project idea." },
  { id: "prd", title: "PRD", description: "A Product Requirements Document synthesized from the active requirements." },
  { id: "architecture", title: "Architecture", description: "A technical architecture proposal built from the active PRD." },
  { id: "epics", title: "Epics", description: "Large units of work broken out from the active architecture." },
  { id: "tasks", title: "Tasks", description: "Actionable development tasks broken out from the active epics." },
] as const;

export function Requirements() {
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
      <div className="animate-fade-in flex flex-col gap-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Requirements</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-text-muted">
            Turn a project idea into structured requirements, then generate a PRD, technical
            architecture, epics, and tasks from each other in sequence.
          </p>
        </div>

        <section id={SECTIONS[0].id} className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold text-text">{SECTIONS[0].title}</h2>
            <p className="text-sm text-text-muted">{SECTIONS[0].description}</p>
          </div>
          <RequirementsSection projectId={state.project.id} />
        </section>

        <section id={SECTIONS[1].id} className="flex flex-col gap-3 border-t border-border pt-8">
          <div>
            <h2 className="text-base font-semibold text-text">{SECTIONS[1].title}</h2>
            <p className="text-sm text-text-muted">{SECTIONS[1].description}</p>
          </div>
          <PrdSection projectId={state.project.id} />
        </section>

        <section id={SECTIONS[2].id} className="flex flex-col gap-3 border-t border-border pt-8">
          <div>
            <h2 className="text-base font-semibold text-text">{SECTIONS[2].title}</h2>
            <p className="text-sm text-text-muted">{SECTIONS[2].description}</p>
          </div>
          <ArchitectureSection projectId={state.project.id} />
        </section>

        <section id={SECTIONS[3].id} className="flex flex-col gap-3 border-t border-border pt-8">
          <div>
            <h2 className="text-base font-semibold text-text">{SECTIONS[3].title}</h2>
            <p className="text-sm text-text-muted">{SECTIONS[3].description}</p>
          </div>
          <EpicSection projectId={state.project.id} />
        </section>

        <section id={SECTIONS[4].id} className="flex flex-col gap-3 border-t border-border pt-8">
          <div>
            <h2 className="text-base font-semibold text-text">{SECTIONS[4].title}</h2>
            <p className="text-sm text-text-muted">{SECTIONS[4].description}</p>
          </div>
          <TaskSection projectId={state.project.id} />
        </section>
      </div>
    </AppShell>
  );
}
