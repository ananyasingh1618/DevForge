import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = createApp();

async function cleanDb() {
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

describe("POST /projects", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).post("/projects").send({ name: "No Auth" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("creates a project owned by the authenticated user", async () => {
    const cookie = await registerAndGetCookie("owner@example.com");

    const res = await request(app)
      .post("/projects")
      .set("Cookie", cookie)
      .send({ name: "DevForge", description: "AI software engineering platform" });

    expect(res.status).toBe(201);
    expect(res.body.data.project).toMatchObject({
      name: "DevForge",
      description: "AI software engineering platform",
      status: "planning",
    });
    expect(res.body.data.project.id).toBeTypeOf("string");
  });

  it("rejects an empty name with 400 VALIDATION_ERROR", async () => {
    const cookie = await registerAndGetCookie("owner2@example.com");

    const res = await request(app).post("/projects").set("Cookie", cookie).send({ name: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /projects", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).get("/projects");
    expect(res.status).toBe(401);
  });

  it("returns an empty list for a user with no projects", async () => {
    const cookie = await registerAndGetCookie("empty@example.com");
    const res = await request(app).get("/projects").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.projects).toEqual([]);
  });

  it("lists projects created by the authenticated user", async () => {
    const cookie = await registerAndGetCookie("lister@example.com");
    await request(app).post("/projects").set("Cookie", cookie).send({ name: "Project A" });
    await request(app).post("/projects").set("Cookie", cookie).send({ name: "Project B" });

    const res = await request(app).get("/projects").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.projects).toHaveLength(2);
    const names = res.body.data.projects.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(["Project A", "Project B"]);
  });
});

describe("GET /projects/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).get("/projects/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(401);
  });

  it("returns the project for its owner", async () => {
    const cookie = await registerAndGetCookie("detail@example.com");
    const createRes = await request(app)
      .post("/projects")
      .set("Cookie", cookie)
      .send({ name: "Detail Project" });
    const id = createRes.body.data.project.id;

    const res = await request(app).get(`/projects/${id}`).set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.project.id).toBe(id);
    expect(res.body.data.project.name).toBe("Detail Project");
  });

  it("returns 400 VALIDATION_ERROR for a malformed id", async () => {
    const cookie = await registerAndGetCookie("badid@example.com");
    const res = await request(app).get("/projects/not-a-uuid").set("Cookie", cookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 NOT_FOUND for a well-formed id that doesn't exist", async () => {
    const cookie = await registerAndGetCookie("missing@example.com");
    const res = await request(app)
      .get("/projects/00000000-0000-0000-0000-000000000000")
      .set("Cookie", cookie);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
