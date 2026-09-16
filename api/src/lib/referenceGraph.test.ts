import { describe, expect, it } from "vitest";
import { areLinked, buildReferenceGraph, type ReferenceCandidate } from "./referenceGraph.js";

describe("buildReferenceGraph", () => {
  it("detects a call-shaped reference", () => {
    const candidates: ReferenceCandidate[] = [
      { chunkId: "caller", symbolName: "processOrder", content: "function processOrder() { validateOrderItems(items); }" },
      { chunkId: "callee", symbolName: "validateOrderItems", content: "function validateOrderItems(items) { /* ... */ }" },
    ];
    const graph = buildReferenceGraph(candidates);
    expect(graph.get("caller")?.has("callee")).toBe(true);
    expect(graph.get("callee")?.has("caller")).toBe(false);
  });

  it("detects an import-shaped reference (ES import)", () => {
    const candidates: ReferenceCandidate[] = [
      { chunkId: "importer", symbolName: "processOrder", content: 'import { findOrdersByUserId } from "../db/orderRepository.js";\nfunction processOrder() {}' },
      { chunkId: "imported", symbolName: "findOrdersByUserId", content: "function findOrdersByUserId(userId) { /* ... */ }" },
    ];
    const graph = buildReferenceGraph(candidates);
    expect(graph.get("importer")?.has("imported")).toBe(true);
  });

  it("detects a CommonJS require-shaped reference", () => {
    const candidates: ReferenceCandidate[] = [
      { chunkId: "a", symbolName: "addToCart", content: 'const { addItem } = require("./cartService");\nfunction addToCart() { return addItem(); }' },
      { chunkId: "b", symbolName: "addItem", content: "function addItem() { /* ... */ }" },
    ];
    const graph = buildReferenceGraph(candidates);
    expect(graph.get("a")?.has("b")).toBe(true);
  });

  it("does not create a self-edge", () => {
    const candidates: ReferenceCandidate[] = [{ chunkId: "a", symbolName: "foo", content: "function foo() { foo(); }" }];
    const graph = buildReferenceGraph(candidates);
    expect(graph.get("a")?.has("a")).toBe(false);
  });

  it("does not falsely match a longer identifier that merely contains the shorter one as a substring", () => {
    const candidates: ReferenceCandidate[] = [
      { chunkId: "a", symbolName: "processOrder", content: "function processOrder() { findOrdersByUserIdAndStatus(); }" },
      { chunkId: "b", symbolName: "findOrdersByUserId", content: "function findOrdersByUserId() {}" },
    ];
    const graph = buildReferenceGraph(candidates);
    // The content calls findOrdersByUserIdAndStatus, not findOrdersByUserId
    // — a real word-boundary check must not treat this as a match.
    expect(graph.get("a")?.has("b")).toBe(false);
  });

  it("ignores a candidate with no symbol name or a too-short one", () => {
    const candidates: ReferenceCandidate[] = [
      { chunkId: "a", symbolName: "processOrder", content: "function processOrder() { doIt(); }" },
      { chunkId: "b", symbolName: null, content: "// whole-file chunk" },
      { chunkId: "c", symbolName: "ab", content: "function ab() {}" }, // too short (<3 chars)
    ];
    const graph = buildReferenceGraph(candidates);
    expect(graph.get("a")?.has("b")).toBe(false);
    expect(graph.get("a")?.has("c")).toBe(false);
  });

  it("returns no edges for a pool of genuinely unrelated candidates", () => {
    const candidates: ReferenceCandidate[] = [
      { chunkId: "a", symbolName: "validateEmail", content: "function validateEmail(s) { return s.includes('@'); }" },
      { chunkId: "b", symbolName: "formatCurrency", content: "function formatCurrency(n) { return `$${n}`; }" },
    ];
    const graph = buildReferenceGraph(candidates);
    expect(graph.get("a")?.size ?? 0).toBe(0);
    expect(graph.get("b")?.size ?? 0).toBe(0);
  });
});

describe("areLinked", () => {
  it("is true when either direction has an edge", () => {
    const candidates: ReferenceCandidate[] = [
      { chunkId: "a", symbolName: "foo", content: "function foo() { bar(); }" },
      { chunkId: "b", symbolName: "bar", content: "function bar() {}" },
    ];
    const graph = buildReferenceGraph(candidates);
    expect(areLinked(graph, "a", "b")).toBe(true);
    expect(areLinked(graph, "b", "a")).toBe(true);
  });

  it("is false when neither references the other", () => {
    const candidates: ReferenceCandidate[] = [
      { chunkId: "a", symbolName: "foo", content: "function foo() {}" },
      { chunkId: "b", symbolName: "bar", content: "function bar() {}" },
    ];
    const graph = buildReferenceGraph(candidates);
    expect(areLinked(graph, "a", "b")).toBe(false);
  });
});
