import { describe, expect, it } from "vitest";
import { applyIntentRerank, type RerankCandidate } from "./rerank.js";

function candidate(overrides: Partial<RerankCandidate> & Pick<RerankCandidate, "chunkId">): RerankCandidate {
  return {
    symbolName: null,
    content: "",
    filePath: "src/file.ts",
    combined: 0.5,
    cutoffBasis: 0.5,
    ...overrides,
  };
}

describe("applyIntentRerank", () => {
  it(
    "never adds the intent bonus to adjustedCutoffBasis — a real regression found during the " +
      "retrieval-target-closure architecture work: a first version added the bonus to cutoffBasis " +
      "too, which inflates the cutoff threshold's own reference point whenever the bonus lands on " +
      "the already-top-ranked candidate, making the bar stricter for every OTHER candidate " +
      "(including a genuinely coherent runner-up that just didn't also match the bonus criterion) " +
      "— see docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md",
    () => {
      const candidates: RerankCandidate[] = [
        candidate({ chunkId: "index-file", symbolName: "addToCart", filePath: "cart/index.ts", combined: 0.9, cutoffBasis: 0.9 }),
        candidate({ chunkId: "other", combined: 0.4, cutoffBasis: 0.4 }),
      ];
      const reranked = applyIntentRerank("What is the public entry point for adding to the cart?", candidates);
      const indexFile = reranked.find((r) => r.chunkId === "index-file")!;
      // The entry-point bonus must show up in adjustedScore...
      expect(indexFile.adjustedScore).toBeGreaterThan(indexFile.combined);
      // ...but never in adjustedCutoffBasis, which must equal the raw,
      // unadjusted cutoffBasis exactly.
      expect(indexFile.adjustedCutoffBasis).toBe(indexFile.cutoffBasis);
    },
  );

  it("boosts a file named index.ts for an entry-point-intent query", () => {
    const candidates: RerankCandidate[] = [
      candidate({ chunkId: "wrapper", filePath: "cart/index.ts", combined: 0.5, cutoffBasis: 0.5 }),
      candidate({ chunkId: "impl", filePath: "cart/cartService.ts", combined: 0.5, cutoffBasis: 0.5 }),
    ];
    const reranked = applyIntentRerank("What is the public entry point for the cart module?", candidates);
    const wrapper = reranked.find((r) => r.chunkId === "wrapper")!;
    const impl = reranked.find((r) => r.chunkId === "impl")!;
    expect(wrapper.adjustedScore).toBeGreaterThan(impl.adjustedScore);
  });

  it("boosts the callee of the top-scored candidate for a dependency-intent query", () => {
    const candidates: RerankCandidate[] = [
      candidate({
        chunkId: "caller",
        symbolName: "processOrder",
        content: "function processOrder() { findOrdersByUserId(); }",
        combined: 0.9,
        cutoffBasis: 0.9,
      }),
      candidate({ chunkId: "callee", symbolName: "findOrdersByUserId", combined: 0.4, cutoffBasis: 0.4 }),
      candidate({ chunkId: "unrelated", symbolName: "formatPrice", combined: 0.4, cutoffBasis: 0.4 }),
    ];
    const reranked = applyIntentRerank("Which function does orderProcessor import to load orders?", candidates);
    const callee = reranked.find((r) => r.chunkId === "callee")!;
    const unrelated = reranked.find((r) => r.chunkId === "unrelated")!;
    expect(callee.adjustedScore).toBeGreaterThan(unrelated.adjustedScore);
  });

  it("boosts the caller of the top-scored candidate for a usage-intent query", () => {
    const candidates: RerankCandidate[] = [
      candidate({ chunkId: "target", symbolName: "validateOrderItems", combined: 0.9, cutoffBasis: 0.9 }),
      candidate({
        chunkId: "caller",
        symbolName: "processOrder",
        content: "function processOrder() { validateOrderItems(); }",
        combined: 0.4,
        cutoffBasis: 0.4,
      }),
      candidate({ chunkId: "unrelated", symbolName: "formatPrice", combined: 0.4, cutoffBasis: 0.4 }),
    ];
    const reranked = applyIntentRerank("Where is validateOrderItems used?", candidates);
    const caller = reranked.find((r) => r.chunkId === "caller")!;
    const unrelated = reranked.find((r) => r.chunkId === "unrelated")!;
    expect(caller.adjustedScore).toBeGreaterThan(unrelated.adjustedScore);
  });

  it("boosts a candidate referenced by an orchestrator (2+ outgoing edges) for an orchestration-intent query", () => {
    const candidates: RerankCandidate[] = [
      candidate({
        chunkId: "orchestrator",
        symbolName: "processOrder",
        content: "function processOrder() { validateOrderItems(); calculateOrderTotal(); }",
        combined: 0.9,
        cutoffBasis: 0.9,
      }),
      // Both steps must themselves be candidates in the pool — the
      // orchestrator only counts as having ">=2 outgoing edges" when it
      // references 2 other actual candidates, not merely 2 identifiers
      // in its own text.
      candidate({ chunkId: "step", symbolName: "validateOrderItems", combined: 0.3, cutoffBasis: 0.3 }),
      candidate({ chunkId: "other-step", symbolName: "calculateOrderTotal", combined: 0.3, cutoffBasis: 0.3 }),
      candidate({ chunkId: "unrelated", symbolName: "formatPrice", combined: 0.3, cutoffBasis: 0.3 }),
    ];
    const reranked = applyIntentRerank("Walk me through everything that happens when an order is processed.", candidates);
    const step = reranked.find((r) => r.chunkId === "step")!;
    const unrelated = reranked.find((r) => r.chunkId === "unrelated")!;
    expect(step.adjustedScore).toBeGreaterThan(unrelated.adjustedScore);
  });

  it("applies no bonus at all for a general-intent query", () => {
    const candidates: RerankCandidate[] = [
      candidate({ chunkId: "a", filePath: "cart/index.ts", combined: 0.5, cutoffBasis: 0.5 }),
      candidate({ chunkId: "b", combined: 0.4, cutoffBasis: 0.4 }),
    ];
    const reranked = applyIntentRerank("How does DevForge calculate the order total?", candidates);
    for (const r of reranked) {
      expect(r.adjustedScore).toBe(r.combined);
    }
  });

  it("returns an empty array for an empty candidate pool", () => {
    expect(applyIntentRerank("anything", [])).toEqual([]);
  });

  it("is fully deterministic across repeated calls", () => {
    const candidates: RerankCandidate[] = [candidate({ chunkId: "a", combined: 0.5, cutoffBasis: 0.5 })];
    const a = applyIntentRerank("some query", candidates);
    const b = applyIntentRerank("some query", candidates);
    expect(a).toEqual(b);
  });
});
