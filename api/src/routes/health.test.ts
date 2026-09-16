import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { __resetMetricsForTests } from "../lib/metrics.js";

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const app = createApp();
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: "ok" } });
  });

  it("sets an X-Request-Id response header", async () => {
    const app = createApp();
    const res = await request(app).get("/health");

    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("echoes an incoming X-Request-Id rather than replacing it", async () => {
    const app = createApp();
    const res = await request(app).get("/health").set("X-Request-Id", "test-correlation-id-123");

    expect(res.headers["x-request-id"]).toBe("test-correlation-id-123");
  });
});

describe("GET /ready", () => {
  it("returns 200 with database ok when the database is reachable", async () => {
    const app = createApp();
    const res = await request(app).get("/ready");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: "ready", database: "ok" } });
  });
});

describe("GET /metrics", () => {
  beforeEach(() => {
    __resetMetricsForTests();
  });

  it("returns Prometheus text exposition format including real observed requests", async () => {
    const app = createApp();
    await request(app).get("/health");
    await request(app).get("/health");

    const res = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("devforge_http_requests_total");
    expect(res.text).toContain('route="/health"');
    expect(res.text).toContain("devforge_job_queue_depth");
  });
});

describe("GET /metrics.json", () => {
  beforeEach(() => {
    __resetMetricsForTests();
  });

  it("returns a JSON snapshot reflecting real observed requests, not fabricated numbers", async () => {
    const app = createApp();
    await request(app).get("/health");
    await request(app).get("/does-not-exist");

    const res = await request(app).get("/metrics.json");

    expect(res.status).toBe(200);
    expect(res.body.data.requests.total).toBeGreaterThanOrEqual(2);
    expect(res.body.data.requests.byStatusClass["2xx"]).toBeGreaterThanOrEqual(1);
    expect(res.body.data.requests.byStatusClass["4xx"]).toBeGreaterThanOrEqual(1);
    expect(res.body.data.queueDepth).toEqual({ queued: expect.any(Number), running: expect.any(Number) });
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
