import { prisma } from "../lib/prisma.js";
import { MAX_LIST_RESULTS } from "../lib/pagination.js";
import type { CreateProjectInput } from "../schemas/projects.js";
import type { Project } from "@prisma/client";

export function createProject(ownerId: string, input: CreateProjectInput): Promise<Project> {
  return prisma.project.create({
    data: { ownerId, name: input.name, description: input.description ?? null },
  });
}

export function listProjectsForOwner(ownerId: string): Promise<Project[]> {
  return prisma.project.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" },
    take: MAX_LIST_RESULTS,
  });
}

/**
 * Returns the project only if it both exists and is owned by `ownerId`. The
 * caller (controller) turns a null result into a 404 — deliberately the same
 * 404 whether the project doesn't exist or belongs to someone else, so a
 * response can never be used to confirm another user's project ID.
 */
export function getProjectForOwner(ownerId: string, id: string): Promise<Project | null> {
  return prisma.project.findFirst({ where: { id, ownerId } });
}
