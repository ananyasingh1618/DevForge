import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireProjectOwnership } from "../middleware/requireProjectOwnership.js";
import { activate, compare, generate, getById, list, update } from "../controllers/prd.js";

export const prdRouter = Router();

prdRouter.use("/projects/:projectId/prd", requireAuth, requireProjectOwnership);

prdRouter.post("/projects/:projectId/prd/generate", generate);
prdRouter.get("/projects/:projectId/prd", list);
// /compare must be registered before the /:versionId GET route below, or
// Express would match "compare" as a versionId value.
prdRouter.get("/projects/:projectId/prd/compare", compare);
prdRouter.get("/projects/:projectId/prd/:versionId", getById);
prdRouter.patch("/projects/:projectId/prd/:versionId", update);
prdRouter.post("/projects/:projectId/prd/:versionId/activate", activate);
