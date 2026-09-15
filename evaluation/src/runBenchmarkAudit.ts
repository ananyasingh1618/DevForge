#!/usr/bin/env node
/**
 * Standalone benchmark-audit CLI — `pnpm audit:benchmark` (Phase 13,
 * Milestone 13.4). Runs the structural dataset checks in
 * src/dataset/benchmarkAudit.ts and writes a human-readable report to
 * evaluation/reports/benchmark-audit.md. Deterministic, no credentials, no
 * network. Exit code 0 when the audit finds zero errors, 1 otherwise — safe
 * to wire into CI as its own gate, independent of the full `pnpm eval` run.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmarkAudit, renderAuditMarkdown } from "./dataset/benchmarkAudit.js";

const REPORTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "reports");

function main() {
  const report = runBenchmarkAudit();
  const markdown = renderAuditMarkdown(report);
  console.log(markdown);

  mkdirSync(REPORTS_DIR, { recursive: true });
  const outPath = path.join(REPORTS_DIR, "benchmark-audit.md");
  writeFileSync(outPath, markdown);
  console.log(`\nReport written to: ${outPath}`);

  process.exitCode = report.passed ? 0 : 1;
}

main();
