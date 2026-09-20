import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "motion/react";
import { AppShell } from "../components/AppShell.js";
import { Badge } from "../components/Badge.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { PageHeader } from "../components/PageHeader.js";
import { ErrorState } from "../components/StateViews.js";
import { SkeletonPage } from "../components/Skeleton.js";
import { IntelligenceFlow } from "../components/IntelligenceFlow.js";
import type { FlowStage, FlowStageStatus } from "../components/IntelligenceFlow.js";
import { ActivityTimeline } from "../components/ActivityTimeline.js";
import type { TimelineEvent, TimelineTone } from "../components/ActivityTimeline.js";
import {
  IconArrowRight,
  IconDatabase,
  IconFileText,
  IconGithub,
  IconLayers,
  IconMessage,
  IconShieldCheck,
  IconSparkles,
} from "../components/icons.js";
import { ApiError } from "../services/apiClient.js";
import { getProjectRequest } from "../services/projectsApi.js";
import { getRepositoryConnectionRequest } from "../services/repositoryApi.js";
import { getCodebaseIndexRequest } from "../services/codebaseIndexApi.js";
import { listJobsRequest } from "../services/jobsApi.js";
import { listRequirementsVersionsRequest } from "../services/requirementsApi.js";
import { listQuestionsRequest } from "../services/qaApi.js";
import { listReviewsRequest } from "../services/codeReviewApi.js";
import type { Project, ProjectStatus } from "../types/project.js";
import type { RepositoryConnection } from "../types/repository.js";
import type { CodebaseIndex } from "../types/codebaseIndex.js";
import type { Job } from "../types/job.js";
import type { RequirementsVersion } from "../types/requirements.js";
import type { QaResult } from "../types/qa.js";
import type { CodeReview } from "../types/codeReview.js";

const projectStatusTone: Record<ProjectStatus, "neutral" | "success"> = {
  planning: "neutral",
  active: "success",
  archived: "neutral",
};

type DashboardData = {
  project: Project;
  connection: RepositoryConnection | null;
  index: CodebaseIndex | null;
  jobs: Job[];
  requirements: RequirementsVersion[];
  questions: QaResult[];
  reviews: CodeReview[];
};

type PageState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DashboardData };

function buildStages(data: DashboardData): FlowStage[] {
  const { project, connection, index, requirements, questions, reviews } = data;
  void project;

  const hasRequirements = requirements.length > 0;
  const requirementsStatus: FlowStageStatus = hasRequirements ? "completed" : "not-configured";

  const repoStatus: FlowStageStatus = !connection
    ? "not-configured"
    : connection.status === "verified"
      ? "completed"
      : connection.status === "error"
        ? "failed"
        : "running";

  const indexStatus: FlowStageStatus = !index
    ? "not-configured"
    : index.status === "completed"
      ? "completed"
      : index.status === "failed"
        ? "failed"
        : index.status === "indexing"
          ? "running"
          : "ready";

  const intelligenceStatus: FlowStageStatus =
    index?.status === "completed" ? "completed" : connection && index ? "ready" : "not-configured";

  const activityCount = questions.length + reviews.length;
  const qaReviewStatus: FlowStageStatus =
    activityCount > 0 ? "completed" : intelligenceStatus === "completed" ? "ready" : "not-configured";

  return [
    {
      key: "requirements",
      label: "Requirements",
      caption: hasRequirements
        ? `${requirements.length} version${requirements.length === 1 ? "" : "s"} analyzed`
        : "Describe your idea to begin",
      status: requirementsStatus,
      to: `/projects/${project.id}/requirements`,
      icon: IconFileText,
    },
    {
      key: "repository",
      label: "Repository",
      caption: connection
        ? `${connection.githubOwner}/${connection.githubRepo} — ${connection.status}`
        : "No repository connected",
      status: repoStatus,
      to: `/projects/${project.id}/repository`,
      icon: IconGithub,
    },
    {
      key: "indexing",
      label: "Indexing",
      caption: index
        ? `${index.parsedFileCount}/${index.fileCount} files parsed`
        : "Not started",
      status: indexStatus,
      to: `/projects/${project.id}/indexing`,
      icon: IconDatabase,
    },
    {
      key: "intelligence",
      label: "Code Intelligence",
      caption:
        intelligenceStatus === "completed"
          ? "Ready to ground Q&A and reviews"
          : intelligenceStatus === "ready"
            ? "Waiting on indexing to finish"
            : "Needs a connected, indexed repository",
      status: intelligenceStatus,
      to: `/projects/${project.id}/indexing`,
      icon: IconLayers,
    },
    {
      key: "qa-review",
      label: "Q&A / Review",
      caption:
        activityCount > 0
          ? `${questions.length} question${questions.length === 1 ? "" : "s"} · ${reviews.length} review${reviews.length === 1 ? "" : "s"}`
          : qaReviewStatus === "ready"
            ? "Ready — ask a question or run a review"
            : "Needs code intelligence first",
      status: qaReviewStatus,
      to: `/projects/${project.id}/qa`,
      icon: IconMessage,
    },
  ];
}

