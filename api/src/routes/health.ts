/**
 * Liveness, readiness, and metrics endpoints (Phase 17, Milestone 17.2 —
 * docs/OPERATIONS.md's "Health checks" section).
 *
 * `/health` (liveness): the process is up and its event loop is
 * responsive. Never touches the database — Docker/an orchestrator uses
 * this to decide "should this container be restarted," and a slow/down
 * database must not itself trigger a restart loop (that would make a
 * database outage worse by also killing otherwise-healthy API processes).
 *
 * `/ready` (readiness): the process is up *and* its real dependencies are
 * reachable — currently just Postgres (the one hard dependency this
 * process cannot serve any request without). An orchestrator uses this to
 * decide "should this container receive traffic." ai-service is
 * deliberately *not* checked here: it is a soft dependency whose own
 * routes/services already degrade to a real, honest 503
 * PROVIDER_NOT_CONFIGURED/AI_SERVICE_UNAVAILABLE per-request when it is
 * down, rather than taking the whole API out of rotation for a failure
 * that only affects a subset of its features.
 *
 * `/metrics`: real, in-process request/job counters (lib/metrics.ts) in
 * Prometheus text exposition format, plus `/metrics.json` for a
 * human/script-readable equivalent. Unauthenticated, appropriate for this
 * project's own local/self-hosted deployment model (see
 * docs/DEPLOYMENT.md) — a genuinely public multi-tenant deployment should
 * put this behind a separate internal-only listener or reverse-proxy rule,
 * noted there as a real, current limitation, not silently assumed safe.
 */

import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { metricsPrometheusText, metricsSnapshot } from "../lib/metrics.js";
import { getQueueDepth } from "../services/jobs.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({ data: { status: "ok" } });
});

healthRouter.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ data: { status: "ready", database: "ok" } });
  } catch (err) {
    // Never leak a raw connection-string/driver error to the client — see
    // app.ts's own centralized-error-handler rationale for why. The real
    // error (redacted by logger.ts before being written, in case it
    // happens to echo a connection-string-shaped credential) is still
    // visible to an operator via the structured log line.
    logger.error("readiness_check_failed", { message: err instanceof Error ? err.message : String(err) });
    res.status(503).json({ error: { code: "NOT_READY", message: "Database is not reachable." } });
  }
});

healthRouter.get("/metrics", async (_req, res) => {
  const queueDepth = await getQueueDepth();
  const base = metricsPrometheusText();
  const queueLines =
    "# HELP devforge_job_queue_depth Current job counts by state.\n" +
    "# TYPE devforge_job_queue_depth gauge\n" +
    `devforge_job_queue_depth{state="queued"} ${queueDepth.queued}\n` +
    `devforge_job_queue_depth{state="running"} ${queueDepth.running}\n`;
  res.status(200).type("text/plain; version=0.0.4").send(base + queueLines);
});

healthRouter.get("/metrics.json", async (_req, res) => {
  const queueDepth = await getQueueDepth();
  res.status(200).json({ data: { ...metricsSnapshot(), queueDepth } });
});
