import { apiRequest } from "./apiClient.js";
import type { RequirementsContent, RequirementsDiff, RequirementsVersion } from "../types/requirements.js";

export function analyzeRequirementsRequest(
  projectId: string,
  idea: string,
): Promise<{ version: RequirementsVersion }> {
  return apiRequest(`/projects/${projectId}/requirements/analyze`, {
    method: "POST",
    body: JSON.stringify({ idea }),
  });
}

export function listRequirementsVersionsRequest(
  projectId: string,
): Promise<{ versions: RequirementsVersion[] }> {
  return apiRequest(`/projects/${projectId}/requirements`);
}

export function getRequirementsVersionRequest(
  projectId: string,
  versionId: string,
): Promise<{ version: RequirementsVersion }> {
  return apiRequest(`/projects/${projectId}/requirements/${versionId}`);
}

export function updateRequirementsVersionRequest(
  projectId: string,
  versionId: string,
  content: RequirementsContent,
): Promise<{ version: RequirementsVersion }> {
  return apiRequest(`/projects/${projectId}/requirements/${versionId}`, {
    method: "PATCH",
    body: JSON.stringify(content),
  });
}

export function activateRequirementsVersionRequest(
  projectId: string,
  versionId: string,
): Promise<{ version: RequirementsVersion }> {
  return apiRequest(`/projects/${projectId}/requirements/${versionId}/activate`, {
    method: "POST",
  });
}

export function compareRequirementsVersionsRequest(
  projectId: string,
  a: string,
  b: string,
): Promise<{ a: RequirementsVersion; b: RequirementsVersion; diff: RequirementsDiff }> {
  const params = new URLSearchParams({ a, b });
  return apiRequest(`/projects/${projectId}/requirements/compare?${params.toString()}`);
}
