/**
 * Optional real-provider evaluation (see docs/EVALUATION_PHASE_PLAN.md,
 * "Real-provider evaluation strategy"). Calls ai-service's actual
 * `/qa/answer` and `/review/analyze` endpoints directly over HTTP, using
 * this package's own deterministic retrieval ranking (src/evaluators/
 * retrievalEvaluator.ts's rankChunks()) to build each request's numbered
 * source list — exactly the shape Node's real services build, but without
 * needing a real GitHub-connected repository or a running Postgres/Node API
 * at all, since ai-service's Q&A/review endpoints accept source excerpts
 * directly. Only gated by ANTHROPIC_API_KEY actually being configured in
 * the ai-service process this calls; never required for the default
 * (mock) evaluation run, CI, or Docker verification to pass.
 */

import { rankChunks, TOP_K } from "./evaluators/retrievalEvaluator.js";
import { BRANCH_LABEL, chunkContent, COMMIT_LABEL, REPOSITORY_LABEL } from "./dataset/fixtureRepo.js";
import { QA_CASES, type QaCase } from "./dataset/qaCases.js";
import { REVIEW_CASES, type ReviewCase, type MockFinding } from "./dataset/reviewCases.js";
import { groundAnswer } from "./qaAnswerGrounding.js";
import type { QaAnswer } from "./evaluators/qaEvaluator.js";

function buildSources(ranked: ReturnType<typeof rankChunks>) {
  return ranked.map((r, i) => ({
    source_number: i + 1,
    path: r.chunk.filePath,
    symbol_name: r.chunk.symbolName,
    start_line: r.chunk.startLine,
    end_line: r.chunk.endLine,
    content: chunkContent(r.chunk),
  }));
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const parsed = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

export type RealQaResult = { answers: Map<string, QaAnswer>; fallbackCount: number };

/** Applies the identical grounding safety net production's
 * services/qa.ts applies (see qaAnswerGrounding.ts) before scoring a real
 * answer — so real-mode evaluation measures what a user would actually
 * see, not raw, ungrounded provider output, and so a fallback's
 * occurrence is counted (Milestone 6's own reporting requirement). */
export async function realQaAnswers(aiServiceUrl: string, cases: QaCase[] = QA_CASES): Promise<RealQaResult> {
  const answers = new Map<string, QaAnswer>();
  let fallbackCount = 0;
  for (const c of cases) {
    const ranked = rankChunks(c.question, undefined, TOP_K);
    const sources = buildSources(ranked);
    const { status, body } = await postJson(`${aiServiceUrl}/qa/answer`, {
      question: c.question,
      repository: REPOSITORY_LABEL,
      branch: BRANCH_LABEL,
      commit: COMMIT_LABEL,
      sources,
    });
    if (status !== 200) {
      throw new Error(`ai-service /qa/answer returned ${status} for case "${c.id}": ${JSON.stringify(body)}`);
    }
    const content = (body as { content: { answer: string; cited_source_numbers: number[]; insufficient_evidence: boolean } }).content;
    const grounded = groundAnswer(
      { answer: content.answer, citedSourceNumbers: content.cited_source_numbers, insufficientEvidence: content.insufficient_evidence },
      ranked.length,
    );
    if (grounded.overridden) fallbackCount++;
    const citedChunkIds = [...grounded.citedOrders].map((n) => ranked[n - 1]!.chunk.chunkId);
    answers.set(c.id, { answer: grounded.answer, citedChunkIds, insufficientEvidence: grounded.insufficientEvidence });
  }
  return { answers, fallbackCount };
}

export async function realReviewFindings(
  aiServiceUrl: string,
  cases: ReviewCase[] = REVIEW_CASES,
): Promise<Map<string, MockFinding[]>> {
  const result = new Map<string, MockFinding[]>();
  for (const c of cases) {
    const ranked = rankChunks(c.scope, undefined, TOP_K);
    const sources = buildSources(ranked);
    const { status, body } = await postJson(`${aiServiceUrl}/review/analyze`, {
      scope: c.scope,
      repository: REPOSITORY_LABEL,
      branch: BRANCH_LABEL,
      commit: COMMIT_LABEL,
      sources,
    });
    if (status !== 200) {
      throw new Error(`ai-service /review/analyze returned ${status} for case "${c.id}": ${JSON.stringify(body)}`);
    }
    const content = (
      body as {
        content: {
          findings: Array<{
            title: string;
            description: string;
            severity: MockFinding["severity"];
            category: string;
            confidence: MockFinding["confidence"];
            recommendation: string;
            cited_source_numbers: number[];
          }>;
        };
      }
    ).content;
    const findings: MockFinding[] = content.findings.map((f) => ({
      title: f.title,
      description: f.description,
      severity: f.severity,
      category: f.category,
      confidence: f.confidence,
      recommendation: f.recommendation,
      citedChunkIds: f.cited_source_numbers.map((n) => ranked[n - 1]?.chunk.chunkId).filter((id): id is string => Boolean(id)),
    }));
    result.set(c.id, findings);
  }
  return result;
}
