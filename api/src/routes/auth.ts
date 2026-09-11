import { Router } from "express";
import { login, logout, me, register } from "../controllers/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const authRouter = Router();

authRouter.post("/auth/register", register);
authRouter.post("/auth/login", login);
authRouter.post("/auth/logout", requireAuth, logout);
authRouter.get("/auth/me", requireAuth, me);
