import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireProjectOwnership } from "../middleware/requireProjectOwnership.js";
import { getIndex, listFiles, listSymbols, reindex, start } from "../controllers/codebaseIndex.js";

export const codebaseIndexRouter = Router();

codebaseIndexRouter.use("/projects/:projectId/codebase-index", requireAuth, requireProjectOwnership);

codebaseIndexRouter.post("/projects/:projectId/codebase-index/start", start);
codebaseIndexRouter.get("/projects/:projectId/codebase-index", getIndex);
codebaseIndexRouter.get("/projects/:projectId/codebase-index/files", listFiles);
codebaseIndexRouter.get("/projects/:projectId/codebase-index/files/:fileId/symbols", listSymbols);
codebaseIndexRouter.post("/projects/:projectId/codebase-index/reindex", reindex);
