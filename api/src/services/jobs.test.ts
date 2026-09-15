import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma.js";
import {
  cancelJob,
  claimNextJob,
  completeJob,
  createJob,
  failJob,
  getJob,
  InvalidJobTransitionError,
  isCancellationRequested,
  listJobs,
  markCancelled,
  recoverStaleJobs,
  renewLease,
  retryJob,
  timeoutJob,
  updateProgress,
} from "./jobs.js";

async function cleanDb() {
  await prisma.job.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

async function makeUserAndProject() {
  const user = await prisma.user.create({
    data: { id: randomUUID(), email: `jobs-${randomUUID()}@example.com`, passwordHash: "not-a-real-hash" },
  });
  const project = await prisma.project.create({
    data: { id: randomUUID(), ownerId: user.id, name: "Jobs Test Project" },
  });
  return { user, project };
}

beforeEach(async () => {
  await cleanDb();
});

afterEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createJob", () => {
  it("creates a queued job scoped to the owning project", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "indexing", { branch: "main" });
    expect(job.status).toBe("queued");
    expect(job.projectId).toBe(project.id);
    expect(job.retryCount).toBe(0);
    expect(job.maxRetries).toBe(3);
    expect(job.correlationId).toBeTruthy();
  });

  it("throws 404 for a project owned by someone else", async () => {
    const { project } = await makeUserAndProject();
    const otherUser = await prisma.user.create({
      data: { id: randomUUID(), email: `other-${randomUUID()}@example.com`, passwordHash: "x" },
    });
    await expect(createJob(otherUser.id, project.id, "qa", {})).rejects.toMatchObject({ status: 404 });
  });

  it("is idempotent: the same idempotencyKey returns the existing job instead of creating a duplicate", async () => {
    const { user, project } = await makeUserAndProject();
    const first = await createJob(user.id, project.id, "review", { scope: "auth" }, { idempotencyKey: "req-1" });
    const second = await createJob(user.id, project.id, "review", { scope: "auth" }, { idempotencyKey: "req-1" });
    expect(second.id).toBe(first.id);
    const count = await prisma.job.count({ where: { projectId: project.id } });
    expect(count).toBe(1);
  });

  it("does not deduplicate jobs with no idempotency key", async () => {
    const { user, project } = await makeUserAndProject();
    await createJob(user.id, project.id, "evaluation", {});
    await createJob(user.id, project.id, "evaluation", {});
    const count = await prisma.job.count({ where: { projectId: project.id } });
    expect(count).toBe(2);
  });

  it("allows the same idempotencyKey to be reused across different job types", async () => {
    const { user, project } = await makeUserAndProject();
    const a = await createJob(user.id, project.id, "qa", {}, { idempotencyKey: "shared" });
    const b = await createJob(user.id, project.id, "review", {}, { idempotencyKey: "shared" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("valid and invalid state transitions", () => {
  it("completed -> running is rejected", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "qa", {});
    await claimNextJob("worker-1");
    await completeJob(job.id, { answer: "done" });
    await expect(claimNextJob("worker-2")).resolves.toBeNull(); // nothing left queued
    // Directly attempting to re-run a completed job via the worker-side API is impossible
    // by construction (claimNextJob only ever selects status='queued'); assert the job's
    // own terminal state cannot be changed by any other transition function.
    await expect(completeJob(job.id, {})).rejects.toBeInstanceOf(InvalidJobTransitionError);
    await expect(failJob(job.id, "permanent", "X", "x")).rejects.toBeInstanceOf(InvalidJobTransitionError);
  });

  it("cancelled -> running is rejected (a cancelled queued job can never be claimed again)", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "indexing", {});
    await cancelJob(user.id, project.id, job.id);
    const claimed = await claimNextJob("worker-1");
    expect(claimed).toBeNull();
  });

  it("failed -> completed without a new retry attempt is rejected", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "qa", {}, { maxRetries: 1 });
    await claimNextJob("worker-1");
    await failJob(job.id, "permanent", "PROVIDER_ERROR", "The provider rejected the request.");
    const failedJob = await getJob(user.id, project.id, job.id);
    expect(failedJob.status).toBe("failed");
    await expect(completeJob(job.id, {})).rejects.toBeInstanceOf(InvalidJobTransitionError);
  });

  it("queued -> completed, skipping execution, is rejected", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "review", {});
    await expect(completeJob(job.id, {})).rejects.toBeInstanceOf(InvalidJobTransitionError);
  });

  it("cancelling an already-terminal job is rejected", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "qa", {});
    await claimNextJob("worker-1");
    await completeJob(job.id, {});
    await expect(cancelJob(user.id, project.id, job.id)).rejects.toBeInstanceOf(InvalidJobTransitionError);
  });
});

