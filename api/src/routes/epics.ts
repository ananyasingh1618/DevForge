import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireProjectOwnership } from "../middleware/requireProjectOwnership.js";
import { activate, compare, generate, getById, list, update } from "../controllers/epics.js";

export const epicsRouter = Router();

epicsRouter.use("/projects/:projectId/epics", requireAuth, requireProjectOwnership);

epicsRouter.post("/projects/:projectId/epics/generate", generate);
epicsRouter.get("/projects/:projectId/epics", list);
// /compare must be registered before the /:versionId GET route below, or
// Express would match "compare" as a versionId value.
epicsRouter.get("/projects/:projectId/epics/compare", compare);
epicsRouter.get("/projects/:projectId/epics/:versionId", getById);
epicsRouter.patch("/projects/:projectId/epics/:versionId", update);
epicsRouter.post("/projects/:projectId/epics/:versionId/activate", activate);
