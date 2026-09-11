import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = createApp();

async function cleanDb() {
  await prisma.session.deleteMany();
  await prisma.prdVersion.deleteMany();
  await prisma.requirementsVersion.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
}

beforeEach(async () => {
  await cleanDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
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
  const res = await request(app)
    .post("/auth/register")
    .send({ email, password: "correct-horse-battery" });
  return getSetCookie(res);
}

async function createProject(cookie: string[], name = "PRD Test Project") {
  const res = await request(app).post("/projects").set("Cookie", cookie).send({ name });
  return res.body.data.project.id as string;
}

const AI_REQUIREMENTS_SUCCESS_BODY = {
  content: {
    project_summary: "A weekly personal budgeting app with shared household views.",
    users: ["Individual budgeters"],
    functional_requirements: [
      {
        id: "FR-1",
        title: "Track weekly spending",
        description: "Log expenses against weekly categories.",
        priority: "high",
        source: "stated",
        acceptance_criteria: ["Expense saved with category and date"],
      },
    ],
    non_functional_requirements: [],
    constraints: ["Must work offline for logging expenses"],
    assumptions: [],
    open_questions: [],
  },
};

const AI_PRD_SUCCESS_BODY = {
  content: {
    overview: "A weekly personal budgeting app that helps households track shared spending.",
    problem_statement: "Households struggle to coordinate spending visibility across members.",
    goals: ["Give households a shared weekly view of spending"],
    personas: ["Primary budgeter"],
    functional_requirements: ["Log an expense against a weekly category"],
    non_functional_requirements: ["Usable offline for logging"],
    user_workflows: ["User opens app, selects category, logs expense"],
    edge_cases: ["Expense logged while offline syncs once reconnected"],
    success_criteria: ["80% of expenses logged within a day of purchase"],
    constraints: ["Must work offline for logging expenses"],
    assumptions: [],
    open_questions: [],
  },
};

/** Mocks the outbound fetch() call aiServiceClient.ts makes to ai-service —
 * a test double for the HTTP boundary only, mirroring routes/requirements.test.ts.
 * Real, unmocked ai-service behavior is covered by ai-service/tests/test_prd.py
 * and tests/prd.test.ts. */
function mockAiServiceFetch(response: { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
    }),
  );
}

/** Creates a project with one active requirements version, via the real
 * (mocked-at-the-fetch-boundary) requirements/analyze endpoint — not a
 * direct Prisma insert — so the seeded state is exactly what that endpoint
 * actually produces. */
async function createProjectWithActiveRequirements(cookie: string[]) {
  const projectId = await createProject(cookie);
  mockAiServiceFetch({ status: 200, body: AI_REQUIREMENTS_SUCCESS_BODY });
  await request(app)
    .post(`/projects/${projectId}/requirements/analyze`)
    .set("Cookie", cookie)
    .send({ idea: "A weekly personal budgeting app with shared household views." });
  return projectId;
}

describe("POST /projects/:projectId/prd/generate", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).post(
      "/projects/00000000-0000-0000-0000-000000000000/prd/generate",
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for a project owned by someone else", async () => {
    const ownerCookie = await registerAndGetCookie("prd-owner@example.com");
    const intruderCookie = await registerAndGetCookie("prd-intruder@example.com");
    const projectId = await createProjectWithActiveRequirements(ownerCookie);

    const res = await request(app)
      .post(`/projects/${projectId}/prd/generate`)
      .set("Cookie", intruderCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 NO_ACTIVE_REQUIREMENTS when the project has no requirements, without calling ai-service", async () => {
    const cookie = await registerAndGetCookie("prd-norequirements@example.com");
    const projectId = await createProject(cookie);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_ACTIVE_REQUIREMENTS");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates version 1, active, sourced from the active requirements version, from a mocked successful ai-service response", async () => {
    const cookie = await registerAndGetCookie("prd-generate@example.com");
    const projectId = await createProjectWithActiveRequirements(cookie);
    const requirementsList = await request(app)
      .get(`/projects/${projectId}/requirements`)
      .set("Cookie", cookie);
    const requirementsVersionId = requirementsList.body.data.versions[0].id as string;

    mockAiServiceFetch({ status: 200, body: AI_PRD_SUCCESS_BODY });
    const res = await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);

    expect(res.status).toBe(201);
    expect(res.body.data.version.version).toBe(1);
    expect(res.body.data.version.isActive).toBe(true);
    expect(res.body.data.version.sourceRequirementsVersionId).toBe(requirementsVersionId);
    expect(res.body.data.version.content.overview).toBe(AI_PRD_SUCCESS_BODY.content.overview);
    expect(res.body.data.version.content.goals).toEqual(AI_PRD_SUCCESS_BODY.content.goals);
  });

  it("maps a real ai-service PROVIDER_NOT_CONFIGURED response to 503 AI_PROVIDER_UNAVAILABLE and persists nothing", async () => {
    const cookie = await registerAndGetCookie("prd-noprovider@example.com");
    const projectId = await createProjectWithActiveRequirements(cookie);
    mockAiServiceFetch({
      status: 503,
      body: {
        error: {
          code: "PROVIDER_NOT_CONFIGURED",
          message: "No LLM provider is configured. Set ANTHROPIC_API_KEY in the ai-service environment to enable PRD generation.",
        },
      },
    });

    const res = await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(res.body.error.message).toContain("PRD generation");

    const list = await request(app).get(`/projects/${projectId}/prd`).set("Cookie", cookie);
    expect(list.body.data.versions).toHaveLength(0);
  });

  it("returns 502 AI_SERVICE_UNREACHABLE when the ai-service call throws (network failure)", async () => {
    const cookie = await registerAndGetCookie("prd-unreachable@example.com");
    const projectId = await createProjectWithActiveRequirements(cookie);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

    const res = await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_SERVICE_UNREACHABLE");
  });
});

