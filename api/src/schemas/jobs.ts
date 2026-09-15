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

/** A generous ceiling well above any real job input (the largest today, a
 * review `scope` string, is already capped at 2,000 characters elsewhere)
 * — found missing during Milestone 15.7's own failure-injection review
 * ("a truly oversized job input has no explicit size limit") and closed
 * here rather than left as a documented gap, since it's a small, safe,
 * well-justified addition. */
const MAX_JOB_INPUT_BYTES = 32_000;

/** `input` is intentionally `z.record(z.unknown())` — its real shape
 * differs per job `type` and is validated a second time inside
 * jobWorker.ts's own `dispatch()` (e.g. a `qa` job's `question` must be a
 * non-empty string) — this schema only guarantees the caller sent a JSON
 * object, not arbitrary top-level JSON (a string/number/array), matching
 * every other JSON-body endpoint's own validation depth in this codebase. */
export const createJobBodySchema = z.object({
  type: z.enum(JOB_TYPES),
  input: z
    .record(z.string(), z.unknown())
    .default({})
    .refine((value) => Buffer.byteLength(JSON.stringify(value), "utf-8") <= MAX_JOB_INPUT_BYTES, {
      message: `Job input must not exceed ${MAX_JOB_INPUT_BYTES} bytes when serialized.`,
    }),
  idempotencyKey: z.string().min(1).max(200).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
});

export const listJobsQuerySchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  type: z.enum(JOB_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
