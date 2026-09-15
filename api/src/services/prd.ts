import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requireOwnedProject } from "../lib/ownership.js";
import { generatePrdViaAiService } from "../lib/aiServiceClient.js";
import type { PrdContent } from "../schemas/prd.js";
import type { RequirementsContent } from "../schemas/requirements.js";
import type { PrdVersion } from "@prisma/client";

/**
 * Confirms the project exists and belongs to `ownerId`. Throws the same 404
 * whether it doesn't exist or belongs to someone else — matches the
 * existing pattern in services/projects.ts and services/requirements.ts.
 */

export async function generatePrdFromActiveRequirements(
  ownerId: string,
  projectId: string,
): Promise<PrdVersion> {
  await requireOwnedProject(ownerId, projectId);

  // "No active requirements" is exactly "no requirements versions exist" —
  // analyzeAndCreateVersion/activateVersion already guarantee at most one
  // active version whenever any exist (see services/requirements.ts), and
  // there is no requirements-deletion endpoint.
  const activeRequirements = await prisma.requirementsVersion.findFirst({
    where: { projectId, isActive: true },
  });
  if (!activeRequirements) {
    throw new AppError(
      400,
      "NO_ACTIVE_REQUIREMENTS",
      "Generate and activate a requirements version before generating a PRD.",
    );
  }

  // Calls the AI service before touching the database. If this throws
  // (provider not configured, unreachable, invalid response), nothing is
  // persisted — there is no partial/garbage version row.
  const content = await generatePrdViaAiService(activeRequirements.content as RequirementsContent);

  return prisma.$transaction(async (tx) => {
    const latest = await tx.prdVersion.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    await tx.prdVersion.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    });

    return tx.prdVersion.create({
      data: {
        projectId,
        version: nextVersion,
        sourceRequirementsVersionId: activeRequirements.id,
        content,
        isActive: true,
      },
    });
  });
}

export async function listVersions(ownerId: string, projectId: string): Promise<PrdVersion[]> {
  await requireOwnedProject(ownerId, projectId);
  return prisma.prdVersion.findMany({
    where: { projectId },
    orderBy: { version: "desc" },
  });
}

export async function getVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
): Promise<PrdVersion> {
  await requireOwnedProject(ownerId, projectId);
  const version = await prisma.prdVersion.findFirst({ where: { id: versionId, projectId } });
  if (!version) {
    throw AppError.notFound("PRD version not found");
  }
  return version;
}

export async function updateVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
  content: PrdContent,
): Promise<PrdVersion> {
  await getVersion(ownerId, projectId, versionId);
  return prisma.prdVersion.update({
    where: { id: versionId },
    data: { content },
  });
}

export async function activateVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
): Promise<PrdVersion> {
  await getVersion(ownerId, projectId, versionId);
  return prisma.$transaction(async (tx) => {
    await tx.prdVersion.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    });
    return tx.prdVersion.update({
      where: { id: versionId },
      data: { isActive: true },
    });
  });
}

type ArrayFieldDiff = { added: string[]; removed: string[] };

export type PrdDiff = {
  overviewChanged: boolean;
  problemStatementChanged: boolean;
  goals: ArrayFieldDiff;
  personas: ArrayFieldDiff;
  functionalRequirements: ArrayFieldDiff;
  nonFunctionalRequirements: ArrayFieldDiff;
  userWorkflows: ArrayFieldDiff;
  edgeCases: ArrayFieldDiff;
  successCriteria: ArrayFieldDiff;
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

/**
 * Every PrdContent field is either a plain string (reported as a simple
 * changed flag) or a string array (reported via the same set-difference the
 * requirements diff already uses) — no nested id-matched items like
 * RequirementItem, so this is simpler than diffRequirementsContent, not a
 * new diffing concept.
 */
export function diffPrdContent(a: PrdContent, b: PrdContent): PrdDiff {
  return {
    overviewChanged: a.overview !== b.overview,
    problemStatementChanged: a.problemStatement !== b.problemStatement,
    goals: diffStringArray(a.goals, b.goals),
    personas: diffStringArray(a.personas, b.personas),
    functionalRequirements: diffStringArray(a.functionalRequirements, b.functionalRequirements),
    nonFunctionalRequirements: diffStringArray(
      a.nonFunctionalRequirements,
      b.nonFunctionalRequirements,
    ),
    userWorkflows: diffStringArray(a.userWorkflows, b.userWorkflows),
    edgeCases: diffStringArray(a.edgeCases, b.edgeCases),
    successCriteria: diffStringArray(a.successCriteria, b.successCriteria),
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
): Promise<{ a: PrdVersion; b: PrdVersion; diff: PrdDiff }> {
  await requireOwnedProject(ownerId, projectId);
  const [a, b] = await Promise.all([
    prisma.prdVersion.findFirst({ where: { id: idA, projectId } }),
    prisma.prdVersion.findFirst({ where: { id: idB, projectId } }),
  ]);
  if (!a || !b) {
    throw AppError.notFound("PRD version not found");
  }
  const diff = diffPrdContent(a.content as PrdContent, b.content as PrdContent);
  return { a, b, diff };
}
