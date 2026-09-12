import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { generateTasksViaAiService } from "../lib/aiServiceClient.js";
import type { TaskContent, TaskItem } from "../schemas/tasks.js";
import type { EpicContent } from "../schemas/epics.js";
import type { TaskVersion } from "@prisma/client";

/**
 * Confirms the project exists and belongs to `ownerId`. Throws the same 404
 * whether it doesn't exist or belongs to someone else — matches the
 * existing pattern in services/projects.ts, services/prd.ts,
 * services/architecture.ts, and services/epics.ts.
 */
async function requireOwnedProject(ownerId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId } });
  if (!project) {
    throw AppError.notFound("Project not found");
  }
  return project;
}

export async function generateTasksFromActiveEpics(
  ownerId: string,
  projectId: string,
): Promise<TaskVersion> {
  await requireOwnedProject(ownerId, projectId);

  // "No active epics" is exactly "no epic versions exist" —
  // generateEpicsFromActiveArchitecture/activateVersion already guarantee
  // at most one active version whenever any exist (see services/epics.ts),
  // and there is no epic-deletion endpoint.
  const activeEpics = await prisma.epicVersion.findFirst({
    where: { projectId, isActive: true },
  });
  if (!activeEpics) {
    throw new AppError(
      400,
      "NO_ACTIVE_EPICS",
      "Generate and activate an epic version before generating tasks.",
    );
  }

  // Calls the AI service before touching the database. If this throws
  // (provider not configured, unreachable, invalid response), nothing is
  // persisted — there is no partial/garbage version row.
  const content = await generateTasksViaAiService(activeEpics.content as EpicContent);

  return prisma.$transaction(async (tx) => {
    const latest = await tx.taskVersion.findFirst({
      where: { projectId },
      orderBy: { version: "desc" },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    await tx.taskVersion.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    });

    return tx.taskVersion.create({
      data: {
        projectId,
        version: nextVersion,
        sourceEpicVersionId: activeEpics.id,
        content,
        isActive: true,
      },
    });
  });
}

export async function listVersions(ownerId: string, projectId: string): Promise<TaskVersion[]> {
  await requireOwnedProject(ownerId, projectId);
  return prisma.taskVersion.findMany({
    where: { projectId },
    orderBy: { version: "desc" },
  });
}

export async function getVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
): Promise<TaskVersion> {
  await requireOwnedProject(ownerId, projectId);
  const version = await prisma.taskVersion.findFirst({ where: { id: versionId, projectId } });
  if (!version) {
    throw AppError.notFound("Task version not found");
  }
  return version;
}

export async function updateVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
  content: TaskContent,
): Promise<TaskVersion> {
  await getVersion(ownerId, projectId, versionId);
  return prisma.taskVersion.update({
    where: { id: versionId },
    data: { content },
  });
}

export async function activateVersion(
  ownerId: string,
  projectId: string,
  versionId: string,
): Promise<TaskVersion> {
  await getVersion(ownerId, projectId, versionId);
  return prisma.$transaction(async (tx) => {
    await tx.taskVersion.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    });
    return tx.taskVersion.update({
      where: { id: versionId },
      data: { isActive: true },
    });
  });
}

type ItemDiffEntry = { id: string; title: string };
type ItemDiff = { added: ItemDiffEntry[]; removed: ItemDiffEntry[]; changed: string[] };

export type TaskDiff = { tasks: ItemDiff };

/**
 * Id-matched item-list diff, the same shape/logic services/epics.ts's
 * diffEpicItems and services/requirements.ts's diffRequirementItems use.
 */
function diffTaskItems(a: TaskItem[], b: TaskItem[]): ItemDiff {
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

export function diffTaskContent(a: TaskContent, b: TaskContent): TaskDiff {
  return { tasks: diffTaskItems(a.tasks, b.tasks) };
}

export async function compareVersions(
  ownerId: string,
  projectId: string,
  idA: string,
  idB: string,
): Promise<{ a: TaskVersion; b: TaskVersion; diff: TaskDiff }> {
  await requireOwnedProject(ownerId, projectId);
  const [a, b] = await Promise.all([
    prisma.taskVersion.findFirst({ where: { id: idA, projectId } }),
    prisma.taskVersion.findFirst({ where: { id: idB, projectId } }),
  ]);
  if (!a || !b) {
    throw AppError.notFound("Task version not found");
  }
  const diff = diffTaskContent(a.content as TaskContent, b.content as TaskContent);
  return { a, b, diff };
}
