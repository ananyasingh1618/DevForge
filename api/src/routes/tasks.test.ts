import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = createApp();

async function cleanDb() {
  await prisma.session.deleteMany();
  await prisma.taskVersion.deleteMany();
  await prisma.epicVersion.deleteMany();
  await prisma.architectureVersion.deleteMany();
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

async function createProject(cookie: string[], name = "Tasks Test Project") {
  const res = await request(app).post("/projects").set("Cookie", cookie).send({ name });
  return res.body.data.project.id as string;
}

const AI_REQUIREMENTS_SUCCESS_BODY = {
  content: {
    project_summary: "A weekly personal budgeting app with shared household views.",
    users: ["Individual budgeters"],
    functional_requirements: [],
    non_functional_requirements: [],
    constraints: [],
    assumptions: [],
    open_questions: [],
  },
};

const AI_PRD_SUCCESS_BODY = {
  content: {
    overview: "A weekly personal budgeting app that helps households track shared spending.",
    problem_statement: "Households struggle to coordinate spending visibility across members.",
    goals: [],
    personas: [],
    functional_requirements: [],
    non_functional_requirements: [],
    user_workflows: [],
    edge_cases: [],
    success_criteria: [],
    constraints: [],
    assumptions: [],
    open_questions: [],
  },
};

const AI_ARCHITECTURE_SUCCESS_BODY = {
  content: {
    overview: "A single-page app backed by a small REST API and a relational database.",
    system_architecture: "A modular monolith.",
    technology_stack: ["React", "Node/Express", "PostgreSQL"],
    components: ["API service"],
    data_model: [],
    api_design: [],
    data_flows: [],
    security: [],
    scalability: [],
    deployment: [],
    tradeoffs: [],
    assumptions: [],
    open_questions: [],
  },
};

const AI_EPICS_SUCCESS_BODY = {
  content: {
    epics: [
      {
        id: "EP-1",
        title: "Expense logging",
        description: "Let users log expenses against weekly categories.",
        objective: "Users can record an expense quickly.",
        business_value: "Core value proposition.",
        scope: "Expense creation and category assignment.",
        acceptance_criteria: ["A logged expense persists with a timestamp"],
        dependencies: [],
        related_components: ["API service"],
      },
    ],
  },
};

const AI_TASKS_SUCCESS_BODY = {
  content: {
    tasks: [
      {
        id: "T-1",
        title: "Add POST /expenses endpoint",
        description: "Create an endpoint that persists a new expense.",
        type: "feature",
        priority: "high",
        acceptance_criteria: ["Posting a valid expense returns 201"],
        dependencies: [],
        epic_id: "EP-1",
        related_component: "API service",
        estimated_complexity: "small",
        suggested_order: 1,
      },
    ],
  },
};

/** Mocks the outbound fetch() call aiServiceClient.ts makes to ai-service —
 * a test double for the HTTP boundary only, mirroring routes/epics.test.ts.
 * Real, unmocked ai-service behavior is covered by ai-service/tests/test_tasks.py
 * and tests/tasks.test.ts. */
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

/** Creates a project with active requirements, PRD, architecture, and epic
 * versions, via the real (mocked-at-the-fetch-boundary) analyze/generate
 * endpoints — not a direct Prisma insert. Mirrors
 * routes/epics.test.ts's createProjectWithActiveArchitecture one link
 * further down the chain. */
async function createProjectWithActiveEpics(cookie: string[]) {
  const projectId = await createProject(cookie);
  mockAiServiceFetch({ status: 200, body: AI_REQUIREMENTS_SUCCESS_BODY });
  await request(app)
    .post(`/projects/${projectId}/requirements/analyze`)
    .set("Cookie", cookie)
    .send({ idea: "A weekly personal budgeting app with shared household views." });
  mockAiServiceFetch({ status: 200, body: AI_PRD_SUCCESS_BODY });
  await request(app).post(`/projects/${projectId}/prd/generate`).set("Cookie", cookie);
  mockAiServiceFetch({ status: 200, body: AI_ARCHITECTURE_SUCCESS_BODY });
  await request(app).post(`/projects/${projectId}/architecture/generate`).set("Cookie", cookie);
  mockAiServiceFetch({ status: 200, body: AI_EPICS_SUCCESS_BODY });
  await request(app).post(`/projects/${projectId}/epics/generate`).set("Cookie", cookie);
  return projectId;
}

describe("POST /projects/:projectId/tasks/generate", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).post(
      "/projects/00000000-0000-0000-0000-000000000000/tasks/generate",
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for a project owned by someone else", async () => {
    const ownerCookie = await registerAndGetCookie("task-owner@example.com");
    const intruderCookie = await registerAndGetCookie("task-intruder@example.com");
    const projectId = await createProjectWithActiveEpics(ownerCookie);

    const res = await request(app)
      .post(`/projects/${projectId}/tasks/generate`)
      .set("Cookie", intruderCookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 NO_ACTIVE_EPICS when the project has no epics, without calling ai-service", async () => {
    const cookie = await registerAndGetCookie("task-noepics@example.com");
    const projectId = await createProject(cookie);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app).post(`/projects/${projectId}/tasks/generate`).set("Cookie", cookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_ACTIVE_EPICS");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates version 1, active, sourced from the active epic version, from a mocked successful ai-service response", async () => {
    const cookie = await registerAndGetCookie("task-generate@example.com");
    const projectId = await createProjectWithActiveEpics(cookie);
    const epicList = await request(app).get(`/projects/${projectId}/epics`).set("Cookie", cookie);
    const epicVersionId = epicList.body.data.versions[0].id as string;

    mockAiServiceFetch({ status: 200, body: AI_TASKS_SUCCESS_BODY });
    const res = await request(app).post(`/projects/${projectId}/tasks/generate`).set("Cookie", cookie);

    expect(res.status).toBe(201);
    expect(res.body.data.version.version).toBe(1);
    expect(res.body.data.version.isActive).toBe(true);
    expect(res.body.data.version.sourceEpicVersionId).toBe(epicVersionId);
    expect(res.body.data.version.content.tasks[0].id).toBe("T-1");
    expect(res.body.data.version.content.tasks[0].epicId).toBe("EP-1");
    expect(res.body.data.version.content.tasks[0].suggestedOrder).toBe(1);
  });

  it("maps a real ai-service PROVIDER_NOT_CONFIGURED response to 503 AI_PROVIDER_UNAVAILABLE and persists nothing", async () => {
    const cookie = await registerAndGetCookie("task-noprovider@example.com");
    const projectId = await createProjectWithActiveEpics(cookie);
    mockAiServiceFetch({
      status: 503,
      body: {
        error: {
          code: "PROVIDER_NOT_CONFIGURED",
          message:
            "No LLM provider is configured. Set ANTHROPIC_API_KEY in the ai-service environment to enable task generation.",
        },
      },
    });

    const res = await request(app).post(`/projects/${projectId}/tasks/generate`).set("Cookie", cookie);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(res.body.error.message).toContain("task generation");

    const list = await request(app).get(`/projects/${projectId}/tasks`).set("Cookie", cookie);
    expect(list.body.data.versions).toHaveLength(0);
  });

  it("returns 502 AI_SERVICE_UNREACHABLE when the ai-service call throws (network failure)", async () => {
    const cookie = await registerAndGetCookie("task-unreachable@example.com");
    const projectId = await createProjectWithActiveEpics(cookie);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

    const res = await request(app).post(`/projects/${projectId}/tasks/generate`).set("Cookie", cookie);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_SERVICE_UNREACHABLE");
  });
});

