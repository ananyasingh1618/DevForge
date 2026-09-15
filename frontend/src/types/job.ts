export type JobType = "indexing" | "qa" | "review" | "evaluation";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";

export type Job = {
  id: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  progress: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  correlationId: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};
