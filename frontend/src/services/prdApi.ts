import { apiRequest } from "./apiClient.js";
import type { PrdContent, PrdDiff, PrdVersion } from "../types/prd.js";

export function generatePrdRequest(projectId: string): Promise<{ version: PrdVersion }> {
  return apiRequest(`/projects/${projectId}/prd/generate`, {
    method: "POST",
  });
}

export function listPrdVersionsRequest(projectId: string): Promise<{ versions: PrdVersion[] }> {
  return apiRequest(`/projects/${projectId}/prd`);
}

export function getPrdVersionRequest(
  projectId: string,
  versionId: string,
): Promise<{ version: PrdVersion }> {
  return apiRequest(`/projects/${projectId}/prd/${versionId}`);
}

export function updatePrdVersionRequest(
  projectId: string,
  versionId: string,
  content: PrdContent,
): Promise<{ version: PrdVersion }> {
  return apiRequest(`/projects/${projectId}/prd/${versionId}`, {
    method: "PATCH",
    body: JSON.stringify(content),
  });
}

export function activatePrdVersionRequest(
  projectId: string,
  versionId: string,
): Promise<{ version: PrdVersion }> {
  return apiRequest(`/projects/${projectId}/prd/${versionId}/activate`, {
    method: "POST",
  });
}

export function comparePrdVersionsRequest(
  projectId: string,
  a: string,
  b: string,
): Promise<{ a: PrdVersion; b: PrdVersion; diff: PrdDiff }> {
  const params = new URLSearchParams({ a, b });
  return apiRequest(`/projects/${projectId}/prd/compare?${params.toString()}`);
}
