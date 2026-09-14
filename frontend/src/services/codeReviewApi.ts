import { apiRequest } from "./apiClient.js";
import type { CodeReview } from "../types/codeReview.js";

export function createReviewRequest(projectId: string, scope: string): Promise<CodeReview> {
  const trimmed = scope.trim();
  return apiRequest<CodeReview>(`/projects/${projectId}/reviews`, {
    method: "POST",
    body: JSON.stringify(trimmed.length > 0 ? { scope: trimmed } : {}),
  });
}

export function listReviewsRequest(projectId: string): Promise<{ reviews: CodeReview[] }> {
  return apiRequest<{ reviews: CodeReview[] }>(`/projects/${projectId}/reviews`);
}

export function getReviewRequest(projectId: string, reviewId: string): Promise<CodeReview> {
  return apiRequest<CodeReview>(`/projects/${projectId}/reviews/${reviewId}`);
}
