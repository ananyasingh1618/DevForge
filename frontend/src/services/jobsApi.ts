import { apiRequest } from "./apiClient.js";
import type { Job, JobType } from "../types/job.js";

export function createJobRequest(
  projectId: string,
  type: JobType,
  input: Record<string, unknown>,
): Promise<{ job: Job }> {
  return apiRequest(`/projects/${projectId}/jobs`, {
    method: "POST",
    body: JSON.stringify({ type, input }),
  });
}

export function listJobsRequest(projectId: string): Promise<{ jobs: Job[] }> {
  return apiRequest(`/projects/${projectId}/jobs`);
}

export function getJobRequest(projectId: string, jobId: string): Promise<{ job: Job }> {
  return apiRequest(`/projects/${projectId}/jobs/${jobId}`);
}

export function cancelJobRequest(projectId: string, jobId: string): Promise<{ job: Job }> {
  return apiRequest(`/projects/${projectId}/jobs/${jobId}/cancel`, { method: "POST" });
}

export function retryJobRequest(projectId: string, jobId: string): Promise<{ job: Job }> {
  return apiRequest(`/projects/${projectId}/jobs/${jobId}/retry`, { method: "POST" });
}
