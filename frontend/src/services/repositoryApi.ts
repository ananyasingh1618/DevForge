import { apiRequest } from "./apiClient.js";
import type { ConnectRepositoryInput, GithubBranch, RepositoryConnection } from "../types/repository.js";

export function connectRepositoryRequest(
  projectId: string,
  input: ConnectRepositoryInput,
): Promise<{ connection: RepositoryConnection }> {
  return apiRequest(`/projects/${projectId}/repository/connect`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getRepositoryConnectionRequest(
  projectId: string,
): Promise<{ connection: RepositoryConnection | null }> {
  return apiRequest(`/projects/${projectId}/repository`);
}

export function verifyRepositoryAccessRequest(
  projectId: string,
): Promise<{ connection: RepositoryConnection }> {
  return apiRequest(`/projects/${projectId}/repository/verify`, {
    method: "POST",
  });
}

export function listRepositoryBranchesRequest(
  projectId: string,
): Promise<{ branches: GithubBranch[] }> {
  return apiRequest(`/projects/${projectId}/repository/branches`);
}

export function updateRepositoryBranchRequest(
  projectId: string,
  branch: string,
): Promise<{ connection: RepositoryConnection }> {
  return apiRequest(`/projects/${projectId}/repository`, {
    method: "PATCH",
    body: JSON.stringify({ branch }),
  });
}

export function disconnectRepositoryRequest(projectId: string): Promise<void> {
  return apiRequest(`/projects/${projectId}/repository`, {
    method: "DELETE",
  });
}