describe("GET /projects/:projectId/tasks", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).get("/projects/00000000-0000-0000-0000-000000000000/tasks");
    expect(res.status).toBe(401);
  });

  it("returns 404 for a project owned by someone else", async () => {
    const ownerCookie = await registerAndGetCookie("task-list-owner@example.com");
    const intruderCookie = await registerAndGetCookie("task-list-intruder@example.com");
    const projectId = await createProjectWithActiveEpics(ownerCookie);

    const res = await request(app).get(`/projects/${projectId}/tasks`).set("Cookie", intruderCookie);
    expect(res.status).toBe(404);
  });

  it("lists versions newest first", async () => {
    const cookie = await registerAndGetCookie("task-list@example.com");
    const projectId = await createProjectWithActiveEpics(cookie);
    mockAiServiceFetch({ status: 200, body: AI_TASKS_SUCCESS_BODY });
    await request(app).post(`/projects/${projectId}/tasks/generate`).set("Cookie", cookie);
    mockAiServiceFetch({ status: 200, body: AI_TASKS_SUCCESS_BODY });
    await request(app).post(`/projects/${projectId}/tasks/generate`).set("Cookie", cookie);

    const res = await request(app).get(`/projects/${projectId}/tasks`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(res.body.data.versions[0].isActive).toBe(true);
    expect(res.body.data.versions[1].isActive).toBe(false);
  });
});

