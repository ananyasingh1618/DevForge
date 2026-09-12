import { apiRequest } from "./apiClient.js";
import type { TaskContent, TaskDiff, TaskVersion } from "../types/tasks.js";

export function generateTasksRequest(projectId: string): Promise<{ version: TaskVersion }> {
  return apiRequest(`/projects/${projectId}/tasks/generate`, {
    method: "POST",
  });
}

export function listTaskVersionsRequest(projectId: string): Promise<{ versions: TaskVersion[] }> {
  return apiRequest(`/projects/${projectId}/tasks`);
}

export function getTaskVersionRequest(
  projectId: string,
  versionId: string,
): Promise<{ version: TaskVersion }> {
  return apiRequest(`/projects/${projectId}/tasks/${versionId}`);
}

export function updateTaskVersionRequest(
  projectId: string,
  versionId: string,
  content: TaskContent,
): Promise<{ version: TaskVersion }> {
  return apiRequest(`/projects/${projectId}/tasks/${versionId}`, {
    method: "PATCH",
    body: JSON.stringify(content),
  });
}

export function activateTaskVersionRequest(
  projectId: string,
  versionId: string,
): Promise<{ version: TaskVersion }> {
  return apiRequest(`/projects/${projectId}/tasks/${versionId}/activate`, {
    method: "POST",
  });
}

export function compareTaskVersionsRequest(
  projectId: string,
  a: string,
  b: string,
): Promise<{ a: TaskVersion; b: TaskVersion; diff: TaskDiff }> {
  const params = new URLSearchParams({ a, b });
  return apiRequest(`/projects/${projectId}/tasks/compare?${params.toString()}`);
}
