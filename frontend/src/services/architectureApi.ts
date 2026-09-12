import { apiRequest } from "./apiClient.js";
import type { ArchitectureContent, ArchitectureDiff, ArchitectureVersion } from "../types/architecture.js";

export function generateArchitectureRequest(
  projectId: string,
): Promise<{ version: ArchitectureVersion }> {
  return apiRequest(`/projects/${projectId}/architecture/generate`, {
    method: "POST",
  });
}

export function listArchitectureVersionsRequest(
  projectId: string,
): Promise<{ versions: ArchitectureVersion[] }> {
  return apiRequest(`/projects/${projectId}/architecture`);
}

export function getArchitectureVersionRequest(
  projectId: string,
  versionId: string,
): Promise<{ version: ArchitectureVersion }> {
  return apiRequest(`/projects/${projectId}/architecture/${versionId}`);
}

export function updateArchitectureVersionRequest(
  projectId: string,
  versionId: string,
  content: ArchitectureContent,
): Promise<{ version: ArchitectureVersion }> {
  return apiRequest(`/projects/${projectId}/architecture/${versionId}`, {
    method: "PATCH",
    body: JSON.stringify(content),
  });
}

export function activateArchitectureVersionRequest(
  projectId: string,
  versionId: string,
): Promise<{ version: ArchitectureVersion }> {
  return apiRequest(`/projects/${projectId}/architecture/${versionId}/activate`, {
    method: "POST",
  });
}

export function compareArchitectureVersionsRequest(
  projectId: string,
  a: string,
  b: string,
): Promise<{ a: ArchitectureVersion; b: ArchitectureVersion; diff: ArchitectureDiff }> {
  const params = new URLSearchParams({ a, b });
  return apiRequest(`/projects/${projectId}/architecture/compare?${params.toString()}`);
}
