import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATASET_VERSION } from "./dataset/version.js";
import { checkRegressionGates } from "./regressionGates.js";
import type { EvaluationReport, FeatureReport } from "./types.js";

/** Bump whenever scoring logic itself changes in a way that would make a
 * prior report's numbers not directly comparable to a new one (independent
 * of DATASET_VERSION, which tracks the ground truth, not the scorer). */
export const EVALUATOR_VERSION = "1.0.0";

function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: path.dirname(new URL(import.meta.url).pathname) })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

export function buildReport(
  mode: "mock" | "real",
  retrieval: FeatureReport,
  qa: FeatureReport,
  review: FeatureReport,
): EvaluationReport {
  const allCases = [...retrieval.cases, ...qa.cases, ...review.cases];
  const failed = allCases.filter((c) => !c.passed);
  const partial: Omit<EvaluationReport, "gates" | "passed"> = {
    datasetVersion: DATASET_VERSION,
    evaluatorVersion: EVALUATOR_VERSION,
    mode,
    gitCommit: gitCommit(),
    timestamp: new Date().toISOString(),
    retrieval,
    qa,
    review,
    totalCases: allCases.length,
    failedCaseCount: failed.length,
  };
  // checkRegressionGates only reads retrieval/qa/review, so a placeholder
  // gates/passed pair is safe here before the real gates are computed.
  const gates = checkRegressionGates({ ...partial, gates: [], passed: false });
  return { ...partial, gates, passed: gates.every((g) => g.passed) };
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Every aggregate metric is a 0..1 fraction except `caseCount`, a plain count. */
function featureTable(report: FeatureReport): string {
  const rows = Object.entries(report.aggregate)
    .map(([k, v]) => `| ${k} | ${k === "caseCount" ? v : fmtPct(v)} |`)
    .join("\n");
  return `| Metric | Value |\n|---|---|\n${rows}`;
}

function failedCasesSection(report: FeatureReport): string {
  const failed = report.cases.filter((c) => !c.passed);
  if (failed.length === 0) return "_No failed cases._";
  return failed
    .map(
      (c) =>
        `- **${c.caseId}** (score ${c.score.toFixed(2)})\n` +
        c.failureReasons.map((r) => `  - ${r}`).join("\n"),
    )
    .join("\n");
}

function gatesSection(report: EvaluationReport): string {
  return report.gates
    .map((g) => `- ${g.passed ? "✅" : "❌"} ${g.name} — ${g.detail}`)
    .join("\n");
}

export function renderMarkdown(report: EvaluationReport): string {
  return `# DevForge Evaluation Report

- **Status**: ${report.passed ? "PASSED" : "FAILED"} — all regression gates below decide this, not the raw case count
- **Golden-dataset cases**: ${report.totalCases - report.failedCaseCount}/${report.totalCases} matched this dataset's exact expectation (see docs/EVALUATION_PHASE_PLAN.md — a case can reasonably miss without indicating a regression; see the regression gates below for what actually gates pass/fail)
- **Mode**: ${report.mode} (${report.mode === "mock" ? "deterministic mock providers, no credentials used" : "real Anthropic/ai-service calls"})
- **Dataset version**: ${report.datasetVersion}
- **Evaluator version**: ${report.evaluatorVersion}
- **Git commit**: ${report.gitCommit}
- **Timestamp**: ${report.timestamp}

> Evaluation results are measurements against a small, hand-authored fixture dataset — they are
> not proof of complete correctness, and passing this suite does not mean DevForge detects every
> bug or security vulnerability, understands all code, or never produces an unhelpful or
> incorrect answer/finding on real-world code. See docs/EVALUATION_PHASE_PLAN.md ("What cannot
> be measured reliably").

## Regression gates

${gatesSection(report)}

## Retrieval

${featureTable(report.retrieval)}

### Failed retrieval cases

${failedCasesSection(report.retrieval)}

## Codebase Q&A

${featureTable(report.qa)}

### Failed Q&A cases

${failedCasesSection(report.qa)}

## Code Review

${featureTable(report.review)}

### Failed review cases

${failedCasesSection(report.review)}
`;
}

export function writeReports(report: EvaluationReport, outDir: string): { jsonPath: string; markdownPath: string } {
  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "latest.json");
  const markdownPath = path.join(outDir, "latest.md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(markdownPath, renderMarkdown(report));
  return { jsonPath, markdownPath };
}
