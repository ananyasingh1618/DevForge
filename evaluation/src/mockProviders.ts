/**
 * The deterministic, credential-free stand-ins for the real Q&A and code
 * review providers (Phase 9/10's Anthropic-backed agents) — see
 * docs/EVALUATION_PHASE_PLAN.md ("Deterministic mock-provider strategy").
 * Each dataset case already carries its own canonical mock output
 * (`mockAnswer`/`mockFindings`); this module just assembles them into the
 * `Map` shape the evaluators expect, so `runEval.ts`'s default (mock) mode
 * and its `--real` mode share the exact same evaluator code path — only
 * the answer/finding source differs.
 */

import { QA_CASES, type QaCase } from "./dataset/qaCases.js";
import { REVIEW_CASES, type ReviewCase } from "./dataset/reviewCases.js";
import type { QaAnswer } from "./evaluators/qaEvaluator.js";
import type { MockFinding } from "./dataset/reviewCases.js";

export function mockQaAnswers(cases: QaCase[] = QA_CASES): Map<string, QaAnswer> {
  return new Map(cases.map((c) => [c.id, c.mockAnswer]));
}

export function mockReviewFindings(cases: ReviewCase[] = REVIEW_CASES): Map<string, MockFinding[]> {
  return new Map(cases.map((c) => [c.id, c.mockFindings]));
}
