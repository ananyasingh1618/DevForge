import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireProjectOwnership } from "../middleware/requireProjectOwnership.js";
import {
  connect,
  disconnect,
  getConnection,
  listBranches,
  updateBranch,
  verify,
} from "../controllers/repository.js";

export const repositoryRouter = Router();

repositoryRouter.use("/projects/:projectId/repository", requireAuth, requireProjectOwnership);

repositoryRouter.post("/projects/:projectId/repository/connect", connect);
repositoryRouter.get("/projects/:projectId/repository", getConnection);
repositoryRouter.post("/projects/:projectId/repository/verify", verify);
repositoryRouter.get("/projects/:projectId/repository/branches", listBranches);
repositoryRouter.patch("/projects/:projectId/repository", updateBranch);
repositoryRouter.delete("/projects/:projectId/repository", disconnect);
