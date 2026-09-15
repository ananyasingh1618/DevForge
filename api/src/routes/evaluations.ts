import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { getOne, list } from "../controllers/evaluations.js";

export const evaluationsRouter = Router();

evaluationsRouter.use("/evaluations", requireAuth);

evaluationsRouter.get("/evaluations", list);
evaluationsRouter.get("/evaluations/:runId", getOne);
