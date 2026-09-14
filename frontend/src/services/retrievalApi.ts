import { apiRequest } from "./apiClient.js";
import type { SearchRequest, SearchResult } from "../types/retrieval.js";

export function searchRequest(
  projectId: string,
  input: SearchRequest,
): Promise<{ results: SearchResult[] }> {
  return apiRequest(`/projects/${projectId}/search`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
