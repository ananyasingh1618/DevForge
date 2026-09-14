import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { ask, getOne, list } from "../controllers/qa.js";

export const qaRouter = Router();

qaRouter.use("/projects/:projectId/qa", requireAuth);

qaRouter.post("/projects/:projectId/qa", ask);
qaRouter.get("/projects/:projectId/qa", list);
qaRouter.get("/projects/:projectId/qa/:questionId", getOne);