describe("GET /projects/:projectId/prd", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).get("/projects/00000000-0000-0000-0000-000000000000/prd");
    expect(res.status).toBe(401);
  });

  it("returns 404 for a project owned by someone else", async () => {
    const ownerCookie = await registerAndGetCookie("prd-list-owner@example.com");
    const intruderCookie = await registerAndGetCookie("prd-list-intruder@example.com");
    const projectId = await createProjectWithActiveRequirements(ownerCookie);

    const res = await request(app).get(`/projects/${projectId}/prd`).set("Cookie", intruderCookie);
    expect(res.status).toBe(404);
  });

  it("lists versions newest first", async () => {
    const cookie = await registerAndGetCookie("prd-list@example.com");
    const projectId = await createProjectWithActiveRequirements(cookie);
    mockAiServiceFetch({ status: 200, body: AI_PRD_SUCCESS_BODY });
    await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);
    mockAiServiceFetch({ status: 200, body: AI_PRD_SUCCESS_BODY });
    await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);

    const res = await request(app).get(`/projects/${projectId}/prd`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(res.body.data.versions[0].isActive).toBe(true);
    expect(res.body.data.versions[1].isActive).toBe(false);
  });
});

describe("GET /projects/:projectId/prd/:versionId", () => {
  it("returns 400 for a malformed version id", async () => {
    const cookie = await registerAndGetCookie("prd-get-badid@example.com");
    const projectId = await createProjectWithActiveRequirements(cookie);
    const res = await request(app).get(`/projects/${projectId}/prd/not-a-uuid`).set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a well-formed id that doesn't exist", async () => {
    const cookie = await registerAndGetCookie("prd-get-missing@example.com");
    const projectId = await createProjectWithActiveRequirements(cookie);
    const res = await request(app)
      .get(`/projects/${projectId}/prd/00000000-0000-0000-0000-000000000000`)
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /projects/:projectId/prd/:versionId", () => {
  async function seedVersion(cookie: string[], projectId: string) {
    mockAiServiceFetch({ status: 200, body: AI_PRD_SUCCESS_BODY });
    const res = await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);
    return res.body.data.version.id as string;
  }

  it("updates content in place without creating a new version", async () => {
    const cookie = await registerAndGetCookie("prd-update@example.com");
    const projectId = await createProjectWithActiveRequirements(cookie);
    const versionId = await seedVersion(cookie, projectId);

    const updatedContent = {
      overview: "Edited overview.",
      problemStatement: "Edited problem statement.",
      goals: ["Give households a shared weekly view of spending"],
      personas: ["Primary budgeter"],
      functionalRequirements: ["Log an expense against a weekly category"],
      nonFunctionalRequirements: ["Usable offline for logging"],
      userWorkflows: ["User opens app, selects category, logs expense"],
      edgeCases: ["Expense logged while offline syncs once reconnected"],
      successCriteria: ["80% of expenses logged within a day of purchase"],
      constraints: ["Must work offline for logging expenses"],
      assumptions: [],
      openQuestions: [],
    };

    const res = await request(app)
      .patch(`/projects/${projectId}/prd/${versionId}`)
      .set("Cookie", cookie)
      .send(updatedContent);

    expect(res.status).toBe(200);
    expect(res.body.data.version.content.overview).toBe("Edited overview.");
    expect(res.body.data.version.version).toBe(1);

    const list = await request(app).get(`/projects/${projectId}/prd`).set("Cookie", cookie);
    expect(list.body.data.versions).toHaveLength(1);
  });

  it("returns 400 when the content shape is invalid", async () => {
    const cookie = await registerAndGetCookie("prd-update-bad@example.com");
    const projectId = await createProjectWithActiveRequirements(cookie);
    const versionId = await seedVersion(cookie, projectId);

    const res = await request(app)
      .patch(`/projects/${projectId}/prd/${versionId}`)
      .set("Cookie", cookie)
      .send({ overview: "missing everything else" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /projects/:projectId/prd/:versionId/activate", () => {
  it("marks the target version active and deactivates the previous active version", async () => {
    const cookie = await registerAndGetCookie("prd-activate@example.com");
    const projectId = await createProjectWithActiveRequirements(cookie);
    mockAiServiceFetch({ status: 200, body: AI_PRD_SUCCESS_BODY });
    const v1Res = await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);
    const v1Id = v1Res.body.data.version.id as string;
    mockAiServiceFetch({ status: 200, body: AI_PRD_SUCCESS_BODY });
    await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);

    const activateRes = await request(app)
      .post(`/projects/${projectId}/prd/${v1Id}/activate`)
      .set("Cookie", cookie);
    expect(activateRes.status).toBe(200);
    expect(activateRes.body.data.version.isActive).toBe(true);
    expect(activateRes.body.data.version.version).toBe(1);

    const list = await request(app).get(`/projects/${projectId}/prd`).set("Cookie", cookie);
    const activeVersions = list.body.data.versions.filter((v: { isActive: boolean }) => v.isActive);
    expect(activeVersions).toHaveLength(1);
    expect(activeVersions[0].version).toBe(1);
  });
});

describe("GET /projects/:projectId/prd/compare", () => {
  it("returns a structural diff between two versions", async () => {
    const cookie = await registerAndGetCookie("prd-compare@example.com");
    const projectId = await createProjectWithActiveRequirements(cookie);
    mockAiServiceFetch({ status: 200, body: AI_PRD_SUCCESS_BODY });
    const v1Res = await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);
    const v1Id = v1Res.body.data.version.id as string;

    const v2Body = {
      content: {
        ...AI_PRD_SUCCESS_BODY.content,
        goals: [...AI_PRD_SUCCESS_BODY.content.goals, "Support a weekly stats view"],
      },
    };
    mockAiServiceFetch({ status: 200, body: v2Body });
    const v2Res = await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);
    const v2Id = v2Res.body.data.version.id as string;

    const res = await request(app)
      .get(`/projects/${projectId}/prd/compare`)
      .query({ a: v1Id, b: v2Id })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.diff.goals.added).toEqual(["Support a weekly stats view"]);
    expect(res.body.data.diff.goals.removed).toEqual([]);
    expect(res.body.data.diff.overviewChanged).toBe(false);
  });

  it("returns 400 when a and b are the same id", async () => {
    const cookie = await registerAndGetCookie("prd-compare-same@example.com");
    const projectId = await createProjectWithActiveRequirements(cookie);
    const id = "00000000-0000-0000-0000-000000000000";

    const res = await request(app)
      .get(`/projects/${projectId}/prd/compare`)
      .query({ a: id, b: id })
      .set("Cookie", cookie);

    expect(res.status).toBe(400);
  });

  it("returns 404 when one of the ids doesn't belong to the project", async () => {
    const cookie = await registerAndGetCookie("prd-compare-missing@example.com");
    const projectId = await createProjectWithActiveRequirements(cookie);
    mockAiServiceFetch({ status: 200, body: AI_PRD_SUCCESS_BODY });
    const v1Res = await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);
    const v1Id = v1Res.body.data.version.id as string;

    const res = await request(app)
      .get(`/projects/${projectId}/prd/compare`)
      .query({ a: v1Id, b: "00000000-0000-0000-0000-000000000000" })
      .set("Cookie", cookie);

    expect(res.status).toBe(404);
  });
});
