import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { claimNextJob, createJob, getJob, isCancellationRequested } from "./jobs.js";

// Mock every dispatch target so this file tests the *worker's own*
// orchestration (dispatch routing, timeout, cancellation, error
// classification, lease renewal) in isolation from the real service
// functions themselves — those already have their own full test suites
// (codebaseIndex.test.ts, qa.test.ts / routes/qa.test.ts, codeReview.test.ts).
vi.mock("./codebaseIndex.js", () => ({
  startIndexing: vi.fn(),
  reindexRepository: vi.fn(),
}));
vi.mock("./qa.js", () => ({
  askQuestion: vi.fn(),
}));
vi.mock("./codeReview.js", () => ({
  createReview: vi.fn(),
}));

const codebaseIndexService = await import("./codebaseIndex.js");
const qaService = await import("./qa.js");
const codeReviewService = await import("./codeReview.js");
const { runOneClaimedJob } = await import("./jobWorker.js");

async function cleanDb() {
  await prisma.job.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

async function makeUserAndProject() {
  const user = await prisma.user.create({
    data: { id: randomUUID(), email: `worker-${randomUUID()}@example.com`, passwordHash: "x" },
  });
  const project = await prisma.project.create({ data: { id: randomUUID(), ownerId: user.id, name: "Worker Test" } });
  return { user, project };
}

beforeEach(async () => {
  await cleanDb();
  vi.clearAllMocks();
});

afterEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("runOneClaimedJob — dispatch routing", () => {
  it("dispatches an indexing job to startIndexing by default", async () => {
    const { user, project } = await makeUserAndProject();
    vi.mocked(codebaseIndexService.startIndexing).mockResolvedValue({ status: "completed" } as never);
    const job = await createJob(user.id, project.id, "indexing", {});
    const claimed = await claimNextJob("w1");
    await runOneClaimedJob(claimed!);
    expect(codebaseIndexService.startIndexing).toHaveBeenCalledWith(user.id, project.id);
    const finished = await getJob(user.id, project.id, job.id);
    expect(finished.status).toBe("completed");
    expect(finished.output).toEqual({ status: "completed" });
  });

  it("dispatches an indexing job with input.force=true to reindexRepository", async () => {
    const { user, project } = await makeUserAndProject();
    vi.mocked(codebaseIndexService.reindexRepository).mockResolvedValue({ status: "completed" } as never);
    await createJob(user.id, project.id, "indexing", { force: true });
    const claimed = await claimNextJob("w1");
    await runOneClaimedJob(claimed!);
    expect(codebaseIndexService.reindexRepository).toHaveBeenCalledWith(user.id, project.id);
    expect(codebaseIndexService.startIndexing).not.toHaveBeenCalled();
  });

  it("dispatches a qa job to askQuestion with the input question", async () => {
    const { user, project } = await makeUserAndProject();
    vi.mocked(qaService.askQuestion).mockResolvedValue({ answer: "42" } as never);
    const job = await createJob(user.id, project.id, "qa", { question: "What is the meaning of life?" });
    const claimed = await claimNextJob("w1");
    await runOneClaimedJob(claimed!);
    expect(qaService.askQuestion).toHaveBeenCalledWith(user.id, project.id, "What is the meaning of life?");
    const finished = await getJob(user.id, project.id, job.id);
    expect(finished.status).toBe("completed");
  });

  it("fails a qa job cleanly when the input is missing the required question", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "qa", {});
    const claimed = await claimNextJob("w1");
    await runOneClaimedJob(claimed!);
    const finished = await getJob(user.id, project.id, job.id);
    expect(finished.status).toBe("failed");
    expect(qaService.askQuestion).not.toHaveBeenCalled();
  });

  it("dispatches a review job to createReview with the input scope", async () => {
    const { user, project } = await makeUserAndProject();
    vi.mocked(codeReviewService.createReview).mockResolvedValue({ id: "r1" } as never);
    await createJob(user.id, project.id, "review", { scope: "auth" });
    const claimed = await claimNextJob("w1");
    await runOneClaimedJob(claimed!);
    expect(codeReviewService.createReview).toHaveBeenCalledWith(user.id, project.id, "auth");
  });

  it("never dispatches an evaluation job — fails it immediately with a clear reason", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "evaluation", {});
    const claimed = await claimNextJob("w1");
    await runOneClaimedJob(claimed!);
    const finished = await getJob(user.id, project.id, job.id);
    expect(finished.status).toBe("failed");
    expect(finished.errorCode).toBe("JOB_TYPE_NOT_DISPATCHABLE");
  });
});

