import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { search } from "../controllers/retrieval.js";

export const retrievalRouter = Router();

retrievalRouter.use("/projects/:projectId/search", requireAuth);

retrievalRouter.post("/projects/:projectId/search", search);