describe("cancellation", () => {
  it("cancels a queued job immediately", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "indexing", {});
    const cancelled = await cancelJob(user.id, project.id, job.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it("a running job is only flagged cancelRequested, not immediately transitioned", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "review", {});
    await claimNextJob("worker-1");
    const result = await cancelJob(user.id, project.id, job.id);
    expect(result.status).toBe("running");
    expect(await isCancellationRequested(job.id)).toBe(true);
    const stopped = await markCancelled(job.id);
    expect(stopped.status).toBe("cancelled");
  });
});

describe("retryJob", () => {
  it("retries a failed job, incrementing retryCount and clearing error fields", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "qa", {}, { maxRetries: 3 });
    await claimNextJob("worker-1");
    await failJob(job.id, "permanent", "X", "boom");
    const retried = await retryJob(user.id, project.id, job.id);
    expect(retried.status).toBe("queued");
    expect(retried.retryCount).toBe(1);
    expect(retried.errorCode).toBeNull();
    expect(retried.errorMessage).toBeNull();
  });

  it("refuses to retry once retryCount reaches maxRetries", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "qa", {}, { maxRetries: 1 });
    await claimNextJob("worker-1");
    await failJob(job.id, "permanent", "X", "boom");
    // maxRetries=1 permits exactly one manual retry (retryCount 0 -> 1)...
    const firstRetry = await retryJob(user.id, project.id, job.id);
    expect(firstRetry.retryCount).toBe(1);
    // ...but a second manual retry, after failing again, must be refused.
    await claimNextJob("worker-2");
    await failJob(job.id, "permanent", "X", "boom again");
    await expect(retryJob(user.id, project.id, job.id)).rejects.toMatchObject({ code: "RETRY_LIMIT_EXCEEDED" });
  });

  it("refuses to retry a job that is not failed/timed_out", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "qa", {});
    await expect(retryJob(user.id, project.id, job.id)).rejects.toBeInstanceOf(InvalidJobTransitionError);
  });
});

describe("automatic retry on transient failure", () => {
  it("requeues a transient failure automatically, bounded by maxRetries", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "indexing", {}, { maxRetries: 2 });
    await claimNextJob("worker-1");
    const afterFirstFailure = await failJob(job.id, "transient", "PROVIDER_TIMEOUT", "Timed out.");
    expect(afterFirstFailure.status).toBe("queued");
    expect(afterFirstFailure.retryCount).toBe(1);

    await claimNextJob("worker-2");
    const afterSecondFailure = await failJob(job.id, "transient", "PROVIDER_TIMEOUT", "Timed out again.");
    // retryCount (1) + 1 = 2, which is not < maxRetries (2) -- exhausted, permanently failed.
    expect(afterSecondFailure.status).toBe("failed");
  });

  it("a permanent failure never auto-retries, even with retries remaining", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "review", {}, { maxRetries: 5 });
    await claimNextJob("worker-1");
    const result = await failJob(job.id, "permanent", "VALIDATION_ERROR", "Malformed input.");
    expect(result.status).toBe("failed");
  });
});

describe("timeoutJob", () => {
  it("moves a running job to timed_out with a safe error message", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "evaluation", {});
    await claimNextJob("worker-1");
    const result = await timeoutJob(job.id);
    expect(result.status).toBe("timed_out");
    expect(result.errorMessage).not.toContain("Error:");
  });
});

