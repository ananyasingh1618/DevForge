import type { Request, Response } from "express";
import { parseWithSchema } from "../lib/validate.js";
import { AppError } from "../lib/errors.js";
import { createProjectSchema, projectIdParamSchema } from "../schemas/projects.js";
import { createProject, getProjectForOwner, listProjectsForOwner } from "../services/projects.js";

function requireUser(req: Request) {
  // requireAuth runs before every handler in this controller, so req.user is
  // always populated here; this narrows the type without a redundant check.
  if (!req.user) {
    throw AppError.unauthenticated();
  }
  return req.user;
}

export async function create(req: Request, res: Response) {
  const user = requireUser(req);
  const input = parseWithSchema(createProjectSchema, req.body);
  const project = await createProject(user.id, input);
  res.status(201).json({ data: { project } });
}

export async function list(req: Request, res: Response) {
  const user = requireUser(req);
  const projects = await listProjectsForOwner(user.id);
  res.status(200).json({ data: { projects } });
}

export async function getById(req: Request, res: Response) {
  const user = requireUser(req);
  const { id } = parseWithSchema(projectIdParamSchema, req.params);
  const project = await getProjectForOwner(user.id, id);

  if (!project) {
    throw AppError.notFound("Project not found");
  }

  res.status(200).json({ data: { project } });
}
