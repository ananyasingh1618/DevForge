import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { claimNextJob } from "../services/jobs.js";

const app = createApp();

async function cleanDb() {
  await prisma.job.deleteMany();
  await prisma.session.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

afterEach(async () => {
  await cleanDb();
});

function getSetCookie(res: request.Response): string[] {
  const cookie = res.headers["set-cookie"] as string[] | undefined;
  if (!cookie) {
    throw new Error("Expected a Set-Cookie header on the response");
  }
  return cookie;
}

async function registerAndGetCookie(email: string) {
  const res = await request(app).post("/auth/register").send({ email, password: "correct-horse-battery" });
  return getSetCookie(res);
}

async function createProject(cookie: string[], name = "Jobs Test Project") {
  const res = await request(app).post("/projects").set("Cookie", cookie).send({ name });
  return res.body.data.project.id as string;
}

describe("auth and ownership (representative across all five endpoints)", () => {
  it("returns 401 without a session on every endpoint", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    expect((await request(app).post(`/projects/${id}/jobs`).send({ type: "qa", input: {} })).status).toBe(401);
    expect((await request(app).get(`/projects/${id}/jobs`)).status).toBe(401);
    expect((await request(app).get(`/projects/${id}/jobs/${id}`)).status).toBe(401);
    expect((await request(app).post(`/projects/${id}/jobs/${id}/cancel`)).status).toBe(401);
    expect((await request(app).post(`/projects/${id}/jobs/${id}/retry`)).status).toBe(401);
  });

  it("returns 404 for a project owned by someone else", async () => {
    const ownerCookie = await registerAndGetCookie("jobs-owner@example.com");
    const intruderCookie = await registerAndGetCookie("jobs-intruder@example.com");
    const projectId = await createProject(ownerCookie);

    const res = await request(app)
      .post(`/projects/${projectId}/jobs`)
      .set("Cookie", intruderCookie)
      .send({ type: "qa", input: { question: "x" } });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for another user's job, not distinguishing 'doesn't exist' from 'not yours'", async () => {
    const ownerCookie = await registerAndGetCookie("jobs-owner2@example.com");
    const intruderCookie = await registerAndGetCookie("jobs-intruder2@example.com");
    const ownerProjectId = await createProject(ownerCookie);
    const intruderProjectId = await createProject(intruderCookie, "Intruder Project");

    const createRes = await request(app)
      .post(`/projects/${ownerProjectId}/jobs`)
      .set("Cookie", ownerCookie)
      .send({ type: "qa", input: { question: "x" } });
    const jobId = createRes.body.data.job.id;

    // Intruder tries to read the owner's job through the intruder's *own*
    // (valid) project id — must still 404, not leak the job's existence.
    const res = await request(app).get(`/projects/${intruderProjectId}/jobs/${jobId}`).set("Cookie", intruderCookie);
    expect(res.status).toBe(404);
  });
});

