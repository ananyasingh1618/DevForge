import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const app = createApp();
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: "ok" } });
  });
});

describe("unmatched route", () => {
  it("returns the standard 404 error envelope", async () => {
    const app = createApp();
    const res = await request(app).get("/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
