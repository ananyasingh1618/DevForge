import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { apiRateLimit } from "./middleware/rateLimit.js";
import { requestContext } from "./middleware/requestContext.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { projectsRouter } from "./routes/projects.js";
import { requirementsRouter } from "./routes/requirements.js";
import { prdRouter } from "./routes/prd.js";
import { architectureRouter } from "./routes/architecture.js";
import { epicsRouter } from "./routes/epics.js";
import { tasksRouter } from "./routes/tasks.js";
import { repositoryRouter } from "./routes/repository.js";
import { codebaseIndexRouter } from "./routes/codebaseIndex.js";
import { retrievalRouter } from "./routes/retrieval.js";
import { qaRouter } from "./routes/qa.js";
import { codeReviewRouter } from "./routes/codeReview.js";
import { evaluationsRouter } from "./routes/evaluations.js";
import { jobsRouter } from "./routes/jobs.js";
import { AppError } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { env } from "./env.js";

export function createApp() {
  const app = express();

  // Secure headers (Phase 16, Milestone 16.5): HSTS, X-Content-Type-Options,
  // X-Frame-Options, a conservative default CSP, etc. — this API serves
  // only JSON, never HTML, so helmet's defaults are appropriate as-is with
  // no per-route CSP tuning needed.
  app.use(helmet());

  app.use(
    cors({
      origin: env.FRONTEND_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  // Request-ID propagation + structured request logging + real request
  // metrics (Phase 17, Milestone 17.5) — mounted early so every response,
  // including one from the centralized error handler at the bottom of this
  // function, carries an X-Request-Id header and is logged/counted.
  app.use(requestContext);

  // General request-volume backstop across the whole API (see
  // middleware/rateLimit.ts), mounted before every router. /auth/register
  // and /auth/login additionally carry their own much stricter
  // authRateLimit (wired in routes/auth.ts) — with a limit of 20 per 15
  // minutes versus this one's 1000, that limiter is always the one that
  // actually triggers first on those two routes; this general one is the
  // real gate for every other route (including the rest of authRouter —
  // /auth/logout, /auth/me). Mounted after healthRouter so Docker's own
  // frequent health-check polling is never itself rate-limited.
  app.use(healthRouter);
  app.use(apiRateLimit);
  app.use(authRouter);
  app.use(projectsRouter);
  app.use(requirementsRouter);
  app.use(prdRouter);
  app.use(architectureRouter);
  app.use(epicsRouter);
  app.use(tasksRouter);
  app.use(repositoryRouter);
  app.use(codebaseIndexRouter);
  app.use(retrievalRouter);
  app.use(qaRouter);
  app.use(codeReviewRouter);
  app.use(evaluationsRouter);
  app.use(jobsRouter);

  // Unmatched routes become a structured 404 rather than Express's default HTML page.
  app.use((_req, _res, next) => {
    next(AppError.notFound("Route not found"));
  });

  // Centralized error handler: every thrown/forwarded error becomes the same
  // { error: { code, message, details? } } envelope. Internal error details
  // (stack traces, raw exception messages) are never sent to the client.
  // Every error is also logged with a safe category (Phase 17, Milestone
  // 17.5) — "client" (4xx: a bad/unauthorized/malformed request, expected
  // and not itself an operational problem) vs. "server" (5xx or an
  // unrecognized exception: a real failure worth an operator's attention)
  // — plus the request ID, so a specific failed request's log line and its
  // response are always correlatable.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      logger[err.status >= 500 ? "error" : "warn"]("request_error", {
        requestId: req.requestId,
        category: err.status >= 500 ? "server" : "client",
        code: err.code,
        status: err.status,
      });
      res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    logger.error("unhandled_exception", {
      requestId: req.requestId,
      category: "server",
      code: "INTERNAL_ERROR",
      // Redacted by logger.ts before being written — see its own
      // redactFields() — so an exception message that happens to echo a
      // secret-shaped value never reaches stdout unredacted.
      message,
    });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
  });

  return app;
}
