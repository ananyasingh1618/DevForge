import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { generateEpicsViaAiService } from "../lib/aiServiceClient.js";
import type { EpicContent, EpicItem } from "../schemas/epics.js";
import type { ArchitectureContent } from "../schemas/architecture.js";
import type { EpicVersion } from "@prisma/client";

/**
 * Confirms the project exists and belongs to `ownerId`. Throws the same 404
 * whether it doesn't exist or belongs to someone else — matches the
 * existing pattern in services/projects.ts, services/prd.ts, and
 * services/architecture.ts.
 */
async function requireOwnedProject(ownerId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId } });
  if (!project) {
    throw AppError.notFound("Project not found");
  }
  return project;
}

export async function generateEpicsFromActiveArchitecture(
  ownerId: string,
  projectId: string,
): Promise<EpicVersion> {
  await requireOwnedProject(ownerId, projectId);

  // "No active architecture" is exactly "no architecture versions exist" —
  // generateArchitectureFromActivePrd/activateVersion already guarantee at
  // most one active version whenever any exist (see services/architecture.ts),
  // and there is no architecture-deletion endpoint.
  const activeArchitecture = await prisma.architectureVersion.findFirst({
    where: { projectId, isActive: true },
  });
  if (!activeArchitecture) {
    throw new AppError(
      400,
      "NO_ACTIVE_ARCHITECTURE",
      "Generate and activate an architecture version before generating epics.",
    );
  }

  // Calls the AI service before touching the database. If this throws
  // (provider not configured, unreachable, invalid response), nothing is
  // persisted — there is no partial/garbage version row.
  const content = await generateEpicsViaAiService(activeArchitecture.content as ArchitectureContent);

  return prisma.$transaction(async (tx) => {
    const latest = await tx.epicVersion.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    await tx.epicVersion.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    });

    return tx.epicVersion.create({
      data: {
        projectId,
        version: nextVersion,
        sourceArchitectureVersionId: activeArchitecture.id,
        content,
        isActive: true,
      },
    });
  });
}

export async function listVersions(ownerId: string, projectId: string): Promise<EpicVersion[]> {
  await requireOwnedProject(ownerId, projectId);
  return prisma.epicVersion.findMany({
    where: { projectId },
    orderBy: { version: "desc" },
  });
}

export async function getVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
): Promise<EpicVersion> {
  await requireOwnedProject(ownerId, projectId);
  const version = await prisma.epicVersion.findFirst({ where: { id: versionId, projectId } });
  if (!version) {
    throw AppError.notFound("Epic version not found");
  }
  return version;
}

export async function updateVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
  content: EpicContent,
): Promise<EpicVersion> {
  await getVersion(ownerId, projectId, versionId);
  return prisma.epicVersion.update({
    where: { id: versionId },
    data: { content },
  });
}

export async function activateVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
): Promise<EpicVersion> {
  await getVersion(ownerId, projectId, versionId);
  return prisma.$transaction(async (tx) => {
    await tx.epicVersion.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    });
    return tx.epicVersion.update({
      where: { id: versionId },
      data: { isActive: true },
    });
  });
}

type ItemDiffEntry = { id: string; title: string };
type ItemDiff = { added: ItemDiffEntry[]; removed: ItemDiffEntry[]; changed: string[] };

export type EpicDiff = { epics: ItemDiff };

/**
 * Id-matched item-list diff, the same shape/logic
 * services/requirements.ts's diffRequirementItems uses for
 * functionalRequirements/nonFunctionalRequirements — not the flat-field
 * diff services/prd.ts and services/architecture.ts use, since epic content
 * is a list of id-bearing items, not a document of prose/list sections.
 */
function diffEpicItems(a: EpicItem[], b: EpicItem[]): ItemDiff {
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

export function diffEpicContent(a: EpicContent, b: EpicContent): EpicDiff {
  return { epics: diffEpicItems(a.epics, b.epics) };
}

export async function compareVersions(
  ownerId: string,
  projectId: string,
  idA: string,
  idB: string,
): Promise<{ a: EpicVersion; b: EpicVersion; diff: EpicDiff }> {
  await requireOwnedProject(ownerId, projectId);
  const [a, b] = await Promise.all([
    prisma.epicVersion.findFirst({ where: { id: idA, projectId } }),
    prisma.epicVersion.findFirst({ where: { id: idB, projectId } }),
  ]);
  if (!a || !b) {
    throw AppError.notFound("Epic version not found");
  }
  const diff = diffEpicContent(a.content as EpicContent, b.content as EpicContent);
  return { a, b, diff };
}
