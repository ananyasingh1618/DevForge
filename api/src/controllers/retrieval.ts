import type { Request, Response } from "express";
import { parseWithSchema } from "../lib/validate.js";
import { AppError } from "../lib/errors.js";
import { projectIdParamSchema, searchRequestSchema } from "../schemas/retrieval.js";
import * as retrievalService from "../services/retrieval.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw AppError.unauthenticated();
  }
  return req.user;
}

export async function search(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const input = parseWithSchema(searchRequestSchema, req.body);
  const results = await retrievalService.search(user.id, projectId, input);
  res.status(200).json({ data: { results } });
}
