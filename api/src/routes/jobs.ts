import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireProjectOwnership } from "../middleware/requireProjectOwnership.js";
import { cancel, create, get, list, retry } from "../controllers/jobs.js";

export const jobsRouter = Router();

jobsRouter.use("/projects/:projectId/jobs", requireAuth, requireProjectOwnership);

jobsRouter.post("/projects/:projectId/jobs", create);
jobsRouter.get("/projects/:projectId/jobs", list);
jobsRouter.get("/projects/:projectId/jobs/:jobId", get);
jobsRouter.post("/projects/:projectId/jobs/:jobId/cancel", cancel);
jobsRouter.post("/projects/:projectId/jobs/:jobId/retry", retry);
