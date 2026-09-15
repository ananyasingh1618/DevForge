import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./prisma.js";
import { MAX_LIST_RESULTS } from "./pagination.js";
import { listProjectsForOwner } from "../services/projects.js";
import { listVersions as listRequirementsVersions } from "../services/requirements.js";

/**
 * Phase 16, Milestone 16.5 — proves the `take: MAX_LIST_RESULTS` bound
 * added to every previously-unbounded list query actually caps the
 * returned result set, not just that the code compiles with the field
 * present. Seeds rows directly via `createMany` (fast — no HTTP, no
 * bcrypt, no LLM calls) rather than driving this through the real
 * generate/analyze/review flows, which would be prohibitively slow for
 * MAX_LIST_RESULTS + N rows.
 *
 * Exercises two representative shapes — `listProjectsForOwner` (no
 * dependent foreign key beyond ownerId) and `requirements.ts`'s
 * `listVersions` (a project-scoped "version" resource, the same shape as
 * prd/architecture/epics/tasks) — rather than repeating this for all 8
 * call sites, since every one of them imports and applies the exact same
 * shared `MAX_LIST_RESULTS` constant (verifiable directly in the diff),
 * not a separately-hand-copied number that could drift per file.
 */

async function cleanDb() {
  await prisma.requirementsVersion.deleteMany();
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

describe("MAX_LIST_RESULTS actually bounds previously-unbounded list queries", () => {
  it("caps listProjectsForOwner at MAX_LIST_RESULTS even when the owner has more", async () => {
    const user = await prisma.user.create({
      data: { id: randomUUID(), email: `pagination-projects-${randomUUID()}@example.com`, passwordHash: "x" },
    });
    await prisma.project.createMany({
      data: Array.from({ length: MAX_LIST_RESULTS + 10 }, (_, i) => ({
        id: randomUUID(),
        ownerId: user.id,
        name: `Project ${i}`,
      })),
    });

    const totalInDb = await prisma.project.count({ where: { ownerId: user.id } });
    expect(totalInDb).toBe(MAX_LIST_RESULTS + 10);

    const listed = await listProjectsForOwner(user.id);
    expect(listed.length).toBe(MAX_LIST_RESULTS);
  });

  it("caps a project-scoped version list (requirements.ts's listVersions) at MAX_LIST_RESULTS", async () => {
    const user = await prisma.user.create({
      data: { id: randomUUID(), email: `pagination-reqs-${randomUUID()}@example.com`, passwordHash: "x" },
    });
    const project = await prisma.project.create({ data: { id: randomUUID(), ownerId: user.id, name: "Pagination Test" } });
    await prisma.requirementsVersion.createMany({
      data: Array.from({ length: MAX_LIST_RESULTS + 10 }, (_, i) => ({
        id: randomUUID(),
        projectId: project.id,
        version: i + 1,
        ideaText: "seed",
        content: {},
      })),
    });

    const totalInDb = await prisma.requirementsVersion.count({ where: { projectId: project.id } });
    expect(totalInDb).toBe(MAX_LIST_RESULTS + 10);

    const listed = await listRequirementsVersions(user.id, project.id);
    expect(listed.length).toBe(MAX_LIST_RESULTS);
  });
});
