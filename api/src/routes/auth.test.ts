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

const credentials = { email: "auth-test@example.com", password: "correct-horse-battery" };

function getSetCookie(res: request.Response): string[] {
  const cookie = res.headers["set-cookie"] as string[] | undefined;
  if (!cookie) {
    throw new Error("Expected a Set-Cookie header on the response");
  }
  return cookie;
}

describe("POST /auth/register", () => {
  it("creates a user, sets a session cookie, and never returns the password hash", async () => {
    const res = await request(app).post("/auth/register").send(credentials);

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(credentials.email);
    expect(res.body.data.user).not.toHaveProperty("passwordHash");
    expect(res.body.data.user).not.toHaveProperty("password");
    expect(res.headers["set-cookie"]?.[0]).toMatch(/devforge_session=/);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/HttpOnly/);
  });

  it("rejects a duplicate email with 409 EMAIL_TAKEN", async () => {
    await request(app).post("/auth/register").send(credentials);
    const res = await request(app).post("/auth/register").send(credentials);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("rejects a short password with 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "short@example.com", password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /auth/login", () => {
  beforeEach(async () => {
    await request(app).post("/auth/register").send(credentials);
  });

  it("logs in with correct credentials and sets a session cookie", async () => {
    const res = await request(app).post("/auth/login").send(credentials);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(credentials.email);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/devforge_session=/);
  });

  it("returns 401 INVALID_CREDENTIALS for a wrong password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: credentials.email, password: "wrong-password-entirely" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns the same 401 INVALID_CREDENTIALS for an unknown email (no enumeration)", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: "irrelevant-password" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("GET /auth/me", () => {
  it("returns 401 UNAUTHENTICATED with no session cookie", async () => {
    const res = await request(app).get("/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns the current user when a valid session cookie is sent", async () => {
    const registerRes = await request(app).post("/auth/register").send(credentials);
    const cookie = getSetCookie(registerRes);

    const meRes = await request(app).get("/auth/me").set("Cookie", cookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.email).toBe(credentials.email);
  });
});

describe("POST /auth/logout", () => {
  it("clears the session so /auth/me subsequently returns 401", async () => {
    const registerRes = await request(app).post("/auth/register").send(credentials);
    const cookie = getSetCookie(registerRes);

    const logoutRes = await request(app).post("/auth/logout").set("Cookie", cookie);
    expect(logoutRes.status).toBe(204);

    const meRes = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(meRes.status).toBe(401);
  });

  it("returns 401 UNAUTHENTICATED when called with no session", async () => {
    const res = await request(app).post("/auth/logout");
    expect(res.status).toBe(401);
  });
});
