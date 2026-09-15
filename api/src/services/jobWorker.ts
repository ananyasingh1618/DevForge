import { AppError } from "../lib/errors.js";
import * as jobs from "./jobs.js";
import * as codebaseIndexService from "./codebaseIndex.js";
import * as qaService from "./qa.js";
import * as codeReviewService from "./codeReview.js";
import { prisma } from "../lib/prisma.js";
import type { Job, JobType } from "@prisma/client";

/**
 * The job worker (Phase 15, Milestone 15.3 —
 * docs/PHASE_15_JOB_ARCHITECTURE_PLAN.md). A small polling loop that claims
 * queued jobs and dispatches them to the exact same, already-tested
 * synchronous service functions every existing route already calls
 * (`startIndexing`/`reindexRepository`, `askQuestion`, `createReview`) —
 * the job system is a thin, durable wrapper around real, existing
 * operations, never a new code-execution capability. `evaluation` jobs are
 * deliberately **not** dispatched (see `UNSUPPORTED_JOB_TYPES` below):
 * automatically invoking the separate `evaluation/` package's CLI from a
 * worker would mean the API triggering an external process in response to
 * a request, which this phase's own "do not add code execution" rule rules
 * out — evaluation runs remain a manually-invoked `pnpm eval`, exactly as
 * every prior phase established.
 */

const JOB_TIMEOUT_MS = 4 * 60 * 1000; // shorter than jobs.ts's own 5-minute lease
const POLL_INTERVAL_MS = 1000;
const STALE_JOB_SWEEP_INTERVAL_MS = 60 * 1000;
const LEASE_RENEWAL_INTERVAL_MS = 60 * 1000;

/** Job types this worker can actually execute. `evaluation` is a real,
 * schema-supported job type (for future use / manual bookkeeping) but is
 * never auto-dispatched — see this file's own header comment. */
const UNSUPPORTED_JOB_TYPES = new Set<JobType>(["evaluation"]);

/**
 * Maps a thrown error to a retry classification and a safe, non-secret
 * error code/message — never a raw stack trace or provider response body.
 * 5xx/network-shaped failures are transient (worth an automatic retry);
 * 4xx failures (validation, not-found, unauthorized, conflict) are
 * permanent — retrying the exact same input against the exact same state
 * cannot succeed. **429 (rate limited)** is the one 4xx status treated as
 * transient — found via a dedicated failure-injection test (Milestone
 * 15.7) that a naive ">= 500 is transient" rule would otherwise wrongly
 * fail a rate-limited request permanently, when retrying (ideally after a
 * backoff, which the automatic-retry's own requeue-to-`queued` naturally
 * provides since the job waits for the next worker poll rather than
 * retrying instantly) is exactly the correct response to a 429. An
 * unrecognized (non-`AppError`) exception is treated as transient but
 * still bounded by the job's own `maxRetries` — never an infinite retry
 * loop.
 */
const TRANSIENT_STATUSES = new Set([429]);

function classifyError(err: unknown): { errorClass: jobs.JobErrorClass; errorCode: string; errorMessage: string } {
  if (err instanceof AppError) {
    const errorClass: jobs.JobErrorClass = err.status >= 500 || TRANSIENT_STATUSES.has(err.status) ? "transient" : "permanent";
    return { errorClass, errorCode: err.code, errorMessage: err.message };
  }
  return {
    errorClass: "transient",
    errorCode: "UNKNOWN_ERROR",
    errorMessage: "An unexpected internal error occurred while running this job.",
  };
}

type JobInput = Record<string, unknown>;

