import { randomUUID } from "node:crypto";
import { Prisma, type Job, type JobStatus, type JobType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";

/**
 * A durable, Postgres-native job queue (Phase 15 —
 * docs/PHASE_15_JOB_ARCHITECTURE_PLAN.md). This module owns every state
 * transition — nothing else in the codebase writes `Job.status` directly —
 * so the explicit transition table below is the single source of truth for
 * which transitions are valid. Every transition is a single conditional
 * `UPDATE ... WHERE id = $1 AND status IN (...)` so two concurrent callers
 * racing to transition the same job can never both succeed (one wins, the
 * other's `UPDATE` affects zero rows and gets a clear, safe error) — no
 * read-then-write race, no lost update.
 */

const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes — see renewLease()/recoverStaleJobs()
const DEFAULT_MAX_RETRIES = 3;

/** The one authoritative transition table. Every other function in this
 * module funnels through transitionJob(), which enforces this. */
const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled", "timed_out", "queued"],
  completed: [],
  failed: ["queued"],
  cancelled: [],
  timed_out: ["queued"],
};

export class InvalidJobTransitionError extends AppError {
  constructor(jobId: string, to: JobStatus) {
    super(409, "INVALID_JOB_TRANSITION", `Job ${jobId} cannot transition to "${to}" from its current state.`);
  }
}

async function requireOwnedProject(ownerId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId } });
  if (!project) {
    throw AppError.notFound("Project not found");
  }
  return project;
}

/** Loads a job scoped to an owned project — the same 404-for-both-"doesn't
 * exist"-and-"not yours" shape every other ownership check in this codebase
 * uses (see Phase 16's own audit of this exact pattern), so a caller can
 * never distinguish "no such job" from "someone else's job" through the
 * response. */
async function requireOwnedJob(ownerId: string, projectId: string, jobId: string): Promise<Job> {
  await requireOwnedProject(ownerId, projectId);
  const job = await prisma.job.findFirst({ where: { id: jobId, projectId } });
  if (!job) {
    throw AppError.notFound("Job not found");
  }
  return job;
}

/**
 * The one place `Job.status` is ever written from a known-current status.
 * `fromStatuses` must be a subset of `ALLOWED_TRANSITIONS`'s entry for
 * `to` — checked here defensively even though every call site below is
 * already correct, so a future call site mistake fails loudly instead of
 * silently allowing an invalid transition.
 */
async function transitionJob(
  jobId: string,
  fromStatuses: JobStatus[],
  to: JobStatus,
  data: Prisma.JobUpdateInput = {},
): Promise<Job> {
  for (const from of fromStatuses) {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new Error(`Programmer error: ${from} -> ${to} is not in ALLOWED_TRANSITIONS`);
    }
  }
  const result = await prisma.job.updateMany({
    where: { id: jobId, status: { in: fromStatuses } },
    data: { ...data, status: to },
  });
  if (result.count === 0) {
    throw new InvalidJobTransitionError(jobId, to);
  }
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    throw AppError.notFound("Job not found");
  }
  return job;
}

/**
 * Creates a new job, or — when `idempotencyKey` is supplied and a job
 * already exists for this exact `(projectId, type, idempotencyKey)` —
 * returns the existing job unchanged instead of creating a duplicate. A
 * caller that retries an HTTP request (e.g. after a network blip) is safe
 * to call this again with the same key.
 */
export async function createJob(
  ownerId: string,
  projectId: string,
  type: JobType,
  input: unknown,
  options: { idempotencyKey?: string; maxRetries?: number } = {},
): Promise<Job> {
  await requireOwnedProject(ownerId, projectId);

  if (options.idempotencyKey) {
    const existing = await prisma.job.findUnique({
      where: { projectId_type_idempotencyKey: { projectId, type, idempotencyKey: options.idempotencyKey } },
    });
    if (existing) return existing;
  }

  return prisma.job.create({
    data: {
      id: randomUUID(),
      projectId,
      type,
      input: input as Prisma.InputJsonValue,
      idempotencyKey: options.idempotencyKey ?? null,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      correlationId: randomUUID(),
    },
  });
}

