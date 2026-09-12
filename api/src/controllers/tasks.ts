import type { Request, Response } from "express";
import { parseWithSchema } from "../lib/validate.js";
import { AppError } from "../lib/errors.js";
import {
  compareQuerySchema,
  taskContentSchema,
  projectIdParamSchema,
  versionParamSchema,
} from "../schemas/tasks.js";
import * as tasksService from "../services/tasks.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw AppError.unauthenticated();
  }
  return req.user;
}

export async function generate(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const version = await tasksService.generateTasksFromActiveEpics(user.id, projectId);
  res.status(201).json({ data: { version } });
}

export async function list(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const versions = await tasksService.listVersions(user.id, projectId);
  res.status(200).json({ data: { versions } });
}

export async function getById(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId, versionId } = parseWithSchema(versionParamSchema, req.params);
  const version = await tasksService.getVersion(user.id, projectId, versionId);
  res.status(200).json({ data: { version } });
}

export async function update(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId, versionId } = parseWithSchema(versionParamSchema, req.params);
  const content = parseWithSchema(taskContentSchema, req.body);
  const version = await tasksService.updateVersion(user.id, projectId, versionId, content);
  res.status(200).json({ data: { version } });
}

export async function activate(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId, versionId } = parseWithSchema(versionParamSchema, req.params);
  const version = await tasksService.activateVersion(user.id, projectId, versionId);
  res.status(200).json({ data: { version } });
}

export async function compare(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const { a, b } = parseWithSchema(compareQuerySchema, req.query);
  const result = await tasksService.compareVersions(user.id, projectId, a, b);
  res.status(200).json({ data: result });
}
