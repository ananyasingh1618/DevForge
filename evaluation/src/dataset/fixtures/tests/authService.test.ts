// Fixture file for DevForge's evaluation dataset (Phase 13). Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project. Exercises the "tests" retrieval category and the adversarial
// "a test mentions a symbol but does not implement it" case: this file only
// imports and calls verifyPassword/requireAuth from auth/session.ts, it does
// not define them — a query for the real implementation must not match here.

import { describe, it, expect } from "vitest";
import { verifyPassword, requireAuth } from "../auth/session.js";

describe("verifyPassword", () => {
  it("returns true when the submitted hash matches the stored hash", () => {
    const user = { id: "u1", passwordHash: "abc123" };
    expect(verifyPassword(user, "abc123")).toBe(true);
  });

  it("returns false when the submitted hash does not match", () => {
    const user = { id: "u1", passwordHash: "abc123" };
    expect(verifyPassword(user, "wrong")).toBe(false);
  });
});

describe("requireAuth", () => {
  it("throws when no session token is provided", () => {
    expect(() => requireAuth(undefined, new Map())).toThrow("Authentication required");
  });
});
