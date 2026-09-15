import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireProjectOwnership } from "../middleware/requireProjectOwnership.js";
import { create, getOne, list } from "../controllers/codeReview.js";

export const codeReviewRouter = Router();

codeReviewRouter.use("/projects/:projectId/reviews", requireAuth, requireProjectOwnership);

codeReviewRouter.post("/projects/:projectId/reviews", create);
codeReviewRouter.get("/projects/:projectId/reviews", list);
codeReviewRouter.get("/projects/:projectId/reviews/:reviewId", getOne);
