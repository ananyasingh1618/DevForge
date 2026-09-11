import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { create, getById, list } from "../controllers/projects.js";

export const projectsRouter = Router();

projectsRouter.use("/projects", requireAuth);
projectsRouter.post("/projects", create);
projectsRouter.get("/projects", list);
projectsRouter.get("/projects/:id", getById);
