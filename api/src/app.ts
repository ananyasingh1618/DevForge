import express, { type NextFunction, type Request, type Response } from "express";
import { healthRouter } from "./routes/health.js";
import { AppError } from "./lib/errors.js";

export function createApp() {
  const app = express();

  app.use(express.json());

  app.use(healthRouter);

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
