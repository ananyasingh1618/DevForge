/** Shared result shapes every evaluator (retrieval/QA/review) produces, so
 * src/report.ts can render all three uniformly. */

export type CaseResult = {
  caseId: string;
  feature: "retrieval" | "qa" | "review";
  passed: boolean;
  score: number;
  expected: unknown;
  actual: unknown;
  relevantSources: string[];
  failureReasons: string[];
};

export type AggregateMetrics = Record<string, number>;

export type FeatureReport = {
  feature: "retrieval" | "qa" | "review";
  aggregate: AggregateMetrics;
  cases: CaseResult[];
};

export type GateResult = { name: string; passed: boolean; detail: string };

export type EvaluationReport = {
  datasetVersion: string;
  evaluatorVersion: string;
  mode: "mock" | "real";
  gitCommit: string;
  timestamp: string;
  retrieval: FeatureReport;
  qa: FeatureReport;
  review: FeatureReport;
  /** Regression-gate results (see regressionGates.ts) — THESE decide `passed`,
   * not whether every golden-dataset case individually passed. */
  gates: GateResult[];
  /** True only when every regression gate passed — the CLI's exit code and
   * any CI usage should key off this, not off failedCaseCount. */
  passed: boolean;
  totalCases: number;
  failedCaseCount: number;
};
