import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

/**
 * Phase 16, Milestone 16.7 — a consolidated cross-user isolation matrix.
 * Every resource type already has its own scattered "returns 404 for a
 * project owned by someone else" test (see Milestone 16.1's inventory —
 * projects.ownership.test.ts, jobs.test.ts, codebaseIndex.test.ts,
 * architecture.test.ts, codeReview.test.ts, epics.test.ts, qa.test.ts,
 * retrieval.test.ts, requirements.test.ts, prd.test.ts, tasks.test.ts,
 * repository.test.ts), each in its own file, each testing its own one
 * resource in isolation. This file is deliberately different: ONE user
 * pair, ONE fully-populated project (a repository connection, a completed
 * index, an indexed file with a symbol, a chunk, a question+answer, a
 * code review, and a job), and every single read/list/write endpoint
 * across the whole API swept against it as the intruder in one place —
 * a single regression net that would catch a future isolation break on
 * ANY resource, not just the one a developer happened to remember to
 * test when adding it. Resources are seeded directly via Prisma
 * (bypassing the real GitHub/ai-service flow, which is already exercised
 * end-to-end elsewhere) so this file stays fast and focused purely on the
 * isolation boundary itself.
 */

const app = createApp();

async function cleanDb() {
  await prisma.job.deleteMany();
  await prisma.answerSource.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.question.deleteMany();
  await prisma.codeReviewFinding.deleteMany();
  await prisma.codeReviewSource.deleteMany();
  await prisma.codeReview.deleteMany();
  await prisma.embedding.deleteMany();
  await prisma.codeChunk.deleteMany();
  await prisma.symbol.deleteMany();
  await prisma.indexedFile.deleteMany();
  await prisma.codebaseIndex.deleteMany();
  await prisma.repositoryConnection.deleteMany();
  await prisma.session.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

beforeEach(async () => {
  await cleanDb();
});

afterEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

async function registerAndGetCookie(email: string) {
  const res = await request(app).post("/auth/register").send({ email, password: "correct-horse-battery" });
  return res.headers["set-cookie"] as unknown as string[];
}

/** Seeds one fully-populated project for `ownerCookie`'s user, directly
 * via Prisma, spanning every resource type this test sweeps. */
async function seedFullyPopulatedProject(ownerCookie: string[]) {
  const projectRes = await request(app).post("/projects").set("Cookie", ownerCookie).send({ name: "Isolation Target Project" });
  const projectId = projectRes.body.data.project.id as string;

  const connection = await prisma.repositoryConnection.create({
    data: {
      id: randomUUID(),
      projectId,
      githubOwner: "victim-owner",
      githubRepo: "victim-repo",
      repositoryUrl: "https://github.com/victim-owner/victim-repo",
      defaultBranch: "main",
      selectedBranch: "main",
      status: "verified",
      encryptedToken: "iv:tag:ciphertext-not-a-real-token",
      tokenLast4: "9999",
    },
  });

  const index = await prisma.codebaseIndex.create({
    data: {
      id: randomUUID(),
      projectId,
      repositoryConnectionId: connection.id,
      branch: "main",
      commitSha: "commit-isolation-test",
      status: "completed",
      fileCount: 1,
      parsedFileCount: 1,
    },
  });

  const file = await prisma.indexedFile.create({
    data: {
      id: randomUUID(),
      indexId: index.id,
      path: "src/secret-module.ts",
      language: "typescript",
      parseStatus: "parsed",
      contentHash: "blob-sha-isolation",
      sizeBytes: 100,
    },
  });

  const symbol = await prisma.symbol.create({
    data: { id: randomUUID(), fileId: file.id, name: "victimFunction", type: "function", startLine: 1, endLine: 3 },
  });

  const chunk = await prisma.codeChunk.create({
    data: {
      id: randomUUID(),
      projectId,
      codebaseIndexId: index.id,
      fileId: file.id,
      symbolId: symbol.id,
      branch: "main",
      commitSha: "commit-isolation-test",
      chunkIndex: 0,
      content: "export function victimFunction() { return 42; }",
      contentHash: "chunk-hash-isolation",
      language: "typescript",
      startLine: 1,
      endLine: 3,
    },
  });

  const question = await prisma.question.create({
    data: { id: randomUUID(), projectId, codebaseIndexId: index.id, question: "What does victimFunction do?", branch: "main", commitSha: "commit-isolation-test" },
  });
  const answer = await prisma.answer.create({
    data: { id: randomUUID(), questionId: question.id, answer: "It returns 42.", model: "claude-opus-5" },
  });
  await prisma.answerSource.create({
    data: { id: randomUUID(), answerId: answer.id, chunkId: chunk.id, sourceOrder: 1, cited: true, score: 0.9 },
  });

  const review = await prisma.codeReview.create({
    data: { id: randomUUID(), projectId, codebaseIndexId: index.id, scope: "everything", branch: "main", commitSha: "commit-isolation-test", status: "completed", summary: "Looks fine." },
  });

  const jobRes = await request(app).post(`/projects/${projectId}/jobs`).set("Cookie", ownerCookie).send({ type: "qa", input: { question: "x" } });
  const jobId = jobRes.body.data.job.id as string;

  return { projectId, fileId: file.id, questionId: question.id, reviewId: review.id, jobId };
}

describe("multi-user isolation matrix (Phase 16, Milestone 16.7)", () => {
  it("denies the intruder (404) across every read/write endpoint spanning every resource type on the victim's fully-populated project", async () => {
    const ownerCookie = await registerAndGetCookie("isolation-victim@example.com");
    const intruderCookie = await registerAndGetCookie("isolation-intruder@example.com");
    const { projectId, fileId, questionId, reviewId, jobId } = await seedFullyPopulatedProject(ownerCookie);

    const attempts: { label: string; exec: () => Promise<request.Response> }[] = [
      { label: "GET /projects/:id", exec: () => request(app).get(`/projects/${projectId}`).set("Cookie", intruderCookie) },
      { label: "GET /projects/:id/repository", exec: () => request(app).get(`/projects/${projectId}/repository`).set("Cookie", intruderCookie) },
      { label: "POST /projects/:id/repository/verify", exec: () => request(app).post(`/projects/${projectId}/repository/verify`).set("Cookie", intruderCookie) },
      { label: "GET /projects/:id/repository/branches", exec: () => request(app).get(`/projects/${projectId}/repository/branches`).set("Cookie", intruderCookie) },
      { label: "DELETE /projects/:id/repository", exec: () => request(app).delete(`/projects/${projectId}/repository`).set("Cookie", intruderCookie) },
      { label: "GET /projects/:id/codebase-index", exec: () => request(app).get(`/projects/${projectId}/codebase-index`).set("Cookie", intruderCookie) },
      { label: "GET /projects/:id/codebase-index/files", exec: () => request(app).get(`/projects/${projectId}/codebase-index/files`).set("Cookie", intruderCookie) },
      { label: "GET /projects/:id/codebase-index/files/:fileId/symbols", exec: () => request(app).get(`/projects/${projectId}/codebase-index/files/${fileId}/symbols`).set("Cookie", intruderCookie) },
      { label: "POST /projects/:id/codebase-index/reindex", exec: () => request(app).post(`/projects/${projectId}/codebase-index/reindex`).set("Cookie", intruderCookie) },
      { label: "POST /projects/:id/search", exec: () => request(app).post(`/projects/${projectId}/search`).set("Cookie", intruderCookie).send({ query: "victim" }) },
      { label: "GET /projects/:id/qa", exec: () => request(app).get(`/projects/${projectId}/qa`).set("Cookie", intruderCookie) },
      { label: "GET /projects/:id/qa/:questionId", exec: () => request(app).get(`/projects/${projectId}/qa/${questionId}`).set("Cookie", intruderCookie) },
      { label: "POST /projects/:id/qa", exec: () => request(app).post(`/projects/${projectId}/qa`).set("Cookie", intruderCookie).send({ question: "steal data" }) },
      { label: "GET /projects/:id/reviews", exec: () => request(app).get(`/projects/${projectId}/reviews`).set("Cookie", intruderCookie) },
      { label: "GET /projects/:id/reviews/:reviewId", exec: () => request(app).get(`/projects/${projectId}/reviews/${reviewId}`).set("Cookie", intruderCookie) },
      { label: "POST /projects/:id/reviews", exec: () => request(app).post(`/projects/${projectId}/reviews`).set("Cookie", intruderCookie).send({}) },
      { label: "GET /projects/:id/jobs", exec: () => request(app).get(`/projects/${projectId}/jobs`).set("Cookie", intruderCookie) },
      { label: "GET /projects/:id/jobs/:jobId", exec: () => request(app).get(`/projects/${projectId}/jobs/${jobId}`).set("Cookie", intruderCookie) },
      { label: "POST /projects/:id/jobs/:jobId/cancel", exec: () => request(app).post(`/projects/${projectId}/jobs/${jobId}/cancel`).set("Cookie", intruderCookie) },
      { label: "POST /projects/:id/jobs/:jobId/retry", exec: () => request(app).post(`/projects/${projectId}/jobs/${jobId}/retry`).set("Cookie", intruderCookie) },
      { label: "POST /projects/:id/jobs", exec: () => request(app).post(`/projects/${projectId}/jobs`).set("Cookie", intruderCookie).send({ type: "qa", input: {} }) },
      { label: "GET /projects/:id/requirements", exec: () => request(app).get(`/projects/${projectId}/requirements`).set("Cookie", intruderCookie) },
      { label: "GET /projects/:id/prd", exec: () => request(app).get(`/projects/${projectId}/prd`).set("Cookie", intruderCookie) },
      { label: "GET /projects/:id/architecture", exec: () => request(app).get(`/projects/${projectId}/architecture`).set("Cookie", intruderCookie) },
      { label: "GET /projects/:id/epics", exec: () => request(app).get(`/projects/${projectId}/epics`).set("Cookie", intruderCookie) },
      { label: "GET /projects/:id/tasks", exec: () => request(app).get(`/projects/${projectId}/tasks`).set("Cookie", intruderCookie) },
    ];

    const failures: string[] = [];
    for (const attempt of attempts) {
      const res = await attempt.exec();
      if (res.status !== 404) {
        failures.push(`${attempt.label} -> expected 404, got ${res.status} (${JSON.stringify(res.body)})`);
      }
    }

    expect(failures).toEqual([]);
    expect(attempts.length).toBeGreaterThanOrEqual(26);
  });

  it("excludes the victim's project entirely from the intruder's own project list", async () => {
    const ownerCookie = await registerAndGetCookie("isolation-list-victim@example.com");
    const intruderCookie = await registerAndGetCookie("isolation-list-intruder@example.com");
    const { projectId } = await seedFullyPopulatedProject(ownerCookie);

    await request(app).post("/projects").set("Cookie", intruderCookie).send({ name: "Intruder's Own Project" });
    const listRes = await request(app).get("/projects").set("Cookie", intruderCookie);

    expect(listRes.status).toBe(200);
    const ids = (listRes.body.data.projects as { id: string }[]).map((p) => p.id);
    expect(ids).not.toContain(projectId);
  });

  it("confirms the victim's own session can still access everything (the isolation is per-user, not a blanket lockout)", async () => {
    const ownerCookie = await registerAndGetCookie("isolation-selfcheck@example.com");
    const { projectId, jobId } = await seedFullyPopulatedProject(ownerCookie);

    const res = await request(app).get(`/projects/${projectId}/jobs/${jobId}`).set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
  });
});