describe("GET /projects/:projectId/tasks/:versionId", () => {
  it("returns 400 for a malformed version id", async () => {
    const cookie = await registerAndGetCookie("task-get-badid@example.com");
    const projectId = await createProjectWithActiveEpics(cookie);
    const res = await request(app).get(`/projects/${projectId}/tasks/not-a-uuid`).set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a well-formed id that doesn't exist", async () => {
    const cookie = await registerAndGetCookie("task-get-missing@example.com");
    const projectId = await createProjectWithActiveEpics(cookie);
    const res = await request(app)
      .get(`/projects/${projectId}/tasks/00000000-0000-0000-0000-000000000000`)
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /projects/:projectId/tasks/:versionId", () => {
  async function seedVersion(cookie: string[], projectId: string) {
    mockAiServiceFetch({ status: 200, body: AI_TASKS_SUCCESS_BODY });
    const res = await request(app).post(`/projects/${projectId}/tasks/generate`).set("Cookie", cookie);
    return res.body.data.version.id as string;
  }

  it("updates content in place without creating a new version", async () => {
    const cookie = await registerAndGetCookie("task-update@example.com");
    const projectId = await createProjectWithActiveEpics(cookie);
    const versionId = await seedVersion(cookie, projectId);

    const updatedContent = {
      tasks: [
        {
          id: "T-1",
          title: "Edited title",
          description: "d",
          type: "feature",
          priority: "high",
          acceptanceCriteria: [],
          dependencies: [],
          epicId: "EP-1",
          relatedComponent: "API service",
          estimatedComplexity: "small",
          suggestedOrder: 1,
        },
      ],
    };

    const res = await request(app)
      .patch(`/projects/${projectId}/tasks/${versionId}`)
      .set("Cookie", cookie)
      .send(updatedContent);

    expect(res.status).toBe(200);
    expect(res.body.data.version.content.tasks[0].title).toBe("Edited title");
    expect(res.body.data.version.version).toBe(1);

    const list = await request(app).get(`/projects/${projectId}/tasks`).set("Cookie", cookie);
    expect(list.body.data.versions).toHaveLength(1);
  });

  it("returns 400 when the content shape is invalid (bad enum value)", async () => {
    const cookie = await registerAndGetCookie("task-update-bad@example.com");
    const projectId = await createProjectWithActiveEpics(cookie);
    const versionId = await seedVersion(cookie, projectId);

    const res = await request(app)
      .patch(`/projects/${projectId}/tasks/${versionId}`)
      .set("Cookie", cookie)
      .send({
        tasks: [
          {
            id: "T-1",
            title: "x",
            description: "d",
            type: "not-a-type",
            priority: "high",
            acceptanceCriteria: [],
            dependencies: [],
            epicId: "EP-1",
            relatedComponent: "x",
            estimatedComplexity: "small",
            suggestedOrder: 1,
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /projects/:projectId/tasks/:versionId/activate", () => {
  it("marks the target version active and deactivates the previous active version", async () => {
    const cookie = await registerAndGetCookie("task-activate@example.com");
    const projectId = await createProjectWithActiveEpics(cookie);
    mockAiServiceFetch({ status: 200, body: AI_TASKS_SUCCESS_BODY });
    const v1Res = await request(app).post(`/projects/${projectId}/tasks/generate`).set("Cookie", cookie);
    const v1Id = v1Res.body.data.version.id as string;
    mockAiServiceFetch({ status: 200, body: AI_TASKS_SUCCESS_BODY });
    await request(app).post(`/projects/${projectId}/tasks/generate`).set("Cookie", cookie);

    const activateRes = await request(app)
      .post(`/projects/${projectId}/tasks/${v1Id}/activate`)
      .set("Cookie", cookie);
    expect(activateRes.status).toBe(200);
    expect(activateRes.body.data.version.isActive).toBe(true);
    expect(activateRes.body.data.version.version).toBe(1);

    const list = await request(app).get(`/projects/${projectId}/tasks`).set("Cookie", cookie);
    const activeVersions = list.body.data.versions.filter((v: { isActive: boolean }) => v.isActive);
    expect(activeVersions).toHaveLength(1);
    expect(activeVersions[0].version).toBe(1);
  });
});

describe("GET /projects/:projectId/tasks/compare", () => {
  it("returns an id-matched item-list diff between two versions", async () => {
    const cookie = await registerAndGetCookie("task-compare@example.com");
    const projectId = await createProjectWithActiveEpics(cookie);
    mockAiServiceFetch({ status: 200, body: AI_TASKS_SUCCESS_BODY });
    const v1Res = await request(app).post(`/projects/${projectId}/tasks/generate`).set("Cookie", cookie);
    const v1Id = v1Res.body.data.version.id as string;

    const v2Body = {
      content: {
        tasks: [
          ...AI_TASKS_SUCCESS_BODY.content.tasks,
          {
            id: "T-2",
            title: "Add expense validation middleware",
            description: "Validate expense payloads before persisting.",
            type: "chore",
            priority: "medium",
            acceptance_criteria: [],
            dependencies: ["T-1"],
            epic_id: "EP-1",
            related_component: "API service",
            estimated_complexity: "small",
            suggested_order: 2,
          },
        ],
      },
    };
    mockAiServiceFetch({ status: 200, body: v2Body });
    const v2Res = await request(app).post(`/projects/${projectId}/tasks/generate`).set("Cookie", cookie);
    const v2Id = v2Res.body.data.version.id as string;

    const res = await request(app)
      .get(`/projects/${projectId}/tasks/compare`)
      .query({ a: v1Id, b: v2Id })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.diff.tasks.added).toEqual([
      { id: "T-2", title: "Add expense validation middleware" },
    ]);
    expect(res.body.data.diff.tasks.removed).toEqual([]);
    expect(res.body.data.diff.tasks.changed).toEqual([]);
  });

  it("returns 400 when a and b are the same id", async () => {
    const cookie = await registerAndGetCookie("task-compare-same@example.com");
    const projectId = await createProjectWithActiveEpics(cookie);
    const id = "00000000-0000-0000-0000-000000000000";

    const res = await request(app)
      .get(`/projects/${projectId}/tasks/compare`)
      .query({ a: id, b: id })
      .set("Cookie", cookie);

    expect(res.status).toBe(400);
  });

  it("returns 404 when one of the ids doesn't belong to the project", async () => {
    const cookie = await registerAndGetCookie("task-compare-missing@example.com");
    const projectId = await createProjectWithActiveEpics(cookie);
    mockAiServiceFetch({ status: 200, body: AI_TASKS_SUCCESS_BODY });
    const v1Res = await request(app).post(`/projects/${projectId}/tasks/generate`).set("Cookie", cookie);
    const v1Id = v1Res.body.data.version.id as string;

    const res = await request(app)
      .get(`/projects/${projectId}/tasks/compare`)
      .query({ a: v1Id, b: "00000000-0000-0000-0000-000000000000" })
      .set("Cookie", cookie);

    expect(res.status).toBe(404);
  });
});
