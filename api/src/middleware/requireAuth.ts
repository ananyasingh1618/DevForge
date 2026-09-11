import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";
import { SESSION_COOKIE_NAME } from "../lib/sessionToken.js";
import { getUserForSessionToken } from "../services/auth.js";

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (!token) {
    next(AppError.unauthenticated());
    return;
  }

  const user = await getUserForSessionToken(token);
  if (!user) {
    next(AppError.unauthenticated());
    return;
  }

  req.user = user;
  next();
}
