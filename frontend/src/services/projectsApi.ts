import { apiRequest } from "./apiClient.js";
import type { Project } from "../types/project.js";

export function listProjectsRequest(): Promise<{ projects: Project[] }> {
  return apiRequest("/projects");
}

export function createProjectRequest(input: {
  name: string;
  description?: string;
}): Promise<{ project: Project }> {
  return apiRequest("/projects", { method: "POST", body: JSON.stringify(input) });
}

export function getProjectRequest(id: string): Promise<{ project: Project }> {
  return apiRequest(`/projects/${id}`);
}