function buildTimeline(data: DashboardData): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const v of data.requirements) {
    events.push({
      id: `req-${v.id}`,
      label: `Requirements analyzed — v${v.version}`,
      detail: v.ideaText.length > 90 ? `${v.ideaText.slice(0, 90)}…` : v.ideaText,
      timestamp: v.createdAt,
      tone: "accent",
      icon: IconFileText,
    });
  }

  if (data.connection) {
    events.push({
      id: `repo-${data.connection.id}`,
      label: `Repository connected — ${data.connection.githubOwner}/${data.connection.githubRepo}`,
      detail: data.connection.status === "error" ? data.connection.lastError ?? undefined : undefined,
      timestamp: data.connection.createdAt,
      tone: data.connection.status === "error" ? "danger" : "success",
      icon: IconGithub,
    });
  }

  if (data.index) {
    if (data.index.startedAt) {
      events.push({
        id: `idx-start-${data.index.id}`,
        label: "Indexing started",
        detail: `Branch ${data.index.branch}`,
        timestamp: data.index.startedAt,
        tone: "accent",
        icon: IconDatabase,
      });
    }
    if (data.index.status === "completed" && data.index.completedAt) {
      events.push({
        id: `idx-done-${data.index.id}`,
        label: "Indexing completed",
        detail: `${data.index.parsedFileCount}/${data.index.fileCount} files parsed`,
        timestamp: data.index.completedAt,
        tone: "success",
        icon: IconDatabase,
      });
    }
    if (data.index.status === "failed") {
      events.push({
        id: `idx-failed-${data.index.id}`,
        label: "Indexing failed",
        detail: data.index.error ?? undefined,
        timestamp: data.index.completedAt ?? data.index.updatedAt,
        tone: "danger",
        icon: IconDatabase,
      });
    }
  }

  const jobTone: Record<Job["status"], TimelineTone> = {
    queued: "neutral",
    running: "accent",
    completed: "success",
    failed: "danger",
    cancelled: "neutral",
    timed_out: "danger",
  };
  for (const job of data.jobs) {
    events.push({
      id: `job-${job.id}`,
      label: `${job.type} job ${job.status.replace("_", " ")}${job.retryCount > 0 ? ` (retry ${job.retryCount}/${job.maxRetries})` : ""}`,
      detail: job.errorMessage ?? undefined,
      timestamp: job.completedAt ?? job.cancelledAt ?? job.createdAt,
      tone: jobTone[job.status],
      icon: IconLayers,
    });
  }

  for (const q of data.questions) {
    events.push({
      id: `qa-${q.questionId}`,
      label: `Asked: ${q.question.length > 70 ? `${q.question.slice(0, 70)}…` : q.question}`,
      detail: q.insufficientEvidence ? "Insufficient evidence in the indexed codebase" : undefined,
      timestamp: q.createdAt,
      tone: q.insufficientEvidence ? "neutral" : "accent",
      icon: IconMessage,
    });
  }

  for (const r of data.reviews) {
    events.push({
      id: `review-${r.reviewId}`,
      label: `Code review ${r.status}${r.status === "completed" ? ` — ${r.findingCount} finding${r.findingCount === 1 ? "" : "s"}` : ""}`,
      detail: r.scope || "General review",
      timestamp: r.createdAt,
      tone: r.status === "failed" ? "danger" : "accent",
      icon: IconShieldCheck,
    });
  }

  return events
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 12);
}

