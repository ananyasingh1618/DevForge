import { describe, expect, it } from "vitest";
import { buildRetrievalDiagnostics, type DiagnosticCandidate } from "./retrievalDiagnostics.js";

function candidate(overrides: Partial<DiagnosticCandidate> = {}): DiagnosticCandidate {
  return {
    chunkId: "c1",
    filePath: "auth/session.ts",
    symbolName: "verifyPassword",
    startLine: 1,
    endLine: 5,
    content: "export function verifyPassword() {}",
    semanticScore: 0.5,
    ...overrides,
  };
}

describe("buildRetrievalDiagnostics", () => {
  it("ranks candidates by combined score, highest first", () => {
    const diagnostics = buildRetrievalDiagnostics("verifyPassword", [
      candidate({ chunkId: "low", semanticScore: 0.1, symbolName: "unrelated" }),
      candidate({ chunkId: "high", semanticScore: 0.9, symbolName: "verifyPassword" }),
    ]);
    expect(diagnostics[0]!.chunkId).toBe("high");
    expect(diagnostics[0]!.rank).toBe(1);
    expect(diagnostics[1]!.chunkId).toBe("low");
    expect(diagnostics[1]!.rank).toBe(2);
  });

  it("never includes the candidate's raw content in the diagnostic output", () => {
    const diagnostics = buildRetrievalDiagnostics("anything", [
      candidate({ content: "const SECRET = 'ghp_faketoken1234567890';" }),
    ]);
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("ghp_faketoken1234567890");
  });

  it("includes a full score-signal breakdown per candidate", () => {
    const [diag] = buildRetrievalDiagnostics("verifyPassword", [candidate()]);
    expect(diag!.signals).toMatchObject({
      semanticScore: 0.5,
      exactIdentifierScore: 1,
    });
    expect(typeof diag!.combinedScore).toBe("number");
  });

  it("groups overlapping same-file candidates under a shared duplicate group id", () => {
    const diagnostics = buildRetrievalDiagnostics("anything", [
      candidate({ chunkId: "a", filePath: "x.ts", startLine: 1, endLine: 10 }),
      candidate({ chunkId: "b", filePath: "x.ts", startLine: 5, endLine: 15 }),
      candidate({ chunkId: "c", filePath: "y.ts", startLine: 1, endLine: 10 }),
    ]);
    const a = diagnostics.find((d) => d.chunkId === "a")!;
    const b = diagnostics.find((d) => d.chunkId === "b")!;
    const c = diagnostics.find((d) => d.chunkId === "c")!;
    expect(a.duplicateGroup).not.toBeNull();
    expect(a.duplicateGroup).toBe(b.duplicateGroup);
    expect(c.duplicateGroup).toBeNull();
  });

  it("is fully deterministic across repeated calls", () => {
    const candidates = [candidate({ chunkId: "a" }), candidate({ chunkId: "b", semanticScore: 0.3 })];
    const first = buildRetrievalDiagnostics("verifyPassword", candidates);
    const second = buildRetrievalDiagnostics("verifyPassword", candidates);
    expect(first).toEqual(second);
  });

  it("handles an empty candidate list", () => {
    expect(buildRetrievalDiagnostics("anything", [])).toEqual([]);
  });
});