async function dispatch(job: Job): Promise<unknown> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: job.projectId } });
  const ownerId = project.ownerId;
  const input = (job.input ?? {}) as JobInput;

  switch (job.type) {
    case "indexing": {
      const force = input["force"] === true;
      return force
        ? codebaseIndexService.reindexRepository(ownerId, job.projectId)
        : codebaseIndexService.startIndexing(ownerId, job.projectId);
    }
    case "qa": {
      const question = typeof input["question"] === "string" ? input["question"] : "";
      if (!question) throw AppError.badRequest("Job input is missing a required 'question' string.");
      return qaService.askQuestion(ownerId, job.projectId, question);
    }
    case "review": {
      const scope = typeof input["scope"] === "string" ? input["scope"] : undefined;
      return codeReviewService.createReview(ownerId, job.projectId, scope);
    }
    case "evaluation":
      throw new AppError(
        501,
        "JOB_TYPE_NOT_DISPATCHABLE",
        "Evaluation jobs are not auto-executed by the worker — run `pnpm eval` directly.",
      );
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("__JOB_TIMEOUT__")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err as Error);
      },
    );
  });
}

/** Runs exactly one claimed job to completion (success, failure, timeout,
 * or cooperative cancellation) and persists the outcome. Exported
 * separately from the polling loop so tests can drive a single job's
 * execution deterministically without needing a running interval timer. */
export async function runOneClaimedJob(job: Job, timeoutMs: number = JOB_TIMEOUT_MS): Promise<void> {
  if (UNSUPPORTED_JOB_TYPES.has(job.type)) {
    await jobs.failJob(job.id, "permanent", "JOB_TYPE_NOT_DISPATCHABLE", "This job type is not auto-executed by the worker.");
    return;
  }

  // Cooperative-cancellation checkpoint: a job cancelled between being
  // queued and being claimed (or cancelled an instant after claim) should
  // not still run its real work. True mid-operation cancellation of the
  // single synchronous service call below is a known, documented
  // limitation — see docs/PHASE_15_JOB_ARCHITECTURE_PROGRESS.md's
  // Milestone 15.3 entry.
  if (await jobs.isCancellationRequested(job.id)) {
    await jobs.markCancelled(job.id);
    return;
  }

  const leaseTimer = setInterval(() => {
    jobs.renewLease(job.id).catch(() => {
      // Best-effort — if this fails repeatedly the lease will eventually
      // expire and recoverStaleJobs() reclaims the job, which is the
      // correct, safe fallback.
    });
  }, LEASE_RENEWAL_INTERVAL_MS);

  try {
    const output = await withTimeout(dispatch(job), timeoutMs);
    if (await jobs.isCancellationRequested(job.id)) {
      await jobs.markCancelled(job.id);
      return;
    }
    await jobs.completeJob(job.id, output);
  } catch (err) {
    if (err instanceof Error && err.message === "__JOB_TIMEOUT__") {
      await jobs.timeoutJob(job.id);
      return;
    }
    const { errorClass, errorCode, errorMessage } = classifyError(err);
    await jobs.failJob(job.id, errorClass, errorCode, errorMessage);
  } finally {
    clearInterval(leaseTimer);
  }
}

export type WorkerHandle = { stop: () => Promise<void> };

/**
 * Starts the polling loop: repeatedly claims and runs jobs until stopped.
 * `stop()` waits for any in-flight job to finish before resolving — a
 * graceful shutdown, not an abrupt kill that could leave a job's own
 * output half-written.
 */
export function startWorker(workerId: string): WorkerHandle {
  let stopped = false;
  let currentJob: Promise<void> = Promise.resolve();

  const pollTimer = setInterval(() => {
    if (stopped) return;
    currentJob = currentJob
      .then(() => jobs.claimNextJob(workerId))
      .then((job) => (job ? runOneClaimedJob(job) : undefined))
      .catch(() => {
        // A claim/dispatch-level failure (e.g. a transient DB blip) should
        // never crash the worker loop — the next poll tries again.
      });
  }, POLL_INTERVAL_MS);

  const sweepTimer = setInterval(() => {
    if (stopped) return;
    jobs.recoverStaleJobs().catch(() => {});
  }, STALE_JOB_SWEEP_INTERVAL_MS);

  return {
    stop: async () => {
      stopped = true;
      clearInterval(pollTimer);
      clearInterval(sweepTimer);
      await currentJob;
    },
  };
}
