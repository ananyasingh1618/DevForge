import type { Request, Response } from "express";
import { parseWithSchema } from "../lib/validate.js";
import { AppError } from "../lib/errors.js";
import { evaluationRunIdParamSchema } from "../schemas/evaluations.js";
import * as evaluationsService from "../services/evaluations.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw AppError.unauthenticated();
  }
  return req.user;
}

export async function list(req: Request, res: Response) {
  requireUser(req);
  const runs = await evaluationsService.listEvaluationRuns();
  res.status(200).json({ data: { runs } });
}

export async function getOne(req: Request, res: Response) {
  requireUser(req);
  const { runId } = parseWithSchema(evaluationRunIdParamSchema, req.params);
  const run = await evaluationsService.getEvaluationRun(runId);
  res.status(200).json({ data: run });
}
