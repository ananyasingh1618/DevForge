import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { activate, compare, generate, getById, list, update } from "../controllers/architecture.js";

export const architectureRouter = Router();

architectureRouter.use("/projects/:projectId/architecture", requireAuth);

architectureRouter.post("/projects/:projectId/architecture/generate", generate);
architectureRouter.get("/projects/:projectId/architecture", list);
// /compare must be registered before the /:versionId GET route below, or
// Express would match "compare" as a versionId value.
architectureRouter.get("/projects/:projectId/architecture/compare", compare);
architectureRouter.get("/projects/:projectId/architecture/:versionId", getById);
architectureRouter.patch("/projects/:projectId/architecture/:versionId", update);
architectureRouter.post("/projects/:projectId/architecture/:versionId/activate", activate);