export async function getJob(ownerId: string, projectId: string, jobId: string): Promise<Job> {
  return requireOwnedJob(ownerId, projectId, jobId);
}

export async function listJobs(
  ownerId: string,
  projectId: string,
  options: { limit?: number; status?: JobStatus; type?: JobType } = {},
): Promise<Job[]> {
  await requireOwnedProject(ownerId, projectId);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  return prisma.job.findMany({
    where: {
      projectId,
      ...(options.status !== undefined ? { status: options.status } : {}),
      ...(options.type !== undefined ? { type: options.type } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Requests cancellation. A `queued` job (never started) is cancelled
 * immediately. A `running` job cannot be forcibly killed from an HTTP
 * request handler — this only sets `cancelRequested`; the worker itself
 * checks the flag at safe points (see worker.ts) and transitions to
 * `cancelled` cooperatively. Any other status is a terminal state a cancel
 * request cannot apply to.
 */
export async function cancelJob(ownerId: string, projectId: string, jobId: string): Promise<Job> {
  const job = await requireOwnedJob(ownerId, projectId, jobId);
  if (job.status === "queued") {
    return transitionJob(jobId, ["queued"], "cancelled", { cancelledAt: new Date() });
  }
  if (job.status === "running") {
    const result = await prisma.job.updateMany({
      where: { id: jobId, status: "running" },
      data: { cancelRequested: true },
    });
    if (result.count === 0) {
      throw new InvalidJobTransitionError(jobId, "cancelled");
    }
    const updated = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    return updated;
  }
  throw new InvalidJobTransitionError(jobId, "cancelled");
}

/**
 * Manually retries a job that ended in `failed` or `timed_out` — resets it
 * to `queued` with `retryCount` incremented and every error/lease field
 * cleared, so it looks exactly like a fresh attempt to the worker. Bounded
 * by the same `maxRetries` automatic retries respect — a job whose
 * `retryCount` already reached `maxRetries` cannot be retried again
 * (returns a clear, real error, not a silent no-op).
 */
export async function retryJob(ownerId: string, projectId: string, jobId: string): Promise<Job> {
  const job = await requireOwnedJob(ownerId, projectId, jobId);
  if (job.status !== "failed" && job.status !== "timed_out") {
    throw new InvalidJobTransitionError(jobId, "queued");
  }
  if (job.retryCount >= job.maxRetries) {
    throw new AppError(409, "RETRY_LIMIT_EXCEEDED", `Job ${jobId} has exhausted its ${job.maxRetries} retries.`);
  }
  return transitionJob(jobId, [job.status], "queued", {
    retryCount: { increment: 1 },
    errorCode: null,
    errorMessage: null,
    workerId: null,
    leaseExpiresAt: null,
    cancelRequested: false,
    startedAt: null,
    completedAt: null,
  });
}

// --- Worker-side operations (not ownership-checked — the worker acts on
// behalf of the system, not a specific end user's HTTP request). ---

/**
 * Atomically claims the oldest queued job for a worker, using
 * `SELECT ... FOR UPDATE SKIP LOCKED` so concurrent workers never claim the
 * same row — the core safety property that makes "a job is not executed
 * twice accidentally" true under multiple worker processes. Returns null
 * when there is no queued work.
 */
export async function claimNextJob(workerId: string): Promise<Job | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const claimed = rows[0];
    if (!claimed) return null;

    const leaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS);
    const updated = await tx.job.update({
      where: { id: claimed.id },
      data: { status: "running", workerId, leaseExpiresAt, startedAt: new Date() },
    });
    return updated;
  });
}

/** Renews a running job's lease (a heartbeat) — call periodically during a
 * long-running job so `recoverStaleJobs()` doesn't mistake live work for a
 * crashed worker. */
export async function renewLease(jobId: string): Promise<void> {
  await prisma.job.updateMany({
    where: { id: jobId, status: "running" },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS) },
  });
}

