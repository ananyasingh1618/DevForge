import { describe, expect, it } from "vitest";
import {
  combinedScore,
  computeScoreSignals,
  exactIdentifierBoost,
  filePathMatchScore,
  identifierMatchScore,
  lexicalOverlapScore,
  tokenize,
} from "./hybridScore.js";

describe("tokenize", () => {
  it("splits camelCase identifiers into real word tokens", () => {
    expect(tokenize("passwordHash")).toEqual(["password", "hash"]);
  });

  it("splits snake_case and kebab-case", () => {
    expect(tokenize("get_default_branch")).toEqual(["get", "default", "branch"]);
    expect(tokenize("get-default-branch")).toEqual(["get", "default", "branch"]);
  });

  it("splits consecutive-caps acronyms from a following capitalized word", () => {
    expect(tokenize("HTTPServer")).toEqual(["http", "server"]);
  });

  it("drops single-character noise tokens", () => {
    expect(tokenize("a b cd")).toEqual(["cd"]);
  });

  it("is case-insensitive", () => {
    expect(tokenize("VerifyPassword")).toEqual(["verify", "password"]);
  });
});

describe("lexicalOverlapScore", () => {
  it("is 1 when every query token appears in the content", () => {
    expect(lexicalOverlapScore(["password", "hash"], ["password", "hash", "compare"])).toBe(1);
  });

  it("is 0 when no query token appears", () => {
    expect(lexicalOverlapScore(["password"], ["notify", "user"])).toBe(0);
  });

  it("is the matched fraction for a partial overlap", () => {
    expect(lexicalOverlapScore(["password", "reset"], ["password", "hash"])).toBe(0.5);
  });

  it("is 0 for an empty query (never divides by zero)", () => {
    expect(lexicalOverlapScore([], ["anything"])).toBe(0);
  });
});

describe("identifierMatchScore", () => {
  it("is 0 with no symbol", () => {
    expect(identifierMatchScore(new Set(["password"]), null)).toBe(0);
  });

  it("is the fraction of the symbol's own tokens present in the query", () => {
    expect(identifierMatchScore(new Set(["verify", "user"]), "verifyPassword")).toBe(0.5);
  });

  it("is 1 when every symbol token is present in the query", () => {
    expect(identifierMatchScore(new Set(["verify", "password", "hash"]), "verifyPassword")).toBe(1);
  });
});

describe("exactIdentifierBoost", () => {
  it("is 1 when the query contains the exact symbol name as a substring", () => {
    expect(exactIdentifierBoost("what does verifyPassword do?", "verifyPassword")).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(exactIdentifierBoost("what does VERIFYPASSWORD do?", "verifyPassword")).toBe(1);
  });

  it("is 0 when the query doesn't contain the exact name", () => {
    expect(exactIdentifierBoost("how is a password checked?", "verifyPassword")).toBe(0);
  });

  it("is 0 with no symbol or a too-short symbol name", () => {
    expect(exactIdentifierBoost("anything", null)).toBe(0);
    expect(exactIdentifierBoost("a", "a")).toBe(0);
  });
});

describe("filePathMatchScore", () => {
  it("rewards a query naming part of the file path", () => {
    expect(filePathMatchScore(new Set(["auth", "session"]), "auth/session.ts")).toBeGreaterThan(0);
  });

  it("is 0 when no path segment appears in the query", () => {
    expect(filePathMatchScore(new Set(["notify"]), "auth/session.ts")).toBe(0);
  });
});

describe("combinedScore", () => {
  it("weights semantic score as the dominant term", () => {
    const highSemantic = combinedScore({
      semanticScore: 0.9,
      lexicalScore: 0,
      identifierScore: 0,
      exactIdentifierScore: 0,
      filePathScore: 0,
    });
    const lowSemanticHighOthers = combinedScore({
      semanticScore: 0.1,
      lexicalScore: 1,
      identifierScore: 1,
      exactIdentifierScore: 0,
      filePathScore: 1,
    });
    expect(highSemantic).toBeGreaterThan(lowSemanticHighOthers - 1); // sanity: weights are documented, not absolute
    // HYBRID_WEIGHTS.semantic is 0.8 (lowered from 1.0 in the retrieval-
    // target-closure architecture's real-local-embedding-model pass — see
    // that constant's own comment), so a pure semantic score of 0.9 nets 0.72.
    expect(highSemantic).toBeCloseTo(0.72, 5);
  });

  it("an exact identifier match produces the largest single boost", () => {
    const withExact = combinedScore({ semanticScore: 0.5, lexicalScore: 0, identifierScore: 0, exactIdentifierScore: 1, filePathScore: 0 });
    const withoutExact = combinedScore({ semanticScore: 0.5, lexicalScore: 0, identifierScore: 0, exactIdentifierScore: 0, filePathScore: 0 });
    expect(withExact - withoutExact).toBeCloseTo(0.4, 5);
  });
});

describe("computeScoreSignals", () => {
  it("computes all signals deterministically from a query and a candidate", () => {
    const signals = computeScoreSignals("what does verifyPassword do?", 0.42, {
      content: "export function verifyPassword(user, hash) { return user.passwordHash === hash; }",
      symbolName: "verifyPassword",
      filePath: "auth/session.ts",
    });
    expect(signals.semanticScore).toBe(0.42);
    expect(signals.exactIdentifierScore).toBe(1);
    expect(signals.identifierScore).toBe(1);
    expect(signals.lexicalScore).toBeGreaterThan(0);
  });

  it("is fully deterministic across repeated calls", () => {
    const candidate = { content: "export function add(a, b) { return a + b; }", symbolName: "add", filePath: "math.ts" };
    const a = computeScoreSignals("add two numbers", 0.5, candidate);
    const b = computeScoreSignals("add two numbers", 0.5, candidate);
    expect(a).toEqual(b);
  });
});
