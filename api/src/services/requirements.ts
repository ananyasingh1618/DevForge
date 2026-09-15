import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requireOwnedProject } from "../lib/ownership.js";
import { analyzeRequirementsViaAiService } from "../lib/aiServiceClient.js";
import type { RequirementItem, RequirementsContent } from "../schemas/requirements.js";
import type { RequirementsVersion } from "@prisma/client";

/**
 * Confirms the project exists and belongs to `ownerId`. Throws the same 404
 * whether it doesn't exist or belongs to someone else — matches the
 * existing getProjectForOwner pattern in services/projects.ts.
 */

export async function analyzeAndCreateVersion(
  ownerId: string,
  projectId: string,
  idea: string,
): Promise<RequirementsVersion> {
  await requireOwnedProject(ownerId, projectId);

  // Calls the AI service before touching the database. If this throws
  // (provider not configured, unreachable, invalid response), nothing is
  // persisted — there is no partial/garbage version row.
  const content = await analyzeRequirementsViaAiService(idea);

  return prisma.$transaction(async (tx) => {
    const latest = await tx.requirementsVersion.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    await tx.requirementsVersion.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    });

    return tx.requirementsVersion.create({
      data: { projectId, version: nextVersion, ideaText: idea, content, isActive: true },
    });
  });
}

export async function listVersions(
  ownerId: string,
  projectId: string,
): Promise<RequirementsVersion[]> {
  await requireOwnedProject(ownerId, projectId);
  return prisma.requirementsVersion.findMany({
    where: { projectId },
    orderBy: { version: "desc" },
  });
}

export async function getVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
): Promise<RequirementsVersion> {
  await requireOwnedProject(ownerId, projectId);
  const version = await prisma.requirementsVersion.findFirst({
    where: { id: versionId, projectId },
  });
  if (!version) {
    throw AppError.notFound("Requirements version not found");
  }
  return version;
}

export async function updateVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
  content: RequirementsContent,
): Promise<RequirementsVersion> {
  await getVersion(ownerId, projectId, versionId);
  return prisma.requirementsVersion.update({
    where: { id: versionId },
    data: { content },
  });
}

export async function activateVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
): Promise<RequirementsVersion> {
  await getVersion(ownerId, projectId, versionId);
  return prisma.$transaction(async (tx) => {
    await tx.requirementsVersion.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    });
    return tx.requirementsVersion.update({
      where: { id: versionId },
      data: { isActive: true },
    });
  });
}

type ArrayFieldDiff = { added: string[]; removed: string[] };
type RequirementItemDiff = {
  added: Array<{ id: string; title: string }>;
  removed: Array<{ id: string; title: string }>;
  changed: string[];
};

export type RequirementsDiff = {
  functionalRequirements: RequirementItemDiff;
  nonFunctionalRequirements: RequirementItemDiff;
  users: ArrayFieldDiff;
  constraints: ArrayFieldDiff;
  assumptions: ArrayFieldDiff;
  openQuestions: ArrayFieldDiff;
};

function diffStringArray(a: string[], b: string[]): ArrayFieldDiff {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    added: b.filter((x) => !setA.has(x)),
    removed: a.filter((x) => !setB.has(x)),
  };
}

function diffRequirementItems(a: RequirementItem[], b: RequirementItem[]): RequirementItemDiff {
  const mapA = new Map(a.map((item) => [item.id, item]));
  const mapB = new Map(b.map((item) => [item.id, item]));
  return {
    added: b.filter((item) => !mapA.has(item.id)).map((item) => ({ id: item.id, title: item.title })),
    removed: a
      .filter((item) => !mapB.has(item.id))
      .map((item) => ({ id: item.id, title: item.title })),
    changed: b
      .filter((item) => {
        const prev = mapA.get(item.id);
        return prev !== undefined && JSON.stringify(prev) !== JSON.stringify(item);
      })
      .map((item) => item.id),
  };
}

/**
 * A deliberately simple structural diff — added/removed/changed, matched by
 * `id` for requirement items and by set difference for the plain string
 * arrays. Not a semantic diff; that's out of scope for this phase.
 */
export function diffRequirementsContent(
  a: RequirementsContent,
  b: RequirementsContent,
): RequirementsDiff {
  return {
    functionalRequirements: diffRequirementItems(a.functionalRequirements, b.functionalRequirements),
    nonFunctionalRequirements: diffRequirementItems(
      a.nonFunctionalRequirements,
      b.nonFunctionalRequirements,
    ),
    users: diffStringArray(a.users, b.users),
    constraints: diffStringArray(a.constraints, b.constraints),
    assumptions: diffStringArray(a.assumptions, b.assumptions),
    openQuestions: diffStringArray(a.openQuestions, b.openQuestions),
  };
}

export async function compareVersions(
  ownerId: string,
  projectId: string,
  idA: string,
  idB: string,
): Promise<{ a: RequirementsVersion; b: RequirementsVersion; diff: RequirementsDiff }> {
  await requireOwnedProject(ownerId, projectId);
  const [a, b] = await Promise.all([
    prisma.requirementsVersion.findFirst({ where: { id: idA, projectId } }),
    prisma.requirementsVersion.findFirst({ where: { id: idB, projectId } }),
  ]);
  if (!a || !b) {
    throw AppError.notFound("Requirements version not found");
  }
  const diff = diffRequirementsContent(
    a.content as RequirementsContent,
    b.content as RequirementsContent,
  );
  return { a, b, diff };
}
