import type { Response } from "express";
import { env } from "../env.js";
import { SESSION_COOKIE_NAME } from "./sessionToken.js";

// SameSite is configurable (env.ts: SESSION_COOKIE_SAMESITE, default "lax").
// "none" is only needed when the frontend is hosted on a different *site*
// than the API, and it trades away the CSRF protection "lax" gives — so it
// is an explicit opt-in, never inferred from NODE_ENV.
const cookieAttributes = {
  secure: env.NODE_ENV === "production",
  sameSite: env.SESSION_COOKIE_SAMESITE,
};

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    ...cookieAttributes,
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    ...cookieAttributes,
    path: "/",
  });
}
