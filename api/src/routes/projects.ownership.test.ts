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

describe("cross-user project ownership", () => {
  it("hides one user's project from another user's GET /projects/:id (404, not 403)", async () => {
    const ownerCookie = await registerAndGetCookie("owner-a@example.com");
    const intruderCookie = await registerAndGetCookie("owner-b@example.com");

    const createRes = await request(app)
      .post("/projects")
      .set("Cookie", ownerCookie)
      .send({ name: "Owner A's Private Project" });
    const projectId = createRes.body.data.project.id;

    const intruderRes = await request(app)
      .get(`/projects/${projectId}`)
      .set("Cookie", intruderCookie);

    expect(intruderRes.status).toBe(404);
    expect(intruderRes.body.error.code).toBe("NOT_FOUND");
    expect(intruderRes.body).not.toHaveProperty("data");
  });

  it("excludes another user's projects from GET /projects, even when both have projects", async () => {
    const cookieA = await registerAndGetCookie("list-a@example.com");
    const cookieB = await registerAndGetCookie("list-b@example.com");

    await request(app).post("/projects").set("Cookie", cookieA).send({ name: "A1" });
    await request(app).post("/projects").set("Cookie", cookieA).send({ name: "A2" });
    await request(app).post("/projects").set("Cookie", cookieB).send({ name: "B1" });

    const resA = await request(app).get("/projects").set("Cookie", cookieA);
    const resB = await request(app).get("/projects").set("Cookie", cookieB);

    expect(resA.body.data.projects.map((p: { name: string }) => p.name).sort()).toEqual([
      "A1",
      "A2",
    ]);
    expect(resB.body.data.projects.map((p: { name: string }) => p.name)).toEqual(["B1"]);
  });

  it("a project id that is well-formed but belongs to no one is 404 for any authenticated user", async () => {
    const cookie = await registerAndGetCookie("solo@example.com");
    const res = await request(app)
      .get("/projects/ffffffff-ffff-ffff-ffff-ffffffffffff")
      .set("Cookie", cookie);

    expect(res.status).toBe(404);
  });
});

describe("session expiry", () => {
  it("rejects a session whose expiresAt is in the past, even though the token hash matches", async () => {
    const cookieHeader = await registerAndGetCookie("expiring@example.com");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "expiring@example.com" } });

    // Force every session row for this user into the past, simulating a
    // token that was valid but has since expired.
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app).get("/auth/me").set("Cookie", cookieHeader);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});
