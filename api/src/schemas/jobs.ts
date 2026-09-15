import { z } from "zod";

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const jobIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
  jobId: z.string().uuid("Invalid job id"),
});

const JOB_TYPES = ["indexing", "qa", "review", "evaluation"] as const;
const JOB_STATUSES = ["queued", "running", "completed", "failed", "cancelled", "timed_out"] as const;

/** `input` is intentionally `z.record(z.unknown())` — its real shape
 * differs per job `type` and is validated a second time inside
 * jobWorker.ts's own `dispatch()` (e.g. a `qa` job's `question` must be a
 * non-empty string) — this schema only guarantees the caller sent a JSON
 * object, not arbitrary top-level JSON (a string/number/array), matching
 * every other JSON-body endpoint's own validation depth in this codebase. */
export const createJobBodySchema = z.object({
  type: z.enum(JOB_TYPES),
  input: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().min(1).max(200).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
});

export const listJobsQuerySchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  type: z.enum(JOB_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
