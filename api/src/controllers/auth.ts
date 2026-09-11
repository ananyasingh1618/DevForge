import type { Request, Response } from "express";
import { parseWithSchema } from "../lib/validate.js";
import { registerSchema, loginSchema } from "../schemas/auth.js";
import { clearSessionCookie, setSessionCookie } from "../lib/cookies.js";
import { SESSION_COOKIE_NAME } from "../lib/sessionToken.js";
import { deleteSessionByToken, loginUser, registerUser } from "../services/auth.js";

export async function register(req: Request, res: Response) {
  const input = parseWithSchema(registerSchema, req.body);
  const { user, sessionToken, expiresAt } = await registerUser(input);
  setSessionCookie(res, sessionToken, expiresAt);
  res.status(201).json({ data: { user } });
}

export async function login(req: Request, res: Response) {
  const input = parseWithSchema(loginSchema, req.body);
  const { user, sessionToken, expiresAt } = await loginUser(input);
  setSessionCookie(res, sessionToken, expiresAt);
  res.status(200).json({ data: { user } });
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (token) {
    await deleteSessionByToken(token);
  }
  clearSessionCookie(res);
  res.status(204).send();
}

export function me(req: Request, res: Response) {
  // requireAuth has already populated req.user, or this handler is unreachable.
  res.status(200).json({ data: { user: req.user } });
}