describe("runOneClaimedJob — error classification and retry", () => {
  it("a 5xx AppError is classified transient and requeues the job (within maxRetries)", async () => {
    const { user, project } = await makeUserAndProject();
    vi.mocked(qaService.askQuestion).mockRejectedValue(new AppError(503, "AI_PROVIDER_UNAVAILABLE", "Provider down."));
    const job = await createJob(user.id, project.id, "qa", { question: "x" }, { maxRetries: 3 });
    const claimed = await claimNextJob("w1");
    await runOneClaimedJob(claimed!);
    const after = await getJob(user.id, project.id, job.id);
    expect(after.status).toBe("queued");
    expect(after.retryCount).toBe(1);
    expect(after.errorMessage).toBe("Provider down.");
  });

  it("a 4xx AppError is classified permanent and fails without retrying", async () => {
    const { user, project } = await makeUserAndProject();
    vi.mocked(qaService.askQuestion).mockRejectedValue(new AppError(400, "VALIDATION_ERROR", "Bad input."));
    const job = await createJob(user.id, project.id, "qa", { question: "x" }, { maxRetries: 3 });
    const claimed = await claimNextJob("w1");
    await runOneClaimedJob(claimed!);
    const after = await getJob(user.id, project.id, job.id);
    expect(after.status).toBe("failed");
    expect(after.retryCount).toBe(0);
  });

  it("a provider 429 (rate limit) is classified transient and requeues, same as a generic 5xx", async () => {
    const { user, project } = await makeUserAndProject();
    vi.mocked(qaService.askQuestion).mockRejectedValue(new AppError(429, "RATE_LIMITED", "Too many requests."));
    const job = await createJob(user.id, project.id, "qa", { question: "x" }, { maxRetries: 3 });
    const claimed = await claimNextJob("w1");
    await runOneClaimedJob(claimed!);
    const after = await getJob(user.id, project.id, job.id);
    // Found via this exact test (Milestone 15.7): a naive ">= 500 is
    // transient" rule would wrongly fail a 429 permanently on the first
    // attempt — fixed in classifyError()'s TRANSIENT_STATUSES set.
    expect(after.status).toBe("queued");
    expect(after.retryCount).toBe(1);
  });

  it("a malformed/empty provider input never crashes the worker loop — the job fails cleanly", async () => {
    const { user, project } = await makeUserAndProject();
    vi.mocked(codeReviewService.createReview).mockResolvedValue({ id: "r1" } as never);
    const job = await createJob(user.id, project.id, "review", { scope: 12345 }); // wrong type, not a string
    const claimed = await claimNextJob("w1");
    await expect(runOneClaimedJob(claimed!)).resolves.toBeUndefined();
    const after = await getJob(user.id, project.id, job.id);
    expect(after.status).toBe("completed"); // scope falls back to the service's own default when not a string
    expect(codeReviewService.createReview).toHaveBeenCalledWith(user.id, project.id, undefined);
  });

  it("an unrecognized thrown value never leaks its raw detail into errorMessage", async () => {
    const { user, project } = await makeUserAndProject();
    vi.mocked(qaService.askQuestion).mockRejectedValue(new Error("some raw internal stack trace with SECRET=sk-ant-abc123"));
    const job = await createJob(user.id, project.id, "qa", { question: "x" });
    const claimed = await claimNextJob("w1");
    await runOneClaimedJob(claimed!);
    const after = await getJob(user.id, project.id, job.id);
    expect(after.errorMessage).not.toContain("SECRET");
    expect(after.errorMessage).not.toContain("sk-ant-");
  });
});

describe("runOneClaimedJob — cancellation", () => {
  it("a job cancelled before it starts running its dispatch never calls the underlying service", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "qa", { question: "x" });
    const claimed = await claimNextJob("w1");
    // Simulate a cancel request arriving between claim and execution.
    await prisma.job.update({ where: { id: claimed!.id }, data: { cancelRequested: true } });
    await runOneClaimedJob(claimed!);
    expect(qaService.askQuestion).not.toHaveBeenCalled();
    const after = await getJob(user.id, project.id, job.id);
    expect(after.status).toBe("cancelled");
  });

  it("a job cancelled while its dispatch was in flight is marked cancelled, not completed", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "qa", { question: "x" });
    let resolveDispatch!: (v: unknown) => void;
    vi.mocked(qaService.askQuestion).mockReturnValue(
      new Promise((resolve) => {
        resolveDispatch = resolve;
      }) as never,
    );
    const claimed = await claimNextJob("w1");
    const runPromise = runOneClaimedJob(claimed!);
    // While the mocked service call is still pending, request cancellation.
    await prisma.job.update({ where: { id: claimed!.id }, data: { cancelRequested: true } });
    resolveDispatch({ answer: "too late" });
    await runPromise;
    const after = await getJob(user.id, project.id, job.id);
    expect(after.status).toBe("cancelled");
    expect(after.output).toBeNull();
  });

  it("isCancellationRequested reflects the flag accurately at any point", async () => {
    const { user, project } = await makeUserAndProject();
    const job = await createJob(user.id, project.id, "indexing", {});
    expect(await isCancellationRequested(job.id)).toBe(false);
    await prisma.job.update({ where: { id: job.id }, data: { cancelRequested: true } });
    expect(await isCancellationRequested(job.id)).toBe(true);
  });
});

describe("runOneClaimedJob — timeout", () => {
  it("a dispatch that never resolves is eventually marked timed_out", async () => {
    const { user, project } = await makeUserAndProject();
    vi.mocked(qaService.askQuestion).mockReturnValue(new Promise(() => {}) as never); // never resolves
    const job = await createJob(user.id, project.id, "qa", { question: "x" });
    const claimed = await claimNextJob("w1");

    // A short, real timeout (not faked) — exercises the actual
    // setTimeout/Promise.race path end-to-end rather than mocking time.
    await runOneClaimedJob(claimed!, 50);

    const after = await getJob(user.id, project.id, job.id);
    expect(after.status).toBe("timed_out");
  });
});