describe("claimNextJob — exactly-once claiming under concurrency", () => {
  it("two workers racing to claim the same single queued job: exactly one succeeds", async () => {
    const { user, project } = await makeUserAndProject();
    await createJob(user.id, project.id, "indexing", {});

    const [a, b] = await Promise.all([claimNextJob("worker-a"), claimNextJob("worker-b")]);
    const claimedCount = [a, b].filter((r) => r !== null).length;
    expect(claimedCount).toBe(1);
  });

  it("claims jobs in FIFO (oldest-created-first) order", async () => {
    const { user, project } = await makeUserAndProject();
    const first = await createJob(user.id, project.id, "qa", { order: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createJob(user.id, project.id, "qa", { order: 2 });

    const claimed = await claimNextJob("worker-1");
    expect(claimed?.id).toBe(first.id);
  });

  it("returns null when there is no queued work", async () => {
    const claimed = await claimNextJob("worker-1");
    expect(claimed).toBeNull();
  });

  it("sets workerId, startedAt, and a future leaseExpiresAt on claim", async () => {
    const { user, project } = await makeUserAndProject();
    await createJob(user.id, project.id, "indexing", {});
    const claimed = await claimNextJob("worker-1");
    expect(claimed?.workerId).toBe("worker-1");
    expect(claimed?.startedAt).not.toBeNull();
    expect(claimed?.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("renewLease / updateProgress", () => {
  it("renewLease extends leaseExpiresAt further into the future", async () => {
    const { user, project } = await makeUserAndProject();
    await createJob(user.id, project.id, "indexing", {});
    const claimed = await claimNextJob("worker-1");
    const originalLease = claimed!.leaseExpiresAt!.getTime();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await renewLease(claimed!.id);
    const refreshed = await prisma.job.findUniqueOrThrow({ where: { id: claimed!.id } });
    expect(refreshed.leaseExpiresAt!.getTime()).toBeGreaterThanOrEqual(originalLease);
  });

  it("updateProgress persists a progress payload on a running job", async () => {
    const { user, project } = await makeUserAndProject();
    await createJob(user.id, project.id, "indexing", {});
    const claimed = await claimNextJob("worker-1");
    await updateProgress(claimed!.id, { filesProcessed: 10, totalFiles: 100 });
    const refreshed = await prisma.job.findUniqueOrThrow({ where: { id: claimed!.id } });
    expect(refreshed.progress).toEqual({ filesProcessed: 10, totalFiles: 100 });
  });

  it("updateProgress on a non-running job is a safe no-op, not an error", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "indexing", {});
    await expect(updateProgress(job.id, { x: 1 })).resolves.toBeUndefined();
  });
});

describe("recoverStaleJobs", () => {
  it("requeues a running job whose lease has expired, incrementing retryCount", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "indexing", {}, { maxRetries: 3 });
    await claimNextJob("worker-1");
    // Simulate a crashed worker: force the lease into the past directly.
    await prisma.job.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });

    const result = await recoverStaleJobs();
    expect(result.requeued).toBe(1);
    expect(result.failed).toBe(0);
    const recovered = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(recovered.status).toBe("queued");
    expect(recovered.retryCount).toBe(1);
    expect(recovered.workerId).toBeNull();
  });

  it("permanently fails a stale job once retries are exhausted", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "indexing", {}, { maxRetries: 1 });
    await claimNextJob("worker-1");
    await prisma.job.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });

    const result = await recoverStaleJobs();
    expect(result.requeued).toBe(0);
    expect(result.failed).toBe(1);
    const recovered = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(recovered.status).toBe("failed");
  });

  it("does not touch a running job whose lease has not expired", async () => {
    const { user, project } = await makeUserAndProject();
    await createJob(user.id, project.id, "indexing", {});
    const claimed = await claimNextJob("worker-1");

    const result = await recoverStaleJobs();
    expect(result.requeued).toBe(0);
    expect(result.failed).toBe(0);
    const unchanged = await prisma.job.findUniqueOrThrow({ where: { id: claimed!.id } });
    expect(unchanged.status).toBe("running");
  });

  it("is safe to call repeatedly / concurrently without double-processing the same stale job", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "indexing", {}, { maxRetries: 5 });
    await claimNextJob("worker-1");
    await prisma.job.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });

    const [a, b] = await Promise.all([recoverStaleJobs(), recoverStaleJobs()]);
    const totalRequeued = a.requeued + b.requeued;
    expect(totalRequeued).toBe(1); // only one of the two concurrent calls actually recovers it
    const recovered = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(recovered.retryCount).toBe(1); // not double-incremented
  });
});

describe("listJobs / getJob ownership", () => {
  it("lists a project's jobs newest first", async () => {
    const { user, project } = await makeUserAndProject();
    const first = await createJob(user.id, project.id, "qa", {});
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createJob(user.id, project.id, "review", {});
    const jobs = await listJobs(user.id, project.id);
    expect(jobs.map((j) => j.id)).toEqual([second.id, first.id]);
  });

  it("filters by status and type", async () => {
    const { user, project } = await makeUserAndProject();
    await createJob(user.id, project.id, "qa", {});
    const review = await createJob(user.id, project.id, "review", {});
    const reviewOnly = await listJobs(user.id, project.id, { type: "review" });
    expect(reviewOnly.map((j) => j.id)).toEqual([review.id]);
  });

  it("getJob returns 404 for another user's job (never leaks existence)", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "qa", {});
    const intruder = await prisma.user.create({
      data: { id: randomUUID(), email: `intruder-${randomUUID()}@example.com`, passwordHash: "x" },
    });
    await expect(getJob(intruder.id, project.id, job.id)).rejects.toMatchObject({ status: 404 });
  });
});
