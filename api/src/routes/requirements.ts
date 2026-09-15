import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireProjectOwnership } from "../middleware/requireProjectOwnership.js";
import { activate, analyze, compare, getById, list, update } from "../controllers/requirements.js";

export const requirementsRouter = Router();

requirementsRouter.use("/projects/:projectId/requirements", requireAuth, requireProjectOwnership);

requirementsRouter.post("/projects/:projectId/requirements/analyze", analyze);
requirementsRouter.get("/projects/:projectId/requirements", list);
// /compare must be registered before the /:versionId GET route below, or
// Express would match "compare" as a versionId value.
requirementsRouter.get("/projects/:projectId/requirements/compare", compare);
requirementsRouter.get("/projects/:projectId/requirements/:versionId", getById);
requirementsRouter.patch("/projects/:projectId/requirements/:versionId", update);
requirementsRouter.post("/projects/:projectId/requirements/:versionId/activate", activate);
