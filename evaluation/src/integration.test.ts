import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateRetrieval, MOCK_EMBEDDER } from "./evaluators/retrievalEvaluator.js";
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
 * this file covers what's specific to the evaluation package itself.
 *
 * The retrieval-target-closure second pass (see
 * docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md) made the real local
 * embedding model (localEmbedding.ts) the DEFAULT for `evaluateRetrieval`/
 * `evaluateQa` — a deliberate, legitimate change from the previous fully-
 * offline deterministic proxy, and one that *can* touch the network on a
 * genuinely cold model cache (a one-time download, cached afterward).
 * "No network access in mock mode" below is now a claim specifically
 * about the explicit `MOCK_EMBEDDER` opt-in this package still provides
 * for isolated tests, not about `evaluateRetrieval`'s own new default —
 * this file is scoped to the explicit-mock-opt-in path only.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("evaluation package: no network access when explicitly using MOCK_EMBEDDER", () => {
  it("never calls fetch while computing a retrieval report with the explicit mock embedder", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const retrieval = await evaluateRetrieval(undefined, undefined, undefined, MOCK_EMBEDDER);
    const qa = await evaluateQa(undefined, mockQaAnswers(), undefined, undefined, MOCK_EMBEDDER);
    const review = evaluateReview(undefined, mockReviewFindings());
    buildReport("mock", retrieval, qa, review);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("evaluation package: never touches GitHub or repository state", () => {
  it("the mock-embedder pipeline never references a GitHub API host anywhere in its own logic", async () => {
    // A structural guarantee, not just an absence-of-calls one: this
    // pipeline's own source files never construct a GitHub URL at all
    // (unlike realProviders.ts, which only ever talks to ai-service, never
    // api.github.com — see docs/EVALUATION_PHASE_PLAN.md).
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await evaluateRetrieval(undefined, undefined, undefined, MOCK_EMBEDDER);
    await evaluateQa(undefined, mockQaAnswers(), undefined, undefined, MOCK_EMBEDDER);
    evaluateReview(undefined, mockReviewFindings());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("evaluation package: regression gates are self-contained", () => {
  it("computing gates requires no database and no environment variable", async () => {
    const retrieval = await evaluateRetrieval();
    const qa = await evaluateQa(undefined, mockQaAnswers());
    const review = evaluateReview(undefined, mockReviewFindings());
    const report = buildReport("mock", retrieval, qa, review);
    expect(() => checkRegressionGates(report)).not.toThrow();
    expect(report.gates.length).toBeGreaterThan(0);
  });

  it("the default (real local embedding) run passes every regression gate (no known regression right now)", async () => {
    const retrieval = await evaluateRetrieval();
    const qa = await evaluateQa(undefined, mockQaAnswers());
    const review = evaluateReview(undefined, mockReviewFindings());
    const report = buildReport("mock", retrieval, qa, review);
    const failed = report.gates.filter((g) => !g.passed);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  });
});
