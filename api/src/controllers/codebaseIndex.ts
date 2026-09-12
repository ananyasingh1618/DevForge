import type { Request, Response } from "express";
import { parseWithSchema } from "../lib/validate.js";
import { AppError } from "../lib/errors.js";
import { fileIdParamSchema, projectIdParamSchema } from "../schemas/codebaseIndex.js";
import * as codebaseIndexService from "../services/codebaseIndex.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw AppError.unauthenticated();
  }
  return req.user;
}

export async function start(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const index = await codebaseIndexService.startIndexing(user.id, projectId);
  res.status(200).json({ data: { index } });
}

export async function getIndex(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const index = await codebaseIndexService.getIndex(user.id, projectId);
  res.status(200).json({ data: { index } });
}

export async function listFiles(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const files = await codebaseIndexService.listFiles(user.id, projectId);
  res.status(200).json({ data: { files } });
}

export async function listSymbols(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId, fileId } = parseWithSchema(fileIdParamSchema, req.params);
  const symbols = await codebaseIndexService.listSymbols(user.id, projectId, fileId);
  res.status(200).json({ data: { symbols } });
}

export async function reindex(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const index = await codebaseIndexService.reindexRepository(user.id, projectId);
  res.status(200).json({ data: { index } });
}
