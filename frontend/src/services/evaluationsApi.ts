import { apiRequest } from "./apiClient.js";
import type { EvaluationRunDetail, EvaluationRunSummary } from "../types/evaluation.js";

export function listEvaluationRunsRequest(): Promise<{ runs: EvaluationRunSummary[] }> {
  return apiRequest<{ runs: EvaluationRunSummary[] }>("/evaluations");
}

export function getEvaluationRunRequest(runId: string): Promise<EvaluationRunDetail> {
  return apiRequest<EvaluationRunDetail>(`/evaluations/${runId}`);
}
