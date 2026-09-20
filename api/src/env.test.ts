import { describe, expect, it } from "vitest";
import { envSchema } from "./env.js";

/**
 * Tests envSchema directly (not the module-level `env`/`loadEnv()`, which
 * runs once at import time against the real process.env and calls
 * `process.exit(1)` on failure) — see env.ts's own comment on why
 * `envSchema` is exported specifically for this.
 */

const validBase = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://devforge:devforge@localhost:5433/devforge",
  SESSION_SECRET: "a".repeat(32),
  FRONTEND_ORIGIN: "http://localhost:5173",
};

describe("envSchema — general validation", () => {
  it("accepts a minimal valid development configuration", () => {
    const result = envSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("rejects a missing DATABASE_URL", () => {
    const { DATABASE_URL: _unused, ...rest } = validBase;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects a SESSION_SECRET shorter than 32 characters", () => {
    const result = envSchema.safeParse({ ...validBase, SESSION_SECRET: "too-short" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed GITHUB_TOKEN_ENCRYPTION_KEY (wrong byte length)", () => {
    const result = envSchema.safeParse({ ...validBase, GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.from("too-short").toString("base64") });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed GITHUB_TOKEN_ENCRYPTION_KEY (32 bytes)", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const result = envSchema.safeParse({ ...validBase, GITHUB_TOKEN_ENCRYPTION_KEY: key });
    expect(result.success).toBe(true);
  });

  it("defaults LOG_LEVEL to info", () => {
    const result = envSchema.safeParse(validBase);
    expect(result.success && result.data.LOG_LEVEL).toBe("info");
  });

  it("rejects an invalid LOG_LEVEL", () => {
    const result = envSchema.safeParse({ ...validBase, LOG_LEVEL: "verbose" });
    expect(result.success).toBe(false);
  });

  it("defaults database pool settings to safe conservative values", () => {
    const result = envSchema.safeParse(validBase);
    expect(result.success && result.data.DATABASE_POOL_MAX).toBe(10);
    expect(result.success && result.data.DATABASE_POOL_IDLE_TIMEOUT_MS).toBe(30_000);
    expect(result.success && result.data.DATABASE_CONNECT_TIMEOUT_MS).toBe(10_000);
  });
});

describe("envSchema — reverse-proxy and cookie settings", () => {
  it("defaults to no proxy trust and a SameSite=lax session cookie, even in production", () => {
    const result = envSchema.safeParse({ ...validBase, NODE_ENV: "production" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TRUST_PROXY_HOPS).toBe(0);
      expect(result.data.SESSION_COOKIE_SAMESITE).toBe("lax");
    }
  });

  it("accepts an explicit proxy hop count and SameSite opt-in", () => {
    const result = envSchema.safeParse({ ...validBase, TRUST_PROXY_HOPS: "1", SESSION_COOKIE_SAMESITE: "none" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.TRUST_PROXY_HOPS).toBe(1);
      expect(result.data.SESSION_COOKIE_SAMESITE).toBe("none");
    }
  });

  it("rejects a negative hop count and an unknown SameSite value", () => {
    expect(envSchema.safeParse({ ...validBase, TRUST_PROXY_HOPS: "-1" }).success).toBe(false);
    expect(envSchema.safeParse({ ...validBase, SESSION_COOKIE_SAMESITE: "maybe" }).success).toBe(false);
  });
});

describe("envSchema — production-only guardrails", () => {
  const validProd = {
    ...validBase,
    NODE_ENV: "production",
    SESSION_SECRET: "a-real-generated-production-secret-not-a-placeholder-1234",
    FRONTEND_ORIGIN: "https://app.example.com",
    DATABASE_URL: "postgresql://devforge:devforge@prod-db-host:5432/devforge",
  };

  it("accepts a fully-configured, non-placeholder production configuration", () => {
    const result = envSchema.safeParse(validProd);
    expect(result.success).toBe(true);
  });

  it("rejects the .env.example placeholder SESSION_SECRET in production", () => {
    const result = envSchema.safeParse({ ...validProd, SESSION_SECRET: "replace-with-a-random-64-char-hex-string" });
    expect(result.success).toBe(false);
  });

  it("rejects DATABASE_URL pointing at devforge_test in production", () => {
    const result = envSchema.safeParse({
      ...validProd,
      DATABASE_URL: "postgresql://devforge:devforge@prod-db-host:5432/devforge_test",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a legitimate local production-like deployment (NODE_ENV=production, localhost origin, a dedicated non-placeholder secret) — the supported docker-compose.yml deployment shape", () => {
    const result = envSchema.safeParse({
      ...validProd,
      FRONTEND_ORIGIN: "http://localhost:4173",
      SESSION_SECRET: "docker-compose-local-verification-secret-not-for-prod-0000",
    });
    expect(result.success).toBe(true);
  });

  it("does NOT apply any production guardrail in development or test mode", () => {
    // The exact same "bad" values that fail in production must be allowed
    // outside production — these guardrails are production-only by design.
    const devResult = envSchema.safeParse({
      ...validBase,
      NODE_ENV: "development",
      SESSION_SECRET: "replace-with-a-random-64-char-hex-string".padEnd(32, "x"),
    });
    expect(devResult.success).toBe(true);
  });
});
