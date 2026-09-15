/**
 * Best-effort persistence of an evaluation run's summary to the shared
 * `evaluation_runs` table (see api/prisma/schema.prisma, migration
 * 20260914201014_add_evaluation_runs) — read by the optional `GET
 * /evaluations` API and frontend page (docs/EVALUATION_PHASE_PLAN.md,
 * "Reporting"). Uses raw `pg`, the same cross-package pattern tests/
 * already uses against this same Prisma-owned schema, rather than
 * depending on api's generated Prisma client from a sibling workspace
 * package.
 *
 * Deliberately never required: if DATABASE_URL is unset or the database is
 * unreachable, this logs a note and returns — the authoritative,
 * required artifacts are the JSON/Markdown files src/report.ts already
 * wrote to disk before this runs.
 */

import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { EvaluationReport } from "./types.js";

export async function persistRun(report: EvaluationReport): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("\nDATABASE_URL not set — skipping evaluation_runs persistence (JSON/Markdown reports are still authoritative).");
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query(
      `INSERT INTO evaluation_runs
         (id, dataset_version, evaluator_version, mode, git_commit, passed, total_cases,
          failed_case_count, retrieval_metrics, qa_metrics, review_metrics, report_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        randomUUID(),
        report.datasetVersion,
        report.evaluatorVersion,
        report.mode,
        report.gitCommit,
        report.passed,
        report.totalCases,
        report.failedCaseCount,
        JSON.stringify(report.retrieval.aggregate),
        JSON.stringify(report.qa.aggregate),
        JSON.stringify(report.review.aggregate),
        JSON.stringify(report),
      ],
    );
    console.log("\nPersisted run summary to evaluation_runs.");
  } catch (err) {
    console.log(
      `\nCould not persist to evaluation_runs (non-fatal — JSON/Markdown reports are still authoritative): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}
