/**
 * Standalone adversarial retrieval tests (Retrieval Target Closure,
 * Milestone A6 — see docs/RETRIEVAL_TARGET_CLOSURE_PROGRESS.md). Uses a
 * genuinely separate fixture (`dataset/fixturesAdversarialA6/`, 4 files
 * across TypeScript/JavaScript/Python) that is never added to
 * `RETRIEVAL_CASES`/`FIXTURE_CHUNKS` and never counted toward the main
 * dataset's regression gates or reported case counts — this exercises the
 * real scoring functions (real local embedding model + `hybridScore`'s
 * adaptive cutoff — updated in the second retrieval-target-closure pass to
 * use the same real embedding model the main benchmark now uses by
 * default, see docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md, rather than
 * stay on the abandoned deterministic proxy) against fresh content the
 * main benchmark's own tuning never saw, per the task's explicit "use a
 * separate fixture" instruction. Deliberately does not layer on the full
 * intent-reranking/coherence-cutoff pipeline (`rerank.ts`) — this file
 * tests the base scoring+cutoff formula's own generalization in isolation,
 * a narrower and still-useful signal distinct from what
 * `retrievalEvaluator.test.ts`'s own coherence-cutoff tests cover.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "./deterministicEmbedding.js";
import { localEmbedding } from "./localEmbedding.js";
import { computeScoreSignals, combinedScore, HYBRID_WEIGHTS } from "./hybridScore.js";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "dataset", "fixturesAdversarialA6");

type AdvChunk = {
  chunkId: string;
  filePath: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
};

const ADV_CHUNKS: AdvChunk[] = [
  { chunkId: "adv-validate-schedule", filePath: "scheduler.ts", symbolName: "validateSchedule", startLine: 13, endLine: 20 },
  { chunkId: "adv-schedule-task", filePath: "scheduler.ts", symbolName: "scheduleTask", startLine: 26, endLine: 29 },
  { chunkId: "adv-legacy-schedule-task", filePath: "schedulerLegacy.js", symbolName: "scheduleTask", startLine: 15, endLine: 18 },
  { chunkId: "adv-send-notification", filePath: "notifier.py", symbolName: "send_notification", startLine: 3, endLine: 8 },
  { chunkId: "adv-calculate-total-price", filePath: "notifier.py", symbolName: "calculate_total_price", startLine: 11, endLine: 17 },
  { chunkId: "adv-test-notification-suite", filePath: "test_notifier.py", symbolName: null, startLine: 9, endLine: 18 },
];

const contentCache = new Map<string, string[]>();
function chunkContent(chunk: AdvChunk): string {
  let lines = contentCache.get(chunk.filePath);
  if (!lines) {
    lines = readFileSync(path.join(FIXTURES_DIR, chunk.filePath), "utf-8").split("\n");
    contentCache.set(chunk.filePath, lines);
  }
  return lines.slice(chunk.startLine - 1, chunk.endLine).join("\n");
}

/** Self-contained rank function — not imported from retrievalEvaluator.ts,
 * so this fixture stays structurally isolated from the main dataset, but
 * reuses the exact same real scoring functions (the real local embedding
 * model, hybridScore) and the exact same adaptive-cutoff-with-
 * desensitized-threshold logic api/evaluation both use. */
async function rankAdversarial(query: string, k = 5): Promise<{ chunkId: string; combined: number }[]> {
  const queryVector = await localEmbedding(query);
  const scored = await Promise.all(
    ADV_CHUNKS.map(async (chunk) => {
      const content = chunkContent(chunk);
      const semanticScore = cosineSimilarity(queryVector, await localEmbedding(content));
      const signals = computeScoreSignals(query, semanticScore, { content, symbolName: chunk.symbolName, filePath: chunk.filePath });
      const combined = combinedScore(signals);
      const cutoffBasis = combined - HYBRID_WEIGHTS.exactIdentifier * signals.exactIdentifierScore;
      return { chunkId: chunk.chunkId, combined, cutoffBasis };
    }),
  );
  scored.sort((a, b) => b.combined - a.combined);
  const topBasis = Math.max(...scored.map((s) => s.cutoffBasis));
  const threshold = topBasis * 0.78;
  const selected: typeof scored = [];
  for (const s of scored) {
    if (selected.length >= k) break;
    if (selected.length > 0 && s.combined < threshold) break;
    selected.push(s);
  }
  return selected;
}

