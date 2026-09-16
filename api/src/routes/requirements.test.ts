import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = createApp();

async function cleanDb() {
  await prisma.session.deleteMany();
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

const AI_SUCCESS_BODY = {
  content: {
    project_summary: "A tool that tracks coffee consumption during code reviews.",
    users: ["Developers who review code"],
    functional_requirements: [
      {
        id: "FR-1",
        title: "Log a coffee event",
        description: "Log a cup tied to a review.",
        priority: "high",
        source: "stated",
        acceptance_criteria: ["Logging persists a timestamp"],
      },
    ],
    non_functional_requirements: [],
    features: ["Coffee logging"],
    risks: ["No usage data yet to validate demand"],
    constraints: [],
    assumptions: ["Single-user, no team accounts needed yet"],
    open_questions: ["Should decaf count separately?"],
  },
};

/** Mocks the outbound fetch() call aiServiceClient.ts makes to ai-service —
 * this is a test double for the HTTP boundary only, not a claim that any
 * LLM ran. Real, unmocked ai-service behavior is covered by
 * ai-service/tests/test_requirements.py and tests/requirements.test.ts. */
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

async function createProject(cookie: string[], name = "Requirements Test Project") {
  const res = await request(app).post("/projects").set("Cookie", cookie).send({ name });
  return res.body.data.project.id as string;
}

describe("POST /projects/:projectId/requirements/analyze", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app)
      .post("/projects/00000000-0000-0000-0000-000000000000/requirements/analyze")
      .send({ idea: "A tool that tracks coffee consumption during code reviews." });
    expect(res.status).toBe(401);
  });

  it("returns 404 for a project owned by someone else", async () => {
    const ownerCookie = await registerAndGetCookie("req-owner@example.com");
    const intruderCookie = await registerAndGetCookie("req-intruder@example.com");
    const projectId = await createProject(ownerCookie);

    const res = await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", intruderCookie)
      .send({ idea: "A tool that tracks coffee consumption during code reviews." });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for an idea that is too short, without calling ai-service", async () => {
    const cookie = await registerAndGetCookie("req-short@example.com");
    const projectId = await createProject(cookie);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", cookie)
      .send({ idea: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates version 1, active, from a mocked successful ai-service response", async () => {
    const cookie = await registerAndGetCookie("req-analyze@example.com");
    const projectId = await createProject(cookie);
    mockAiServiceFetch({ status: 200, body: AI_SUCCESS_BODY });

    const res = await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", cookie)
      .send({ idea: "A tool that tracks coffee consumption during code reviews." });

    expect(res.status).toBe(201);
    expect(res.body.data.version.version).toBe(1);
    expect(res.body.data.version.isActive).toBe(true);
    expect(res.body.data.version.content.projectSummary).toBe(AI_SUCCESS_BODY.content.project_summary);
    expect(res.body.data.version.content.functionalRequirements[0].id).toBe("FR-1");
    expect(res.body.data.version.content.functionalRequirements[0].acceptanceCriteria).toEqual([
      "Logging persists a timestamp",
    ]);
    expect(res.body.data.version.content.features).toEqual(["Coffee logging"]);
    expect(res.body.data.version.content.risks).toEqual(["No usage data yet to validate demand"]);
  });

  it("maps a real ai-service PROVIDER_NOT_CONFIGURED response to 503 AI_PROVIDER_UNAVAILABLE", async () => {
    const cookie = await registerAndGetCookie("req-noprovider@example.com");
    const projectId = await createProject(cookie);
    mockAiServiceFetch({
      status: 503,
      body: { error: { code: "PROVIDER_NOT_CONFIGURED", message: "No LLM provider is configured." } },
    });

    const res = await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", cookie)
      .send({ idea: "A tool that tracks coffee consumption during code reviews." });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(res.body.error.message).toBe("No LLM provider is configured.");

    // Nothing should have been persisted from the failed attempt.
    const list = await request(app)
      .get(`/projects/${projectId}/requirements`)
      .set("Cookie", cookie);
    expect(list.body.data.versions).toHaveLength(0);
  });

  it("returns 502 AI_SERVICE_UNREACHABLE when the ai-service call throws (network failure)", async () => {
    const cookie = await registerAndGetCookie("req-unreachable@example.com");
    const projectId = await createProject(cookie);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("fetch failed")),
    );

    const res = await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", cookie)
      .send({ idea: "A tool that tracks coffee consumption during code reviews." });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("AI_SERVICE_UNREACHABLE");
  });
});

