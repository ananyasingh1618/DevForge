import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = createApp();

async function cleanDb() {
  await prisma.evaluationRun.deleteMany();
  await prisma.session.deleteMany();
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

async function createRun(overrides: Partial<Parameters<typeof prisma.evaluationRun.create>[0]["data"]> = {}) {
  return prisma.evaluationRun.create({
    data: {
      datasetVersion: "v1",
      evaluatorVersion: "v1",
      mode: "mock",
      gitCommit: "abc1234",
      passed: true,
      totalCases: 10,
      failedCaseCount: 0,
      retrievalMetrics: {},
      qaMetrics: {},
      reviewMetrics: {},
      reportJson: { note: "test fixture" },
      ...overrides,
    },
  });
}

describe("GET /evaluations — deliberately unscoped by design (Phase 16, Milestone 16.2)", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/evaluations");
    expect(res.status).toBe(401);
  });

  it(
    "any authenticated user can list a run created by a completely different user's session, " +
      "because evaluation runs are a system-wide resource over the fixed evaluation dataset, not " +
      "per-user data — there is no creator/owner field on EvaluationRun at all",
    async () => {
      // Two independent users. Neither "creates" the run through the API
      // (evaluation runs are written by the separate evaluation/ CLI, not
      // through this service) — inserted directly, as evaluation/ would.
      const run = await createRun();
      const userACookie = await registerAndGetCookie("eval-user-a@example.com");
      const userBCookie = await registerAndGetCookie("eval-user-b@example.com");

      const asA = await request(app).get("/evaluations").set("Cookie", userACookie);
      expect(asA.status).toBe(200);
      expect(asA.body.data.runs.map((r: { id: string }) => r.id)).toContain(run.id);

      const asB = await request(app).get("/evaluations").set("Cookie", userBCookie);
      expect(asB.status).toBe(200);
      expect(asB.body.data.runs.map((r: { id: string }) => r.id)).toContain(run.id);
    },
  );

  it("any authenticated user can read a single run's full detail, including reportJson, regardless of who else has an account", async () => {
    const run = await createRun({ reportJson: { note: "detail should be visible to any authenticated user" } });
    const cookie = await registerAndGetCookie("eval-detail-reader@example.com");

    const res = await request(app).get(`/evaluations/${run.id}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(run.id);
    expect(res.body.data.reportJson).toEqual({ note: "detail should be visible to any authenticated user" });
  });

  it("returns 404 (not a permission error) for a run id that does not exist at all", async () => {
    const cookie = await registerAndGetCookie("eval-missing-run@example.com");
    const res = await request(app).get("/evaluations/00000000-0000-0000-0000-000000000000").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});