/** True when the worker should stop this job at its next safe checkpoint. */
export async function isCancellationRequested(jobId: string): Promise<boolean> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { cancelRequested: true } });
  return job?.cancelRequested ?? false;
}

export async function completeJob(jobId: string, output: unknown): Promise<Job> {
  return transitionJob(jobId, ["running"], "completed", {
    output: output as Prisma.InputJsonValue,
    completedAt: new Date(),
  });
}

/** A cooperative-cancellation checkpoint hit mid-job. */
export async function markCancelled(jobId: string): Promise<Job> {
  return transitionJob(jobId, ["running"], "cancelled", { cancelledAt: new Date() });
}

export type JobErrorClass = "transient" | "permanent";

/**
 * Fails a job, retrying automatically (back to `queued`, bounded by
 * `maxRetries`) when the classified error is transient and retries remain,
 * or moving to the terminal `failed` state otherwise. `errorMessage` is
 * caller-supplied and must already be a safe, non-secret summary — this
 * function never receives or logs a raw stack trace itself.
 */
export async function failJob(
  jobId: string,
  errorClass: JobErrorClass,
  errorCode: string,
  errorMessage: string,
): Promise<Job> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  const canRetry = errorClass === "transient" && job.retryCount + 1 < job.maxRetries;
  if (canRetry) {
    return transitionJob(jobId, ["running"], "queued", {
      retryCount: { increment: 1 },
      errorCode,
      errorMessage,
      workerId: null,
      leaseExpiresAt: null,
    });
  }
  return transitionJob(jobId, ["running"], "failed", { errorCode, errorMessage, completedAt: new Date() });
}

export async function timeoutJob(jobId: string): Promise<Job> {
  return transitionJob(jobId, ["running"], "timed_out", {
    errorCode: "JOB_TIMEOUT",
    errorMessage: "The job exceeded its maximum allowed running time.",
    completedAt: new Date(),
  });
}

/**
 * Recovers jobs abandoned by a crashed/killed worker: any `running` job
 * whose lease has expired is either requeued (bounded by `maxRetries`) or
 * moved to `failed`. Safe to call repeatedly and from multiple processes —
 * each recovered job goes through the same conditional-UPDATE transition
 * as every other state change, so a job already recovered by a concurrent
 * caller is simply skipped (zero rows affected), not double-processed.
 */
export async function recoverStaleJobs(): Promise<{ requeued: number; failed: number }> {
  const stale = await prisma.job.findMany({
    where: { status: "running", leaseExpiresAt: { lt: new Date() } },
  });
  let requeued = 0;
  let failedCount = 0;
  for (const job of stale) {
    const canRetry = job.retryCount + 1 < job.maxRetries;
    try {
      if (canRetry) {
        await transitionJob(job.id, ["running"], "queued", {
          retryCount: { increment: 1 },
          errorCode: "WORKER_LEASE_EXPIRED",
          errorMessage: "The worker holding this job's lease stopped renewing it (likely a crash or restart).",
          workerId: null,
          leaseExpiresAt: null,
        });
        requeued++;
      } else {
        await transitionJob(job.id, ["running"], "failed", {
          errorCode: "WORKER_LEASE_EXPIRED",
          errorMessage: "The worker holding this job's lease stopped renewing it, and retries are exhausted.",
          completedAt: new Date(),
        });
        failedCount++;
      }
    } catch {
      // Already recovered by a concurrent caller — the conditional UPDATE
      // affected zero rows and threw InvalidJobTransitionError; safe to skip.
    }
  }
  return { requeued, failed: failedCount };
}

export async function updateProgress(jobId: string, progress: unknown): Promise<void> {
  await prisma.job.updateMany({
    where: { id: jobId, status: "running" },
    data: { progress: progress as Prisma.InputJsonValue },
  });
}
