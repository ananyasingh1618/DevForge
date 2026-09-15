import { Router } from "express";
import { login, logout, me, register } from "../controllers/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { authRateLimit } from "../middleware/rateLimit.js";

export const authRouter = Router();

// Strict rate limiting only on the two endpoints a credential-stuffing or
// brute-force attempt would actually hit — /auth/logout and /auth/me carry
// the general apiRateLimit applied to the rest of the API in app.ts, not
// this stricter one (a legitimate user's own client can call those far
// more often than 20 times per 15 minutes without it being suspicious).
authRouter.post("/auth/register", authRateLimit, register);
authRouter.post("/auth/login", authRateLimit, login);
authRouter.post("/auth/logout", requireAuth, logout);
authRouter.get("/auth/me", requireAuth, me);
