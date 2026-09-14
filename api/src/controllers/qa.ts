import type { Request, Response } from "express";
import { parseWithSchema } from "../lib/validate.js";
import { AppError } from "../lib/errors.js";
import { askQuestionSchema, projectIdParamSchema, questionParamSchema } from "../schemas/qa.js";
import * as qaService from "../services/qa.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw AppError.unauthenticated();
  }
  return req.user;
}

export async function ask(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const { question } = parseWithSchema(askQuestionSchema, req.body);
  const result = await qaService.askQuestion(user.id, projectId, question);
  res.status(200).json({ data: result });
}

export async function list(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const questions = await qaService.listQuestions(user.id, projectId);
  res.status(200).json({ data: { questions } });
}

export async function getOne(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId, questionId } = parseWithSchema(questionParamSchema, req.params);
  const result = await qaService.getQuestion(user.id, projectId, questionId);
  res.status(200).json({ data: result });
}
