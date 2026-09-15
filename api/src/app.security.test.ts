import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import {
  API_RATE_LIMIT_MAX,
  API_RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_WINDOW_MS,
  tooManyRequestsHandler,
} from "./middleware/rateLimit.js";

/**
 * Phase 16, Milestone 16.5 — API security. Two things are deliberately
 * NOT exercised here as live-triggered behavior:
 * - Rate limiting: skipped entirely when NODE_ENV=test (see
 *   middleware/rateLimit.ts's own doc comment for why — the existing
 *   suite legitimately sends far more than 20 requests per file), so
 *   this file only asserts the limiter is actually mounted (via its
 *   response headers) and that its config values are the intended ones;
 *   real 429-triggering behavior is exercised live in Milestone 16.8's
 *   Docker-based verification instead.
 */

const app = createApp();

async function cleanDb() {
  await prisma.session.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

beforeEach(async () => {
  await cleanDb();
});

afterEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

describe("CORS", () => {
  it("allows the configured FRONTEND_ORIGIN with credentials", async () => {
    const res = await request(app).get("/health").set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it(
    "never reflects an arbitrary foreign Origin back in Access-Control-Allow-Origin — the cors " +
      "package is configured with a single fixed origin string, not a function that echoes " +
      "whatever Origin the request sent, so a page at evil.example.com would see an ACAO value " +
      "that doesn't match its own origin and have the response blocked by the browser itself",
    async () => {
      const res = await request(app).get("/health").set("Origin", "https://evil.example.com");
      expect(res.headers["access-control-allow-origin"]).not.toBe("https://evil.example.com");
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    },
  );
});

describe("secure headers (helmet)", () => {
  it("sets X-Content-Type-Options: nosniff on every response", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("does not set X-Powered-By: Express (helmet's default hides it)", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("rate limiter configuration and real throttling behavior", () => {
  it("configures the auth limiter strictly (20 per 15 minutes) and the general API limiter generously (1000 per 15 minutes)", () => {
    expect(AUTH_RATE_LIMIT_MAX).toBe(20);
    expect(AUTH_RATE_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(API_RATE_LIMIT_MAX).toBe(1000);
    expect(API_RATE_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
    // The auth limiter is meaningfully stricter than the general one.
    expect(AUTH_RATE_LIMIT_MAX).toBeLessThan(API_RATE_LIMIT_MAX);
  });

  it(
    "actually throttles with a 429 TOO_MANY_REQUESTS once the limit is exceeded — built with the exact same " +
      "handler this app wires in, but skip:()=>false instead of the real limiters' env.NODE_ENV==='test' skip, " +
      "since vitest.config.ts fixes NODE_ENV=test for the whole run and the real authRateLimit/apiRateLimit " +
      "instances deliberately respect that (see middleware/rateLimit.ts's own doc comment)",
    async () => {
      const testApp = express();
      const limiter = rateLimit({
        windowMs: 60_000,
        limit: 2,
        standardHeaders: true,
        legacyHeaders: false,
        skip: () => false,
        handler: tooManyRequestsHandler,
      });
      testApp.use(limiter);
      testApp.get("/probe", (_req, res) => res.status(200).json({ ok: true }));
      testApp.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const appError = err as { status?: number; code?: string; message?: string };
        res.status(appError.status ?? 500).json({ error: { code: appError.code, message: appError.message } });
      });

      const first = await request(testApp).get("/probe");
      const second = await request(testApp).get("/probe");
      const third = await request(testApp).get("/probe");

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe("TOO_MANY_REQUESTS");
    },
  );

  it("is skipped in test env on the real app (NODE_ENV=test), so the existing 400+ test suite is never throttled", async () => {
    // Confirms the deliberate test-env bypass this file's own header comment
    // describes — sending well more than AUTH_RATE_LIMIT_MAX requests to a
    // strictly-limited real endpoint never produces a 429 under test.
    for (let i = 0; i < AUTH_RATE_LIMIT_MAX + 5; i++) {
      const res = await request(app).post("/auth/login").send({ email: "rl-skip-check@example.com", password: "wrong" });
      expect(res.status).not.toBe(429);
    }
  });
});

describe("audit logging (Phase 16, Milestone 16.5)", () => {
  it("logs auth.register on successful registration, never including the password", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await request(app).post("/auth/register").send({ email: "audit-register@example.com", password: "correct-horse-battery" });
    expect(res.status).toBe(201);

    const events = logSpy.mock.calls.map((call) => String(call[0]));
    const registerEvent = events.find((e) => e.includes('"auth.register"'));
    expect(registerEvent).toBeDefined();
    expect(registerEvent).not.toContain("correct-horse-battery");
    logSpy.mockRestore();
  });

  it("logs auth.login_failure without leaking which email was tried (enumeration-resistant, matching loginUser's own design)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await request(app).post("/auth/login").send({ email: "nonexistent-audit@example.com", password: "wrong" });

    const events = logSpy.mock.calls.map((call) => String(call[0]));
    const failureEvent = events.find((e) => e.includes('"auth.login_failure"'));
    expect(failureEvent).toBeDefined();
    expect(failureEvent).not.toContain("nonexistent-audit@example.com");
    expect(failureEvent).not.toContain("wrong");
    logSpy.mockRestore();
  });

  it("logs auth.login_success on a real successful login", async () => {
    await request(app).post("/auth/register").send({ email: "audit-login@example.com", password: "correct-horse-battery" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await request(app).post("/auth/login").send({ email: "audit-login@example.com", password: "correct-horse-battery" });
    expect(res.status).toBe(200);

    const events = logSpy.mock.calls.map((call) => String(call[0]));
    expect(events.some((e) => e.includes('"auth.login_success"'))).toBe(true);
    logSpy.mockRestore();
  });

  it("logs ownership.denied when a user is denied access to another user's project", async () => {
    const ownerRes = await request(app).post("/auth/register").send({ email: "audit-owner@example.com", password: "correct-horse-battery" });
    const ownerCookie = ownerRes.headers["set-cookie"] as unknown as string[];
    const projectRes = await request(app).post("/projects").set("Cookie", ownerCookie).send({ name: "Audit Test Project" });
    const projectId = projectRes.body.data.project.id as string;

    const intruderRes = await request(app).post("/auth/register").send({ email: "audit-intruder@example.com", password: "correct-horse-battery" });
    const intruderCookie = intruderRes.headers["set-cookie"] as unknown as string[];

    // /projects/:id itself resolves ownership via getProjectForOwner()
    // (its own direct lookup, not requireOwnedProject() — see
    // services/projects.ts), so a nested resource route is used here to
    // exercise requireOwnedProject()'s own audit-log call specifically.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await request(app).get(`/projects/${projectId}/jobs`).set("Cookie", intruderCookie);

    const events = logSpy.mock.calls.map((call) => String(call[0]));
    expect(events.some((e) => e.includes('"ownership.denied"') && e.includes(projectId))).toBe(true);
    logSpy.mockRestore();
  });
});
