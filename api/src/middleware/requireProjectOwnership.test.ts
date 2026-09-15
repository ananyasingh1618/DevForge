import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requireProjectOwnership } from "./requireProjectOwnership.js";

/**
 * A direct, isolated unit test of the middleware function itself — not
 * routed through the full Express app or any controller/service. This is
 * deliberately separate from (and does not replace) the many existing
 * end-to-end cross-user tests that exercise ownership through real HTTP
 * requests: those prove the *overall* request is rejected, which the
 * service-level check alone would already guarantee. This file exists to
 * prove specifically that *this middleware*, on its own, independently
 * performs and enforces the ownership check — the actual defense-in-depth
 * property Milestone 16.3 exists to add, not just "another test that
 * happens to pass because of the other layer."
 */

async function cleanDb() {
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

async function makeUserAndProject() {
  const user = await prisma.user.create({
    data: { id: randomUUID(), email: `ownership-mw-${randomUUID()}@example.com`, passwordHash: "x" },
  });
  const project = await prisma.project.create({ data: { id: randomUUID(), ownerId: user.id, name: "Ownership MW Test" } });
  return { user, project };
}

function makeReqRes(params: Record<string, string>, user?: { id: string; email: string }) {
  const req = { params, user } as unknown as Request;
  const res = {} as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe("requireProjectOwnership (direct, isolated middleware test)", () => {
  it("calls next() with no error when the authenticated user owns the project", async () => {
    const { user, project } = await makeUserAndProject();
    const { req, res, next } = makeReqRes({ projectId: project.id }, { id: user.id, email: user.email });

    await requireProjectOwnership(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(); // called with no arguments = success
  });

  it("calls next(AppError 404) — never a raw throw, never a silent pass — when the project belongs to a different user", async () => {
    const { project } = await makeUserAndProject();
    const intruder = await prisma.user.create({
      data: { id: randomUUID(), email: `ownership-mw-intruder-${randomUUID()}@example.com`, passwordHash: "x" },
    });
    const { req, res, next } = makeReqRes({ projectId: project.id }, { id: intruder.id, email: intruder.email });

    await requireProjectOwnership(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(404); // existence-hiding, matching the service layer's own convention
    expect(err.code).toBe("NOT_FOUND");
  });

  it("calls next(AppError 404) when the project id is well-formed but belongs to no one", async () => {
    const { user } = await makeUserAndProject();
    const { req, res, next } = makeReqRes({ projectId: randomUUID() }, { id: user.id, email: user.email });

    await requireProjectOwnership(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(404);
  });

  it("calls next(AppError 401) if somehow reached with no authenticated user on the request", async () => {
    const { project } = await makeUserAndProject();
    const { req, res, next } = makeReqRes({ projectId: project.id }, undefined);

    await requireProjectOwnership(req, res, next);

    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
  });

  it("passes through with no error for a malformed (non-UUID) project id, deferring to the route's own Zod validation", async () => {
    const { user } = await makeUserAndProject();
    const { req, res, next } = makeReqRes({ projectId: "not-a-uuid" }, { id: user.id, email: user.email });

    await requireProjectOwnership(req, res, next);

    expect(next).toHaveBeenCalledWith(); // no error — downstream validation handles this case
  });
});
