import type { Request, Response } from "express";
import { parseWithSchema } from "../lib/validate.js";
import { AppError } from "../lib/errors.js";
import { createReviewSchema, projectIdParamSchema, reviewIdParamSchema } from "../schemas/codeReview.js";
import * as codeReviewService from "../services/codeReview.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw AppError.unauthenticated();
  }
  return req.user;
}

export async function create(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const { scope } = parseWithSchema(createReviewSchema, req.body);
  const result = await codeReviewService.createReview(user.id, projectId, scope);
  res.status(201).json({ data: result });
}

export async function list(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const reviews = await codeReviewService.listReviews(user.id, projectId);
  res.status(200).json({ data: { reviews } });
}

export async function getOne(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId, reviewId } = parseWithSchema(reviewIdParamSchema, req.params);
  const result = await codeReviewService.getReview(user.id, projectId, reviewId);
  res.status(200).json({ data: result });
}
