import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
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
import { AppError } from "./lib/errors.js";
import { env } from "./env.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.FRONTEND_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  app.use(healthRouter);
  app.use(authRouter);
  app.use(projectsRouter);
  app.use(requirementsRouter);
  app.use(prdRouter);
  app.use(architectureRouter);
  app.use(epicsRouter);
  app.use(tasksRouter);
  app.use(repositoryRouter);
  app.use(codebaseIndexRouter);

  // Unmatched routes become a structured 404 rather than Express's default HTML page.
  app.use((_req, _res, next) => {
    next(AppError.notFound("Route not found"));
  });

  // Centralized error handler: every thrown/forwarded error becomes the same
  // { error: { code, message, details? } } envelope. Internal error details
  // (stack traces, raw exception messages) are never sent to the client.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }

    console.error(err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
  });

  return app;
}
