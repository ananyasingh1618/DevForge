import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { requireOwnedProject } from "../lib/ownership.js";

const uuidSchema = z.string().uuid();

/**
 * Phase 16, Milestone 16.3 — a second, independent ownership check at the
 * route boundary, in addition to (never instead of) every project-scoped
 * service's own `requireOwnedProject()` call. The two layers are
 * deliberately redundant: this one exists so that an ownership bug
 * introduced into a service function in the future is still caught here,
 * before the request reaches any controller or service code at all — true
 * defense in depth, not a relocation of the single existing check.
 *
 * Mounted via `router.use(path, requireAuth, requireProjectOwnership)` on
 * every `/projects/:projectId/...` router, immediately after `requireAuth`
 * (so `req.user` is always populated by the time this runs).
 *
 * If `:projectId` isn't UUID-shaped, this middleware deliberately does
 * nothing and calls `next()` — malformed-id validation is each route's own
 * Zod parameter schema's job (enforced downstream in the controller), not
 * this middleware's; duplicating that validation here would be a second
 * source of truth for what a "valid id" looks like. This middleware only
 * ever adds an ownership check for ids that are already well-formed.
 */
export async function requireProjectOwnership(req: Request, _res: Response, next: NextFunction) {
  try {
    const parsedId = uuidSchema.safeParse(req.params["projectId"]);
    if (!parsedId.success) {
      next();
      return;
    }
    if (!req.user) {
      next(AppError.unauthenticated());
      return;
    }
    await requireOwnedProject(req.user.id, parsedId.data);
    next();
  } catch (err) {
    next(err);
  }
}
