import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";

/**
 * Read-only access to evaluation/'s own EvaluationRun rows (see
 * docs/EVALUATION_PHASE_PLAN.md, "Reporting"). Deliberately the one
 * service in this codebase with no ownership filter: a run isn't owned by
 * a project or a user — the evaluation dataset is a fixed, version-
 * controlled fixture, not a real connected repository, so there is no
 * owner to scope by. Every authenticated user sees the same rows, the
 * same way every authenticated user could read the same public dataset
 * files in this repository.
 */

export type EvaluationRunSummary = {
  id: string;
  datasetVersion: string;
  evaluatorVersion: string;
  mode: string;
  gitCommit: string;
  passed: boolean;
  totalCases: number;
  failedCaseCount: number;
  retrievalMetrics: unknown;
  qaMetrics: unknown;
  reviewMetrics: unknown;
  createdAt: string;
};

const SUMMARY_SELECT = {
  id: true,
  datasetVersion: true,
  evaluatorVersion: true,
  mode: true,
  gitCommit: true,
  passed: true,
  totalCases: true,
  failedCaseCount: true,
  retrievalMetrics: true,
  qaMetrics: true,
  reviewMetrics: true,
  createdAt: true,
} as const;

function serializeSummary(run: {
  id: string;
  datasetVersion: string;
  evaluatorVersion: string;
  mode: string;
  gitCommit: string;
  passed: boolean;
  totalCases: number;
  failedCaseCount: number;
  retrievalMetrics: unknown;
  qaMetrics: unknown;
  reviewMetrics: unknown;
  createdAt: Date;
}): EvaluationRunSummary {
  return { ...run, createdAt: run.createdAt.toISOString() };
}

const MAX_RUNS_LISTED = 20;

export async function listEvaluationRuns(): Promise<EvaluationRunSummary[]> {
  const runs = await prisma.evaluationRun.findMany({
    select: SUMMARY_SELECT,
    orderBy: { createdAt: "desc" },
    take: MAX_RUNS_LISTED,
  });
  return runs.map(serializeSummary);
}

export async function getEvaluationRun(
  runId: string,
): Promise<EvaluationRunSummary & { reportJson: unknown }> {
  const run = await prisma.evaluationRun.findUnique({
    where: { id: runId },
    select: { ...SUMMARY_SELECT, reportJson: true },
  });
  if (!run) {
    throw AppError.notFound("Evaluation run not found");
  }
  const { reportJson, ...summary } = run;
  return { ...serializeSummary(summary), reportJson };
}
