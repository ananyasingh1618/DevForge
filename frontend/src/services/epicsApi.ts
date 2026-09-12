import { apiRequest } from "./apiClient.js";
import type { EpicContent, EpicDiff, EpicVersion } from "../types/epics.js";

export function generateEpicsRequest(projectId: string): Promise<{ version: EpicVersion }> {
  return apiRequest(`/projects/${projectId}/epics/generate`, {
    method: "POST",
  });
}

export function listEpicVersionsRequest(projectId: string): Promise<{ versions: EpicVersion[] }> {
  return apiRequest(`/projects/${projectId}/epics`);
}

export function getEpicVersionRequest(
  projectId: string,
  versionId: string,
): Promise<{ version: EpicVersion }> {
  return apiRequest(`/projects/${projectId}/epics/${versionId}`);
}

export function updateEpicVersionRequest(
  projectId: string,
  versionId: string,
  content: EpicContent,
): Promise<{ version: EpicVersion }> {
  return apiRequest(`/projects/${projectId}/epics/${versionId}`, {
    method: "PATCH",
    body: JSON.stringify(content),
  });
}

export function activateEpicVersionRequest(
  projectId: string,
  versionId: string,
): Promise<{ version: EpicVersion }> {
  return apiRequest(`/projects/${projectId}/epics/${versionId}/activate`, {
    method: "POST",
  });
}

export function compareEpicVersionsRequest(
  projectId: string,
  a: string,
  b: string,
): Promise<{ a: EpicVersion; b: EpicVersion; diff: EpicDiff }> {
  const params = new URLSearchParams({ a, b });
  return apiRequest(`/projects/${projectId}/epics/compare?${params.toString()}`);
}