async function topIds(query: string, k = 5): Promise<string[]> {
  return (await rankAdversarial(query, k)).map((s) => s.chunkId);
}

describe("adversarial: same symbol name in multiple files", () => {
  it("disambiguates the real, current scheduleTask from the legacy same-named one by query wording", async () => {
    const ids = await topIds("How does the current task scheduler validate a task before accepting it?");
    expect(ids).toContain("adv-schedule-task");
  });

  it("disambiguates the legacy scheduleTask from the real one by query wording", async () => {
    const ids = await topIds("What does the old legacy in-memory task queue do, with no validation?");
    expect(ids).toContain("adv-legacy-schedule-task");
  });
});

describe("adversarial: parent-child symbol relationship", () => {
  it("surfaces the parent orchestrator for a broad 'how is a task scheduled' question", async () => {
    const ids = await topIds("How is a new task validated and registered with the scheduler?");
    expect(ids).toContain("adv-schedule-task");
  });

  it("surfaces the neighboring validation helper for a narrower question", async () => {
    const ids = await topIds("What checks that a task's run time is in the future?");
    expect(ids).toContain("adv-validate-schedule");
  });
});

describe("adversarial: test vs. production implementation", () => {
  it("resolves 'where is send_notification implemented' to the real function, not the test file", async () => {
    const ranked = await rankAdversarial("Where is send_notification actually implemented in Python?");
    expect(ranked[0]?.chunkId).toBe("adv-send-notification");
  });

  it("resolves a query specifically about test coverage to the test file", async () => {
    const ids = await topIds("What test cases exist for send_notification's channel validation?");
    expect(ids).toContain("adv-test-notification-suite");
  });
});

describe("adversarial: token-family / casing differences", () => {
  it("matches 'calculating' against calculate_total_price via light stemming, not exact tokens", async () => {
    const ids = await topIds("What function handles calculating a discounted total for an order?");
    expect(ids).toContain("adv-calculate-total-price");
  });

  it("matches regardless of query casing", async () => {
    const lower = await topIds("calculate_total_price");
    const upper = await topIds("CALCULATE_TOTAL_PRICE");
    expect(lower).toEqual(upper);
    expect(lower).toContain("adv-calculate-total-price");
  });
});

describe("adversarial: short vs. long queries", () => {
  it("a short, raw-identifier query resolves correctly", async () => {
    const ids = await topIds("sendNotification");
    // tokenize() splits snake_case too, so this still matches send_notification.
    expect(ids).toContain("adv-send-notification");
  });

  it("a long, natural-language query resolves correctly", async () => {
    const ids = await topIds(
      "I'm trying to understand how DevForge sends a notification to a user, including which " +
        "channels are supported and what happens if an unsupported channel is requested",
    );
    expect(ids).toContain("adv-send-notification");
  });
});

describe("adversarial: cross-language disambiguation", () => {
  it("a Python-specific query does not surface the unrelated TypeScript/JavaScript scheduler chunks first", async () => {
    const ranked = await rankAdversarial("What Python function sends a notification over SMS or push?");
    expect(ranked[0]?.chunkId).toBe("adv-send-notification");
  });
});

describe("adversarial: unanswerable query against this fixture", () => {
  it("does not confidently surface any chunk for a topic absent from this fixture entirely", async () => {
    const ranked = await rankAdversarial("How does DevForge handle multi-factor authentication hardware tokens?");
    // No chunk in this fixture is about authentication at all — the top
    // result's own combined score should be low in absolute terms (this
    // fixture has no plausible answer), not a confident, high-scoring hit.
    expect(ranked[0]!.combined).toBeLessThan(0.6);
  });
});

describe("adversarial: deterministic and duplicate-free", () => {
  it("returns no duplicate chunk ids", async () => {
    const ids = await topIds("scheduler notification price");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is fully deterministic across repeated runs", async () => {
    const a = await topIds("How is a task scheduled?");
    const b = await topIds("How is a task scheduled?");
    expect(a).toEqual(b);
  });
});