function QuickAction({
  to,
  icon,
  title,
  description,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-4 transition-all duration-150 hover:border-accent/50 hover:bg-surface-2"
    >
      <div className="flex items-center justify-between">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">{icon}</span>
        <IconArrowRight className="h-3.5 w-3.5 text-text-faint transition-all group-hover:translate-x-0.5 group-hover:text-accent" />
      </div>
      <div>
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{description}</p>
      </div>
    </Link>
  );
}

export function ProjectOverview() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<PageState>({ status: "loading" });

  const fetchData = useCallback(() => {
    if (!id) return;
    getProjectRequest(id)
      .then(async ({ project }) => {
        const [connectionRes, indexRes, jobsRes, requirementsRes, questionsRes, reviewsRes] = await Promise.all([
          getRepositoryConnectionRequest(id).catch(() => ({ connection: null })),
          getCodebaseIndexRequest(id).catch(() => ({ index: null })),
          listJobsRequest(id).catch(() => ({ jobs: [] })),
          listRequirementsVersionsRequest(id).catch(() => ({ versions: [] })),
          listQuestionsRequest(id).catch(() => ({ questions: [] })),
          listReviewsRequest(id).catch(() => ({ reviews: [] })),
        ]);
        setState({
          status: "ready",
          data: {
            project,
            connection: connectionRes.connection,
            index: indexRes.index,
            jobs: jobsRes.jobs,
            requirements: requirementsRes.versions,
            questions: questionsRes.questions,
            reviews: reviewsRes.reviews,
          },
        });
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
    fetchData();
  }, [fetchData]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    fetchData();
  }, [fetchData]);

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

  const { project, index } = state.data;
  const indexReady = index?.status === "completed";
  const stages = buildStages(state.data);
  const timeline = buildTimeline(state.data);

  return (
    <AppShell projectId={project.id} projectName={project.name}>
      <div className="animate-fade-in flex flex-col gap-10">
        <PageHeader
          eyebrow="Project intelligence"
          title={
            <span className="flex flex-wrap items-center gap-2.5">
              {project.name}
              <Badge tone={projectStatusTone[project.status]}>{project.status}</Badge>
            </span>
          }
          description={project.description || "No description yet — add one from Settings."}
          actions={
            <>
              <Link to={`/projects/${project.id}/requirements`}>
                <Button type="button">
                  <IconSparkles className="h-4 w-4" />
                  Analyze Project
                </Button>
              </Link>
              <Link to={`/projects/${project.id}/qa`}>
                <Button type="button" variant="secondary">
                  <IconMessage className="h-4 w-4" />
                  Ask Codebase
                </Button>
              </Link>
            </>
          }
        />

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="overflow-hidden rounded-xl border border-border bg-surface"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-text">Intelligence pipeline</h2>
            <span className="text-xs text-text-faint">Idea → Requirements → Repository → Indexing → Intelligence → Q&amp;A/Review</span>
          </div>
          <IntelligenceFlow stages={stages} />
        </motion.div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction
            to={`/projects/${project.id}/requirements`}
            icon={<IconFileText className="h-4 w-4" />}
            title="Analyze requirements"
            description="Turn a project idea into structured, versioned requirements."
          />
          <QuickAction
            to={`/projects/${project.id}/repository`}
            icon={<IconGithub className="h-4 w-4" />}
            title="Connect repository"
            description="Link a GitHub repository so DevForge can ground results in real code."
          />
          <QuickAction
            to={`/projects/${project.id}/qa`}
            icon={<IconMessage className="h-4 w-4" />}
            title="Ask codebase"
            description={indexReady ? "Ask a natural-language question about the indexed code." : "Requires a completed index."}
          />
          <QuickAction
            to={`/projects/${project.id}/reviews`}
            icon={<IconShieldCheck className="h-4 w-4" />}
            title="Review code"
            description={indexReady ? "Run an AI code review grounded in the indexed repository." : "Requires a completed index."}
          />
        </div>

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">Activity</h2>
            <Link to={`/projects/${project.id}/jobs`} className="text-xs text-accent hover:underline">
              View all jobs
            </Link>
          </div>
          <div className="mt-4">
            <ActivityTimeline
              events={timeline}
              emptyMessage="No activity yet — analyze requirements, connect a repository, or start an indexing job to get going."
            />
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
