import { prisma } from "./prisma.js";
import { AppError } from "./errors.js";
import { logAuditEvent } from "./auditLog.js";

/**
 * The single ownership predicate every project-scoped service function
 * calls before touching that project's data. Centralized here (Phase 16,
 * Milestone 16.2) after an 11-file audit found this exact function
 * independently copy-pasted, byte-for-byte identical, into every service
 * module — a consistency risk as more resource types are added, since a
 * future copy could silently drift (e.g. someone "fixing" one copy without
 * updating the other ten). Behavior is unchanged: throws AppError.notFound()
 * (404, never 403) so a caller can never distinguish "no such project" from
 * "a project that exists but belongs to someone else" through the response.
 *
 * Milestone 16.5 added the audit-log call on the failure path. This
 * deliberately does not run a second query to distinguish "no such
 * project at all" from "a project that exists but belongs to someone
 * else" — that would double the query cost of the single most-frequently-
 * called check in the whole API purely for log-labeling purposes. Either
 * way the signal an investigator needs is the same: this user attempted
 * to access this project id and was denied.
 */
export async function requireOwnedProject(ownerId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId } });
  if (!project) {
    logAuditEvent({ event: "ownership.denied", userId: ownerId, projectId });
    throw AppError.notFound("Project not found");
  }
  return project;
}
