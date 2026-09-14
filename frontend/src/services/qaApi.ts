import { apiRequest } from "./apiClient.js";
import type { QaResult } from "../types/qa.js";

export function askQuestionRequest(projectId: string, question: string): Promise<QaResult> {
  return apiRequest<QaResult>(`/projects/${projectId}/qa`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

export function listQuestionsRequest(projectId: string): Promise<{ questions: QaResult[] }> {
  return apiRequest<{ questions: QaResult[] }>(`/projects/${projectId}/qa`);
}

export function getQuestionRequest(projectId: string, questionId: string): Promise<QaResult> {
  return apiRequest<QaResult>(`/projects/${projectId}/qa/${questionId}`);
}
