#!/usr/bin/env node
/**
 * Evaluation CLI — `pnpm eval` (deterministic, default) or `pnpm eval:real`
 * (optional, requires a reachable ai-service with ANTHROPIC_API_KEY
 * configured). See docs/EVALUATION_PHASE_PLAN.md for the full design and
 * `README.md`'s "Evaluation" section for the exact commands.
 *
 * Exit code is 0 when every case passes, 1 otherwise — safe to wire into a
 * CI gate directly.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRetrieval } from "./evaluators/retrievalEvaluator.js";
import { evaluateQa } from "./evaluators/qaEvaluator.js";
import { evaluateReview } from "./evaluators/reviewEvaluator.js";
import { mockQaAnswers, mockReviewFindings } from "./mockProviders.js";
import { realQaAnswers, realReviewFindings } from "./realProviders.js";
import { buildReport, renderMarkdown, writeReports } from "./report.js";
import { persistRun } from "./persist.js";

const REPORTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "reports");

async function main() {
  const useReal = process.argv.includes("--real");
  const aiServiceUrl = process.env.AI_SERVICE_URL ?? "http://localhost:8001";

  const retrieval = evaluateRetrieval();

  const { answers: qaAnswers, fallbackCount } = useReal
    ? await realQaAnswers(aiServiceUrl)
    : { answers: mockQaAnswers(), fallbackCount: 0 };
  const reviewFindings = useReal ? await realReviewFindings(aiServiceUrl) : mockReviewFindings();

  const qa = evaluateQa(undefined, qaAnswers, undefined, fallbackCount);
  const review = evaluateReview(undefined, reviewFindings);

  const report = buildReport(useReal ? "real" : "mock", retrieval, qa, review);
  const { jsonPath, markdownPath } = writeReports(report, REPORTS_DIR);

  console.log(renderMarkdown(report));
  console.log(`\nJSON report:     ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);

  await persistRun(report);

  process.exitCode = report.passed ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error("Evaluation run failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
