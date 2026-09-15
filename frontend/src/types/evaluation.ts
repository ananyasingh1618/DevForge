export type EvaluationRunSummary = {
  id: string;
  datasetVersion: string;
  evaluatorVersion: string;
  mode: "mock" | "real";
  gitCommit: string;
  passed: boolean;
  totalCases: number;
  failedCaseCount: number;
  retrievalMetrics: Record<string, number>;
  qaMetrics: Record<string, number>;
  reviewMetrics: Record<string, number>;
  createdAt: string;
};

export type CaseResult = {
  caseId: string;
  feature: "retrieval" | "qa" | "review";
  passed: boolean;
  score: number;
  failureReasons: string[];
};

export type GateResult = { name: string; passed: boolean; detail: string };

export type EvaluationReport = {
  retrieval: { cases: CaseResult[] };
  qa: { cases: CaseResult[] };
  review: { cases: CaseResult[] };
  gates: GateResult[];
};

export type EvaluationRunDetail = EvaluationRunSummary & { reportJson: EvaluationReport };
