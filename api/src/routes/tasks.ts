import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { activate, compare, generate, getById, list, update } from "../controllers/tasks.js";

export const tasksRouter = Router();

tasksRouter.use("/projects/:projectId/tasks", requireAuth);

tasksRouter.post("/projects/:projectId/tasks/generate", generate);
tasksRouter.get("/projects/:projectId/tasks", list);
// /compare must be registered before the /:versionId GET route below, or
// Express would match "compare" as a versionId value.
tasksRouter.get("/projects/:projectId/tasks/compare", compare);
tasksRouter.get("/projects/:projectId/tasks/:versionId", getById);
tasksRouter.patch("/projects/:projectId/tasks/:versionId", update);
tasksRouter.post("/projects/:projectId/tasks/:versionId/activate", activate);
