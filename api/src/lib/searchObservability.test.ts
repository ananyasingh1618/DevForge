import { describe, expect, it, vi } from "vitest";
import { buildSearchObservabilityEvent, logSearchObservability } from "./searchObservability.js";

describe("buildSearchObservabilityEvent", () => {
  it("never includes the raw query text or any candidate content/file path", () => {
    const event = buildSearchObservabilityEvent({
      query: "a very sensitive query about SECRET_API_KEY=sk-ant-abc123",
      candidates: [{ semanticScore: 0.5, lexicalScore: 0.3, combined: 0.8 }],
      finalResultCount: 1,
      cutoffThreshold: 0.5,
      latencyMs: 12,
      indexBranch: "main",
      indexCommitSha: "abc123",
      indexCompletedAt: new Date(),
      indexFailedFileCount: 0,
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("sensitive");
    expect(serialized).not.toContain("SECRET_API_KEY");
    expect(serialized).not.toContain("sk-ant-");
    expect(event.queryLength).toBe("a very sensitive query about SECRET_API_KEY=sk-ant-abc123".length);
  });

  it("counts semantic and lexical candidates independently", () => {
    const event = buildSearchObservabilityEvent({
      query: "x",
      candidates: [
        { semanticScore: 0.5, lexicalScore: 0, combined: 0.5 },
        { semanticScore: 0, lexicalScore: 0.4, combined: 0.4 },
        { semanticScore: 0, lexicalScore: 0, combined: 0 },
      ],
      finalResultCount: 1,
      cutoffThreshold: 0.3,
      latencyMs: 5,
      indexBranch: "main",
      indexCommitSha: "abc",
      indexCompletedAt: null,
      indexFailedFileCount: 0,
    });
    expect(event.candidateCount).toBe(3);
    expect(event.semanticCandidateCount).toBe(1);
    expect(event.lexicalCandidateCount).toBe(1);
    expect(event.candidatesRemovedByCutoff).toBe(2);
  });

  it("reports -1 index age when the index has no completedAt (never completed)", () => {
    const event = buildSearchObservabilityEvent({
      query: "x",
      candidates: [],
      finalResultCount: 0,
      cutoffThreshold: 0,
      latencyMs: 1,
      indexBranch: "main",
      indexCommitSha: "abc",
      indexCompletedAt: null,
      indexFailedFileCount: 0,
    });
    expect(event.indexAgeMs).toBe(-1);
    expect(event.topCombinedScore).toBeNull();
    expect(event.meanCombinedScore).toBeNull();
  });

  it("computes a non-negative index age from a real completedAt timestamp", () => {
    const completedAt = new Date(Date.now() - 60_000);
    const event = buildSearchObservabilityEvent({
      query: "x",
      candidates: [],
      finalResultCount: 0,
      cutoffThreshold: 0,
      latencyMs: 1,
      indexBranch: "main",
      indexCommitSha: "abc",
      indexCompletedAt: completedAt,
      indexFailedFileCount: 2,
      now: new Date(),
    });
    expect(event.indexAgeMs).toBeGreaterThanOrEqual(59_000);
    expect(event.indexFailedFileCount).toBe(2);
  });
});

describe("logSearchObservability", () => {
  it("logs exactly one JSON-serializable line to console.log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logSearchObservability(
      buildSearchObservabilityEvent({
        query: "x",
        candidates: [],
        finalResultCount: 0,
        cutoffThreshold: 0,
        latencyMs: 1,
        indexBranch: "main",
        indexCommitSha: "abc",
        indexCompletedAt: null,
        indexFailedFileCount: 0,
      }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(() => JSON.parse(spy.mock.calls[0]![0] as string)).not.toThrow();
    spy.mockRestore();
  });
});
