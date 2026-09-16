import { describe, expect, it } from "vitest";
import { classifyQueryIntent, negatedWordSet } from "./queryIntent.js";

describe("classifyQueryIntent", () => {
  it("classifies an entry-point query", () => {
    expect(classifyQueryIntent("What is the public entry point for adding an item to the cart?")).toBe("entry-point");
  });

  it("classifies an orchestration query", () => {
    expect(classifyQueryIntent("Walk me through everything that happens when an order is processed.")).toBe("orchestration");
  });

  it("classifies a dependency query", () => {
    expect(classifyQueryIntent("Which function does orderProcessor import to load a user's orders?")).toBe("dependency");
  });

  it("classifies a usage query", () => {
    expect(classifyQueryIntent("Where is validateOrderItems used?")).toBe("usage");
  });

  it("classifies a configuration query", () => {
    expect(classifyQueryIntent("Where is the webhook signing secret loaded from an environment variable?")).toBe("configuration");
  });

  it("classifies an error query", () => {
    expect(classifyQueryIntent("Where might a SQL injection vulnerability exist?")).toBe("error");
  });

  it("classifies a test query", () => {
    expect(classifyQueryIntent("What test cases exist for verifyPassword?")).toBe("test");
  });

  it("classifies a bare identifier as a definition query", () => {
    expect(classifyQueryIntent("SessionUser")).toBe("definition");
  });

  it("falls back to general for an ordinary natural-language question matching no pattern", () => {
    expect(classifyQueryIntent("How does DevForge calculate the total price of an order?")).toBe("general");
  });

  it("is deterministic across repeated calls", () => {
    const q = "Which function does the cart module's public removeFromCart delegate to?";
    expect(classifyQueryIntent(q)).toBe(classifyQueryIntent(q));
  });
});

describe("negatedWordSet", () => {
  it("extracts words from a 'fails to' negation clause", () => {
    const words = negatedWordSet("Which function fails to check that the requester owns the order?");
    expect(words.has("check")).toBe(true);
    expect(words.has("owns")).toBe(true);
  });

  it("extracts words from a 'without' negation clause", () => {
    const words = negatedWordSet("How does DevForge send a notification without waiting for the response?");
    expect(words.has("waiting")).toBe(true);
  });

  it("returns an empty set for a query with no negation cue", () => {
    expect(negatedWordSet("How does DevForge calculate the order total?").size).toBe(0);
  });

  it("does not carry state across separate calls (lastIndex reset)", () => {
    const first = negatedWordSet("Which function fails to check ownership?");
    const second = negatedWordSet("A completely unrelated query with no negation.");
    expect(first.size).toBeGreaterThan(0);
    expect(second.size).toBe(0);
  });
});