describe("GET /projects/:projectId/requirements", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).get("/projects/00000000-0000-0000-0000-000000000000/requirements");
    expect(res.status).toBe(401);
  });

  it("returns 404 for a project owned by someone else", async () => {
    const ownerCookie = await registerAndGetCookie("req-list-owner@example.com");
    const intruderCookie = await registerAndGetCookie("req-list-intruder@example.com");
    const projectId = await createProject(ownerCookie);

    const res = await request(app)
      .get(`/projects/${projectId}/requirements`)
      .set("Cookie", intruderCookie);
    expect(res.status).toBe(404);
  });

  it("lists versions newest first", async () => {
    const cookie = await registerAndGetCookie("req-list@example.com");
    const projectId = await createProject(cookie);
    mockAiServiceFetch({ status: 200, body: AI_SUCCESS_BODY });
    await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", cookie)
      .send({ idea: "A tool that tracks coffee consumption during code reviews." });
    await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", cookie)
      .send({ idea: "A tool that tracks coffee consumption during code reviews, v2." });

    const res = await request(app).get(`/projects/${projectId}/requirements`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(res.body.data.versions[0].isActive).toBe(true);
    expect(res.body.data.versions[1].isActive).toBe(false);
  });
});

describe("GET /projects/:projectId/requirements/:versionId", () => {
  it("returns 400 for a malformed version id", async () => {
    const cookie = await registerAndGetCookie("req-get-badid@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app)
      .get(`/projects/${projectId}/requirements/not-a-uuid`)
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a well-formed id that doesn't exist", async () => {
    const cookie = await registerAndGetCookie("req-get-missing@example.com");
    const projectId = await createProject(cookie);
    const res = await request(app)
      .get(`/projects/${projectId}/requirements/00000000-0000-0000-0000-000000000000`)
      .set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /projects/:projectId/requirements/:versionId", () => {
  async function seedVersion(cookie: string[], projectId: string) {
    mockAiServiceFetch({ status: 200, body: AI_SUCCESS_BODY });
    const res = await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", cookie)
      .send({ idea: "A tool that tracks coffee consumption during code reviews." });
    return res.body.data.version.id as string;
  }

  it("updates content in place without creating a new version", async () => {
    const cookie = await registerAndGetCookie("req-update@example.com");
    const projectId = await createProject(cookie);
    const versionId = await seedVersion(cookie, projectId);

    const updatedContent = {
      projectSummary: "Edited summary.",
      users: ["Developers who review code"],
      functionalRequirements: [
        {
          id: "FR-1",
          title: "Log a coffee event",
          description: "Log a cup tied to a review.",
          priority: "high",
          source: "stated",
          acceptanceCriteria: ["Logging persists a timestamp"],
        },
      ],
      nonFunctionalRequirements: [],
      features: ["Coffee logging", "Weekly digest email"],
      risks: ["No usage data yet to validate demand"],
      constraints: [],
      assumptions: ["Single-user, no team accounts needed yet"],
      openQuestions: ["Should decaf count separately?"],
    };

    const res = await request(app)
      .patch(`/projects/${projectId}/requirements/${versionId}`)
      .set("Cookie", cookie)
      .send(updatedContent);

    expect(res.status).toBe(200);
    expect(res.body.data.version.content.projectSummary).toBe("Edited summary.");
    expect(res.body.data.version.content.features).toEqual(["Coffee logging", "Weekly digest email"]);
    expect(res.body.data.version.content.risks).toEqual(["No usage data yet to validate demand"]);
    expect(res.body.data.version.version).toBe(1);

    const list = await request(app)
      .get(`/projects/${projectId}/requirements`)
      .set("Cookie", cookie);
    expect(list.body.data.versions).toHaveLength(1);
  });

  it("defaults features and risks to [] when a PATCH body omits them (backward compatibility with content shaped before these fields existed)", async () => {
    const cookie = await registerAndGetCookie("req-update-no-features@example.com");
    const projectId = await createProject(cookie);
    const versionId = await seedVersion(cookie, projectId);

    const contentWithoutNewFields = {
      projectSummary: "Edited summary.",
      users: ["Developers who review code"],
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      constraints: [],
      assumptions: [],
      openQuestions: [],
    };

    const res = await request(app)
      .patch(`/projects/${projectId}/requirements/${versionId}`)
      .set("Cookie", cookie)
      .send(contentWithoutNewFields);

    expect(res.status).toBe(200);
    expect(res.body.data.version.content.features).toEqual([]);
    expect(res.body.data.version.content.risks).toEqual([]);
  });

  it("returns 400 when the content shape is invalid", async () => {
    const cookie = await registerAndGetCookie("req-update-bad@example.com");
    const projectId = await createProject(cookie);
    const versionId = await seedVersion(cookie, projectId);

    const res = await request(app)
      .patch(`/projects/${projectId}/requirements/${versionId}`)
      .set("Cookie", cookie)
      .send({ projectSummary: "missing everything else" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /projects/:projectId/requirements/:versionId/activate", () => {
  it("marks the target version active and deactivates the previous active version", async () => {
    const cookie = await registerAndGetCookie("req-activate@example.com");
    const projectId = await createProject(cookie);
    mockAiServiceFetch({ status: 200, body: AI_SUCCESS_BODY });
    const v1Res = await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", cookie)
      .send({ idea: "A tool that tracks coffee consumption during code reviews." });
    const v1Id = v1Res.body.data.version.id as string;
    await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", cookie)
      .send({ idea: "A tool that tracks coffee consumption during code reviews, v2." });

    const activateRes = await request(app)
      .post(`/projects/${projectId}/requirements/${v1Id}/activate`)
      .set("Cookie", cookie);
    expect(activateRes.status).toBe(200);
    expect(activateRes.body.data.version.isActive).toBe(true);
    expect(activateRes.body.data.version.version).toBe(1);

    const list = await request(app)
      .get(`/projects/${projectId}/requirements`)
      .set("Cookie", cookie);
    const activeVersions = list.body.data.versions.filter((v: { isActive: boolean }) => v.isActive);
    expect(activeVersions).toHaveLength(1);
    expect(activeVersions[0].version).toBe(1);
  });
});

describe("GET /projects/:projectId/requirements/compare", () => {
  it("returns a structural diff between two versions", async () => {
    const cookie = await registerAndGetCookie("req-compare@example.com");
    const projectId = await createProject(cookie);
    mockAiServiceFetch({ status: 200, body: AI_SUCCESS_BODY });
    const v1Res = await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", cookie)
      .send({ idea: "A tool that tracks coffee consumption during code reviews." });
    const v1Id = v1Res.body.data.version.id as string;

    const v2Body = {
      content: {
        ...AI_SUCCESS_BODY.content,
        functional_requirements: [
          ...AI_SUCCESS_BODY.content.functional_requirements,
          {
            id: "FR-2",
            title: "View weekly stats",
            description: "See a weekly summary.",
            priority: "medium",
            source: "inferred",
            acceptance_criteria: ["A chart shows cups per day"],
          },
        ],
        features: [...AI_SUCCESS_BODY.content.features, "Weekly stats view"],
      },
    };
    mockAiServiceFetch({ status: 200, body: v2Body });
    const v2Res = await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", cookie)
      .send({ idea: "A revised idea with weekly stats added." });
    const v2Id = v2Res.body.data.version.id as string;

    const res = await request(app)
      .get(`/projects/${projectId}/requirements/compare`)
      .query({ a: v1Id, b: v2Id })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.diff.functionalRequirements.added).toEqual([
      { id: "FR-2", title: "View weekly stats" },
    ]);
    expect(res.body.data.diff.functionalRequirements.removed).toEqual([]);
    expect(res.body.data.diff.features.added).toEqual(["Weekly stats view"]);
    expect(res.body.data.diff.features.removed).toEqual([]);
  });

  it("returns 400 when a and b are the same id", async () => {
    const cookie = await registerAndGetCookie("req-compare-same@example.com");
    const projectId = await createProject(cookie);
    const id = "00000000-0000-0000-0000-000000000000";

    const res = await request(app)
      .get(`/projects/${projectId}/requirements/compare`)
      .query({ a: id, b: id })
      .set("Cookie", cookie);

    expect(res.status).toBe(400);
  });

  it("returns 404 when one of the ids doesn't belong to the project", async () => {
    const cookie = await registerAndGetCookie("req-compare-missing@example.com");
    const projectId = await createProject(cookie);
    mockAiServiceFetch({ status: 200, body: AI_SUCCESS_BODY });
    const v1Res = await request(app)
      .post(`/projects/${projectId}/requirements/analyze`)
      .set("Cookie", cookie)
      .send({ idea: "A tool that tracks coffee consumption during code reviews." });
    const v1Id = v1Res.body.data.version.id as string;

    const res = await request(app)
      .get(`/projects/${projectId}/requirements/compare`)
      .query({ a: v1Id, b: "00000000-0000-0000-0000-000000000000" })
      .set("Cookie", cookie);

    expect(res.status).toBe(404);
  });
});
