import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requireOwnedProject } from "../lib/ownership.js";
import * as githubClient from "../lib/githubClient.js";
import {
  decryptToken,
  encryptToken,
  isGithubIntegrationConfigured,
  lastFourOf,
} from "../lib/githubTokenCrypto.js";
import type { ConnectRepositoryInput } from "../schemas/repository.js";
import type { RepositoryConnection } from "@prisma/client";

export type SanitizedRepositoryConnection = Omit<RepositoryConnection, "encryptedToken">;

/** Never includes the encrypted token — `tokenLast4` is the only
 * token-derived value ever safe to return to a client. */
function sanitize(connection: RepositoryConnection): SanitizedRepositoryConnection {
  const { encryptedToken: _encryptedToken, ...rest } = connection;
  return rest;
}

/**
 * Confirms the project exists and belongs to `ownerId`. Throws the same 404
 * whether it doesn't exist or belongs to someone else — matches the
 * existing pattern in services/projects.ts and every other project-scoped
 * service in this codebase.
 */

async function requireConnection(projectId: string): Promise<RepositoryConnection> {
  const connection = await prisma.repositoryConnection.findUnique({ where: { projectId } });
  if (!connection) {
    throw AppError.notFound("No repository connected for this project");
  }
  return connection;
}

export async function connectRepository(
  ownerId: string,
  projectId: string,
  input: ConnectRepositoryInput,
): Promise<SanitizedRepositoryConnection> {
  await requireOwnedProject(ownerId, projectId);

  // Checked before any GitHub API call — the same "check the dependency
  // before doing any work" order every prior phase's NO_ACTIVE_* guard used.
  if (!isGithubIntegrationConfigured()) {
    throw new AppError(
      503,
      "GITHUB_INTEGRATION_NOT_CONFIGURED",
      "GitHub integration is not configured. Set GITHUB_TOKEN_ENCRYPTION_KEY in the API " +
        "environment to enable connecting a repository.",
    );
  }

  // Real GitHub calls, never fabricated. If either throws (invalid token,
  // repository not found, insufficient permissions, rate limited, network
  // failure), nothing is persisted — there is no partial/garbage row.
  const account = await githubClient.getAuthenticatedUser(input.token);
  const repository = await githubClient.getRepository(input.token, input.owner, input.repo);

  const connection = await prisma.repositoryConnection.upsert({
    where: { projectId },
    create: {
      projectId,
      githubOwner: input.owner,
      githubRepo: input.repo,
      githubRepoId: String(repository.id),
      githubAccountLogin: account.login,
      repositoryUrl: repository.htmlUrl,
      defaultBranch: repository.defaultBranch,
      selectedBranch: repository.defaultBranch,
      status: "verified",
      lastVerifiedAt: new Date(),
      lastError: null,
      encryptedToken: encryptToken(input.token),
      tokenLast4: lastFourOf(input.token),
    },
    update: {
      githubOwner: input.owner,
      githubRepo: input.repo,
      githubRepoId: String(repository.id),
      githubAccountLogin: account.login,
      repositoryUrl: repository.htmlUrl,
      defaultBranch: repository.defaultBranch,
      selectedBranch: repository.defaultBranch,
      status: "verified",
      lastVerifiedAt: new Date(),
      lastError: null,
      encryptedToken: encryptToken(input.token),
      tokenLast4: lastFourOf(input.token),
    },
  });

  return sanitize(connection);
}

export async function getConnection(
  ownerId: string,
  projectId: string,
): Promise<SanitizedRepositoryConnection | null> {
  await requireOwnedProject(ownerId, projectId);
  const connection = await prisma.repositoryConnection.findUnique({ where: { projectId } });
  return connection ? sanitize(connection) : null;
}

export async function verifyAccess(
  ownerId: string,
  projectId: string,
): Promise<SanitizedRepositoryConnection> {
  await requireOwnedProject(ownerId, projectId);
  const existing = await requireConnection(projectId);

  const token = decryptToken(existing.encryptedToken);

  try {
    const account = await githubClient.getAuthenticatedUser(token);
    const repository = await githubClient.getRepository(token, existing.githubOwner, existing.githubRepo);

    const updated = await prisma.repositoryConnection.update({
      where: { projectId },
      data: {
        githubRepoId: String(repository.id),
        githubAccountLogin: account.login,
        repositoryUrl: repository.htmlUrl,
        defaultBranch: repository.defaultBranch,
        status: "verified",
        lastVerifiedAt: new Date(),
        lastError: null,
      },
    });
    return sanitize(updated);
  } catch (err) {
    // Persist the degraded state so a subsequent GET reflects "last
    // verification status" without requiring another reverify call — then
    // rethrow so the caller gets the real HTTP status for *this* request.
    const message = err instanceof AppError ? err.message : "Verification failed.";
    await prisma.repositoryConnection.update({
      where: { projectId },
      data: { status: "error", lastError: message },
    });
    throw err;
  }
}

export async function listBranches(
  ownerId: string,
  projectId: string,
): Promise<githubClient.GithubBranch[]> {
  await requireOwnedProject(ownerId, projectId);
  const connection = await requireConnection(projectId);
  const token = decryptToken(connection.encryptedToken);
  return githubClient.listBranches(token, connection.githubOwner, connection.githubRepo);
}

export async function updateBranch(
  ownerId: string,
  projectId: string,
  branch: string,
): Promise<SanitizedRepositoryConnection> {
  await requireOwnedProject(ownerId, projectId);
  const connection = await requireConnection(projectId);
  const token = decryptToken(connection.encryptedToken);

  const branches = await githubClient.listBranches(token, connection.githubOwner, connection.githubRepo);
  if (!branches.some((b) => b.name === branch)) {
    throw new AppError(400, "GITHUB_INVALID_BRANCH", `Branch "${branch}" does not exist in this repository.`);
  }

  const updated = await prisma.repositoryConnection.update({
    where: { projectId },
    data: { selectedBranch: branch },
  });
  return sanitize(updated);
}

export async function disconnectRepository(ownerId: string, projectId: string): Promise<void> {
  await requireOwnedProject(ownerId, projectId);
  await requireConnection(projectId);
  await prisma.repositoryConnection.delete({ where: { projectId } });
}
