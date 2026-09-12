import type { Request, Response } from "express";
import { parseWithSchema } from "../lib/validate.js";
import { AppError } from "../lib/errors.js";
import {
  connectRepositorySchema,
  projectIdParamSchema,
  updateBranchSchema,
} from "../schemas/repository.js";
import * as repositoryService from "../services/repository.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw AppError.unauthenticated();
  }
  return req.user;
}

export async function connect(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const input = parseWithSchema(connectRepositorySchema, req.body);
  const connection = await repositoryService.connectRepository(user.id, projectId, input);
  res.status(200).json({ data: { connection } });
}

export async function getConnection(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const connection = await repositoryService.getConnection(user.id, projectId);
  res.status(200).json({ data: { connection } });
}

export async function verify(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const connection = await repositoryService.verifyAccess(user.id, projectId);
  res.status(200).json({ data: { connection } });
}

export async function listBranches(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const branches = await repositoryService.listBranches(user.id, projectId);
  res.status(200).json({ data: { branches } });
}

export async function updateBranch(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const { branch } = parseWithSchema(updateBranchSchema, req.body);
  const connection = await repositoryService.updateBranch(user.id, projectId, branch);
  res.status(200).json({ data: { connection } });
}

export async function disconnect(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  await repositoryService.disconnectRepository(user.id, projectId);
  res.status(204).send();
}