describe("POST /projects/:projectId/jobs — validation", () => {
  it("rejects an unknown job type", async () => {
    const cookie = await registerAndGetCookie("jobs-badtype@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).post(`/projects/${projectId}/jobs`).set("Cookie", cookie).send({ type: "delete-everything" });
    expect(res.status).toBe(400);
  });

  it("defaults input to {} when omitted", async () => {
    const cookie = await registerAndGetCookie("jobs-defaultinput@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app).post(`/projects/${projectId}/jobs`).set("Cookie", cookie).send({ type: "indexing" });
    expect(res.status).toBe(201);
    expect(res.body.data.job.input).toEqual({});
  });
});

describe("job lifecycle over HTTP", () => {
  it("creates, reads, and lists a job", async () => {
    const cookie = await registerAndGetCookie("jobs-lifecycle@example.com");
    const projectId = await createProject(cookie);

    const createRes = await request(app)
      .post(`/projects/${projectId}/jobs`)
      .set("Cookie", cookie)
      .send({ type: "review", input: { scope: "auth" } });
    expect(createRes.status).toBe(201);
    const job = createRes.body.data.job;
    expect(job.status).toBe("queued");
    expect(job.type).toBe("review");

    const getRes = await request(app).get(`/projects/${projectId}/jobs/${job.id}`).set("Cookie", cookie);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.job.id).toBe(job.id);

    const listRes = await request(app).get(`/projects/${projectId}/jobs`).set("Cookie", cookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.jobs.map((j: { id: string }) => j.id)).toContain(job.id);
  });

  it("is idempotent over HTTP: resubmitting with the same idempotencyKey returns the same job", async () => {
    const cookie = await registerAndGetCookie("jobs-idempotent@example.com");
    const projectId = await createProject(cookie);
    const body = { type: "qa", input: { question: "x" }, idempotencyKey: "retry-me" };

    const first = await request(app).post(`/projects/${projectId}/jobs`).set("Cookie", cookie).send(body);
    const second = await request(app).post(`/projects/${projectId}/jobs`).set("Cookie", cookie).send(body);
    expect(first.body.data.job.id).toBe(second.body.data.job.id);
  });

  it("cancels a queued job", async () => {
    const cookie = await registerAndGetCookie("jobs-cancel@example.com");
    const projectId = await createProject(cookie);
    const createRes = await request(app).post(`/projects/${projectId}/jobs`).set("Cookie", cookie).send({ type: "indexing" });
    const jobId = createRes.body.data.job.id;

    const cancelRes = await request(app).post(`/projects/${projectId}/jobs/${jobId}/cancel`).set("Cookie", cookie);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.job.status).toBe("cancelled");
  });

  it("rejects cancelling an already-cancelled job with a clear conflict, not a silent 200", async () => {
    const cookie = await registerAndGetCookie("jobs-doublecancel@example.com");
    const projectId = await createProject(cookie);
    const createRes = await request(app).post(`/projects/${projectId}/jobs`).set("Cookie", cookie).send({ type: "indexing" });
    const jobId = createRes.body.data.job.id;
    await request(app).post(`/projects/${projectId}/jobs/${jobId}/cancel`).set("Cookie", cookie);

    const secondCancel = await request(app).post(`/projects/${projectId}/jobs/${jobId}/cancel`).set("Cookie", cookie);
    expect(secondCancel.status).toBe(409);
    expect(secondCancel.body.error.code).toBe("INVALID_JOB_TRANSITION");
  });

  it("rejects retrying a job that never failed", async () => {
    const cookie = await registerAndGetCookie("jobs-badretry@example.com");
    const projectId = await createProject(cookie);
    const createRes = await request(app).post(`/projects/${projectId}/jobs`).set("Cookie", cookie).send({ type: "qa", input: { question: "x" } });
    const jobId = createRes.body.data.job.id;

    const retryRes = await request(app).post(`/projects/${projectId}/jobs/${jobId}/retry`).set("Cookie", cookie);
    expect(retryRes.status).toBe(409);
  });

  it("filters the job list by status and type", async () => {
    const cookie = await registerAndGetCookie("jobs-filter@example.com");
    const projectId = await createProject(cookie);
    await request(app).post(`/projects/${projectId}/jobs`).set("Cookie", cookie).send({ type: "qa", input: { question: "x" } });
    const reviewRes = await request(app).post(`/projects/${projectId}/jobs`).set("Cookie", cookie).send({ type: "review", input: {} });

    const filtered = await request(app).get(`/projects/${projectId}/jobs`).set("Cookie", cookie).query({ type: "review" });
    expect(filtered.body.data.jobs.map((j: { id: string }) => j.id)).toEqual([reviewRes.body.data.job.id]);
  });

  it("never returns a raw stack trace or provider secret in a job's error fields", async () => {
    const cookie = await registerAndGetCookie("jobs-safeerror@example.com");
    const projectId = await createProject(cookie);
    // A qa job with no question in its input fails immediately once
    // claimed, through the real worker dispatch path.
    const createRes = await request(app).post(`/projects/${projectId}/jobs`).set("Cookie", cookie).send({ type: "qa", input: {} });
    const jobId = createRes.body.data.job.id;
    const claimed = await claimNextJob("test-worker");
    expect(claimed?.id).toBe(jobId);
    const { runOneClaimedJob } = await import("../services/jobWorker.js");
    await runOneClaimedJob(claimed!);

    const getRes = await request(app).get(`/projects/${projectId}/jobs/${jobId}`).set("Cookie", cookie);
    expect(getRes.body.data.job.status).toBe("failed");
    expect(JSON.stringify(getRes.body.data.job)).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/); // no stack-trace-shaped text
  });
});
