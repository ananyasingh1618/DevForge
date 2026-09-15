import { describe, expect, it } from "vitest";
import { buildCaseDiagnostics, rankWithDiagnostics } from "./diagnostics.js";
import { RETRIEVAL_CASES } from "./dataset/retrievalCases.js";
import { FIXTURE_CHUNKS } from "./dataset/fixtureRepo.js";

describe("rankWithDiagnostics", () => {
  it("ranks every fixture chunk, not just a top-K slice", () => {
    const breakdown = rankWithDiagnostics("password comparison");
    expect(breakdown).toHaveLength(FIXTURE_CHUNKS.length);
    expect(breakdown[0]!.rank).toBe(1);
    expect(breakdown[breakdown.length - 1]!.rank).toBe(FIXTURE_CHUNKS.length);
  });

  it("never exposes chunk content — only path/symbol/scores", () => {
    const breakdown = rankWithDiagnostics("password");
    const serialized = JSON.stringify(breakdown);
    // No fixture file's actual source text (e.g. a full function body)
    // should appear — only path/symbol/rank/score fields.
    expect(serialized).not.toContain("export function");
    expect(serialized).not.toContain("return");
  });

  it("is fully deterministic across repeated calls", () => {
    const first = rankWithDiagnostics("password comparison");
    const second = rankWithDiagnostics("password comparison");
    expect(first).toEqual(second);
  });
});

describe("buildCaseDiagnostics", () => {
  it("reports the correct rank for a case whose expected chunk is returned", () => {
    const testCase = RETRIEVAL_CASES.find((c) => c.id === "retrieval-password-check")!;
    const diag = buildCaseDiagnostics(testCase, ["auth-verify-password", "auth-require-auth"]);
    expect(diag.firstRelevantRank).not.toBeNull();
    expect(diag.missingFromReturned).toEqual([]);
  });

  it("reports missing expected chunks when they weren't in the returned set", () => {
    const testCase = RETRIEVAL_CASES.find((c) => c.id === "retrieval-password-check")!;
    const diag = buildCaseDiagnostics(testCase, ["some-other-chunk"]);
    expect(diag.missingFromReturned).toEqual(["auth-verify-password"]);
  });

  it("reports a null firstRelevantRank only when truly no expected chunk exists in the fixture set", () => {
    const fakeCase = { id: "fake", query: "x", expectedChunkIds: ["does-not-exist"], acceptableAlternativeChunkIds: [], notes: "" };
    const diag = buildCaseDiagnostics(fakeCase, []);
    expect(diag.firstRelevantRank).toBeNull();
  });
});
