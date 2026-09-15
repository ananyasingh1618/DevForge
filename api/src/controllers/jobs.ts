import type { Request, Response } from "express";
import { parseWithSchema } from "../lib/validate.js";
import { AppError } from "../lib/errors.js";
import { createJobBodySchema, jobIdParamSchema, listJobsQuerySchema, projectIdParamSchema } from "../schemas/jobs.js";
import * as jobsService from "../services/jobs.js";

function requireUser(req: Request) {
  if (!req.user) {
    throw AppError.unauthenticated();
  }
  return req.user;
}

/** Never returns `input`/`output` for a `qa`/`review` job type's raw
 * question/scope text verbatim beyond what the job itself already stores —
 * this is the same data the synchronous `/qa`/`/reviews` endpoints already
 * return today, not a new exposure. `errorMessage` is already a safe,
 * classified summary by construction (see jobWorker.ts's `classifyError()`)
 * — never a raw provider stack trace reaches this response. */
export async function create(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const body = parseWithSchema(createJobBodySchema, req.body);
  const job = await jobsService.createJob(user.id, projectId, body.type, body.input, {
    ...(body.idempotencyKey !== undefined ? { idempotencyKey: body.idempotencyKey } : {}),
    ...(body.maxRetries !== undefined ? { maxRetries: body.maxRetries } : {}),
  });
  res.status(201).json({ data: { job } });
}

export async function get(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId, jobId } = parseWithSchema(jobIdParamSchema, req.params);
  const job = await jobsService.getJob(user.id, projectId, jobId);
  res.status(200).json({ data: { job } });
}

export async function list(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId } = parseWithSchema(projectIdParamSchema, req.params);
  const query = parseWithSchema(listJobsQuerySchema, req.query);
  const jobs = await jobsService.listJobs(user.id, projectId, {
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.type !== undefined ? { type: query.type } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  });
  res.status(200).json({ data: { jobs } });
}

export async function cancel(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId, jobId } = parseWithSchema(jobIdParamSchema, req.params);
  const job = await jobsService.cancelJob(user.id, projectId, jobId);
  res.status(200).json({ data: { job } });
}

export async function retry(req: Request, res: Response) {
  const user = requireUser(req);
  const { projectId, jobId } = parseWithSchema(jobIdParamSchema, req.params);
  const job = await jobsService.retryJob(user.id, projectId, jobId);
  res.status(200).json({ data: { job } });
}
