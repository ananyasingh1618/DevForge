/**
 * Request-ID propagation and structured request logging (Phase 17,
 * Milestone 17.5). Every request gets a correlation ID — reused from an
 * incoming `X-Request-Id` header when the caller already supplied one (so
 * a request can be traced end-to-end across a frontend/proxy/API chain),
 * generated fresh otherwise — attached to `req`, echoed back in the
 * response header, and included in every log line this middleware itself
 * emits. `recordRequest()` (lib/metrics.ts) is fed from the exact same
 * `res.on("finish")` hook, so `/metrics`'s own request counts and
 * latencies are always derived from real, observed responses, never a
 * separate/parallel bookkeeping path that could drift from what actually
 * happened.
 */

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";
import { recordRequest } from "../lib/metrics.js";

// `req.requestId`'s type is declared once, globally, in types/express.d.ts
// (matching the existing `req.user` augmentation pattern) — not redeclared
// here.

const REQUEST_ID_HEADER = "x-request-id";

/** Collapses a real path into a low-cardinality route label for logging/
 * metrics — replaces path segments that look like a UUID or another
 * opaque ID with a placeholder, so `/projects/abc-123/jobs/def-456` and
 * `/projects/xyz-789/jobs/ghi-012` count as the same route rather than
 * each request minting a brand-new metrics series (which would make
 * `/metrics` grow without bound under real traffic). */
function routeLabel(path: string): string {
  return path
    .split("/")
    .map((segment) => (/^[0-9a-f-]{8,}$/i.test(segment) ? ":id" : segment))
    .join("/");
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  req.requestId = incoming && incoming.length > 0 && incoming.length <= 200 ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);

  const startedAt = Date.now();
  res.on("finish", () => {
    const latencyMs = Date.now() - startedAt;
    const label = routeLabel(req.path);
    recordRequest(label, res.statusCode, latencyMs);
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]("http_request", {
      requestId: req.requestId,
      method: req.method,
      route: label,
      statusCode: res.statusCode,
      latencyMs,
    });
  });

  next();
}
