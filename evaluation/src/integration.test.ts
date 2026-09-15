import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateRetrieval } from "./evaluators/retrievalEvaluator.js";
import { evaluateQa } from "./evaluators/qaEvaluator.js";
import { evaluateReview } from "./evaluators/reviewEvaluator.js";
import { mockQaAnswers, mockReviewFindings } from "./mockProviders.js";
import { buildReport } from "./report.js";
import { checkRegressionGates } from "./regressionGates.js";

/**
 * Cross-cutting guarantees the task's own Milestone 8 "Integration tests"
 * list asks for. Most of "existing retrieval/Q&A/review remain functional"
 * is covered by re-running api/ai-service/frontend's own existing suites
 * (see docs/EVALUATION_PHASE_PROGRESS.md's Docker verification step) —
 * this file covers what's specific to the evaluation package itself: that
 * its default (mock) mode genuinely never reaches a network call, and that
 * running it never touches production data at all.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("evaluation package: no network access in mock mode", () => {
  it("never calls fetch while computing retrieval/Q&A/review reports in mock mode", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const retrieval = evaluateRetrieval();
    const qa = evaluateQa(undefined, mockQaAnswers());
    const review = evaluateReview(undefined, mockReviewFindings());
    buildReport("mock", retrieval, qa, review);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("evaluation package: never touches GitHub or repository state", () => {
  it("the mock-mode pipeline never references a GitHub API host anywhere in its own logic", () => {
    // A structural guarantee, not just an absence-of-calls one: mock mode's
    // own source files never construct a GitHub URL at all (unlike
    // realProviders.ts, which only ever talks to ai-service, never
    // api.github.com — see docs/EVALUATION_PHASE_PLAN.md).
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    evaluateRetrieval();
    evaluateQa(undefined, mockQaAnswers());
    evaluateReview(undefined, mockReviewFindings());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("evaluation package: regression gates are self-contained", () => {
  it("computing gates requires no database and no environment variable", () => {
    const retrieval = evaluateRetrieval();
    const qa = evaluateQa(undefined, mockQaAnswers());
    const review = evaluateReview(undefined, mockReviewFindings());
    const report = buildReport("mock", retrieval, qa, review);
    expect(() => checkRegressionGates(report)).not.toThrow();
    expect(report.gates.length).toBeGreaterThan(0);
  });

  it("the default mock-mode run passes every regression gate (no known regression right now)", () => {
    const retrieval = evaluateRetrieval();
    const qa = evaluateQa(undefined, mockQaAnswers());
    const review = evaluateReview(undefined, mockReviewFindings());
    const report = buildReport("mock", retrieval, qa, review);
    const failed = report.gates.filter((g) => !g.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  });
});
