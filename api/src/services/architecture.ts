import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requireOwnedProject } from "../lib/ownership.js";
import { generateArchitectureViaAiService } from "../lib/aiServiceClient.js";
import type { ArchitectureContent } from "../schemas/architecture.js";
import type { PrdContent } from "../schemas/prd.js";
import type { ArchitectureVersion } from "@prisma/client";

/**
 * Confirms the project exists and belongs to `ownerId`. Throws the same 404
 * whether it doesn't exist or belongs to someone else — matches the
 * existing pattern in services/projects.ts, services/requirements.ts, and
 * services/prd.ts.
 */

export async function generateArchitectureFromActivePrd(
  ownerId: string,
  projectId: string,
): Promise<ArchitectureVersion> {
  await requireOwnedProject(ownerId, projectId);

  // "No active PRD" is exactly "no PRD versions exist" —
  // generatePrdFromActiveRequirements/activateVersion already guarantee at
  // most one active version whenever any exist (see services/prd.ts), and
  // there is no PRD-deletion endpoint.
  const activePrd = await prisma.prdVersion.findFirst({
    where: { projectId, isActive: true },
  });
  if (!activePrd) {
    throw new AppError(
      400,
      "NO_ACTIVE_PRD",
      "Generate and activate a PRD version before generating an architecture.",
    );
  }

  // Calls the AI service before touching the database. If this throws
  // (provider not configured, unreachable, invalid response), nothing is
  // persisted — there is no partial/garbage version row.
  const content = await generateArchitectureViaAiService(activePrd.content as PrdContent);

  return prisma.$transaction(async (tx) => {
    const latest = await tx.architectureVersion.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    await tx.architectureVersion.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    });

    return tx.architectureVersion.create({
      data: {
        projectId,
        version: nextVersion,
        sourcePrdVersionId: activePrd.id,
        content,
        isActive: true,
      },
    });
  });
}

export async function listVersions(
  ownerId: string,
  projectId: string,
): Promise<ArchitectureVersion[]> {
  await requireOwnedProject(ownerId, projectId);
  return prisma.architectureVersion.findMany({
    where: { projectId },
    orderBy: { version: "desc" },
  });
}

export async function getVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
): Promise<ArchitectureVersion> {
  await requireOwnedProject(ownerId, projectId);
  const version = await prisma.architectureVersion.findFirst({
    where: { id: versionId, projectId },
  });
  if (!version) {
    throw AppError.notFound("Architecture version not found");
  }
  return version;
}

export async function updateVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
  content: ArchitectureContent,
): Promise<ArchitectureVersion> {
  await getVersion(ownerId, projectId, versionId);
  return prisma.architectureVersion.update({
    where: { id: versionId },
    data: { content },
  });
}

export async function activateVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
): Promise<ArchitectureVersion> {
  await getVersion(ownerId, projectId, versionId);
  return prisma.$transaction(async (tx) => {
    await tx.architectureVersion.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    });
    return tx.architectureVersion.update({
      where: { id: versionId },
      data: { isActive: true },
    });
  });
}

type ArrayFieldDiff = { added: string[]; removed: string[] };

export type ArchitectureDiff = {
  overviewChanged: boolean;
  systemArchitectureChanged: boolean;
  technologyStack: ArrayFieldDiff;
  components: ArrayFieldDiff;
  dataModel: ArrayFieldDiff;
  apiDesign: ArrayFieldDiff;
  dataFlows: ArrayFieldDiff;
  security: ArrayFieldDiff;
  scalability: ArrayFieldDiff;
  deployment: ArrayFieldDiff;
  tradeoffs: ArrayFieldDiff;
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

/**
 * Every ArchitectureContent field is either a plain string (reported as a
 * simple changed flag) or a string array (reported via the same
 * set-difference the requirements/PRD diffs already use) — no nested
 * id-matched items, so this mirrors diffPrdContent exactly, not a new
 * diffing concept.
 */
export function diffArchitectureContent(
  a: ArchitectureContent,
  b: ArchitectureContent,
): ArchitectureDiff {
  return {
    overviewChanged: a.overview !== b.overview,
    systemArchitectureChanged: a.systemArchitecture !== b.systemArchitecture,
    technologyStack: diffStringArray(a.technologyStack, b.technologyStack),
    components: diffStringArray(a.components, b.components),
    dataModel: diffStringArray(a.dataModel, b.dataModel),
    apiDesign: diffStringArray(a.apiDesign, b.apiDesign),
    dataFlows: diffStringArray(a.dataFlows, b.dataFlows),
    security: diffStringArray(a.security, b.security),
    scalability: diffStringArray(a.scalability, b.scalability),
    deployment: diffStringArray(a.deployment, b.deployment),
    tradeoffs: diffStringArray(a.tradeoffs, b.tradeoffs),
    assumptions: diffStringArray(a.assumptions, b.assumptions),
    openQuestions: diffStringArray(a.openQuestions, b.openQuestions),
  };
}

export async function compareVersions(
  ownerId: string,
  projectId: string,
  idA: string,
  idB: string,
): Promise<{ a: ArchitectureVersion; b: ArchitectureVersion; diff: ArchitectureDiff }> {
  await requireOwnedProject(ownerId, projectId);
  const [a, b] = await Promise.all([
    prisma.architectureVersion.findFirst({ where: { id: idA, projectId } }),
    prisma.architectureVersion.findFirst({ where: { id: idB, projectId } }),
  ]);
  if (!a || !b) {
    throw AppError.notFound("Architecture version not found");
  }
  const diff = diffArchitectureContent(a.content as ArchitectureContent, b.content as ArchitectureContent);
  return { a, b, diff };
}
