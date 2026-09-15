import { rateLimit } from "express-rate-limit";
import { env } from "../env.js";
import { AppError } from "../lib/errors.js";
import type { NextFunction, Request, Response } from "express";

/**
 * Phase 16, Milestone 16.5 — request-volume throttling. Previously there
 * was none at all (Milestone 16.1's inventory finding): `/auth/login` and
 * `/auth/register` had only response-content enumeration resistance
 * (loginUser()'s identical error message), nothing limiting how many
 * attempts a single client could make.
 *
 * Two tiers:
 * - `authRateLimit`: strict, applied only to `/auth/register` and
 *   `/auth/login` — the endpoints a credential-stuffing or brute-force
 *   attempt would actually hit.
 * - `apiRateLimit`: generous, applied to everything else, as a general
 *   abuse/DoS backstop rather than a security boundary in its own right
 *   (every route is already authenticated and ownership-scoped).
 *
 * Skipped entirely in `test` (NODE_ENV=test): the existing test suite
 * legitimately sends hundreds of requests per file from the same
 * in-process client, which a real limiter would otherwise throttle,
 * turning unrelated tests flaky. Milestone 16.8's live Docker verification
 * exercises the real (non-skipped) limiter against a running server
 * instead — proof against the actual behavior, not just the config.
 */
const skipInTest = () => env.NODE_ENV === "test";

// Exported so tests can assert on the actual configured numbers directly,
// and can build a standalone limiter with the same shape but skip:()=>false
// to prove the real (non-skipped) throttling and error-handling behavior —
// without needing to fight vitest.config.ts's fixed NODE_ENV=test, which
// the real, mounted authRateLimit/apiRateLimit instances below deliberately
// respect.
export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const AUTH_RATE_LIMIT_MAX = 20;
export const API_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const API_RATE_LIMIT_MAX = 1000;

export function tooManyRequestsHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(429, "TOO_MANY_REQUESTS", "Too many requests. Please try again later."));
}

export const authRateLimit = rateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  limit: AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: tooManyRequestsHandler,
});

export const apiRateLimit = rateLimit({
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  limit: API_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: tooManyRequestsHandler,
});
