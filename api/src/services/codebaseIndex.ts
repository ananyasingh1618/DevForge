import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import * as githubClient from "../lib/githubClient.js";
import { decryptToken, isGithubIntegrationConfigured } from "../lib/githubTokenCrypto.js";
import { parseFileViaAiService, type ParsedFile } from "../lib/aiServiceClient.js";
import type { CodebaseIndex, FileParseStatus, IndexedFile, RepositoryConnection, Symbol } from "@prisma/client";

/** Bounds a single synchronous indexing request — no background job queue
 * exists anywhere in this codebase (see docs/CODEBASE_INDEX_PHASE_PLAN.md).
 * Exported so tests can assert against the real limit instead of a
 * duplicated literal. */
export const MAX_INDEXED_FILES = 500;
export const MAX_FILE_SIZE_BYTES = 300 * 1024;

const SKIP_DIR_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "venv",
  ".venv",
  "__pycache__",
  ".tox",
  "vendor",
  "coverage",
]);

const SUPPORTED_EXTENSIONS = new Set([".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".rar",
  ".7z",
  ".pyc",
  ".class",
  ".o",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".wasm",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".pdf",
]);

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function isInSkippedDirectory(path: string): boolean {
  return path.split("/").some((segment) => SKIP_DIR_SEGMENTS.has(segment));
}

/** Confirms the project exists and belongs to `ownerId`. Throws the same 404
 * whether it doesn't exist or belongs to someone else — matches every other
 * project-scoped service in this codebase (see services/repository.ts). */
async function requireOwnedProject(ownerId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId } });
  if (!project) {
    throw AppError.notFound("Project not found");
  }
  return project;
}

async function requireIndex(projectId: string): Promise<CodebaseIndex> {
  const index = await prisma.codebaseIndex.findUnique({ where: { projectId } });
  if (!index) {
    throw new AppError(404, "CODEBASE_INDEX_NOT_FOUND", "No codebase index exists for this project yet.");
  }
  return index;
}

type CandidateFile = {
  path: string;
  sizeBytes: number;
  contentHash: string;
  parseStatus: FileParseStatus;
  parseError: string | null;
  language: string | null;
  symbols: ParsedFile["symbols"];
};

/**
 * A previously-indexed file's own content hash and (if it was successfully
 * parsed last time) reconstructed parse result, keyed by path — used by
 * buildIndex() below to skip re-fetching and re-parsing a file whose
 * content hasn't changed since the last index. See docs/
 * CODEBASE_INDEX_PHASE_PLAN.md's Phase 14 addendum for the full rationale.
 */
type PreviousFileInfo = {
  contentHash: string;
  parseStatus: FileParseStatus;
  language: string | null;
  parseError: string | null;
  symbols: ParsedFile["symbols"];
};

/**
 * Loads the current index's own most-recently-persisted files and symbols
 * (if any), reconstructing each successfully-parsed file's symbol list in
 * the exact `ParsedFile["symbols"]` shape (positional `parentIndex`, not a
 * database foreign key) by re-deriving positions from a stable,
 * deterministic ordering (startLine, then id) — the same relationships
 * `persistIndex()` will reconstruct into fresh rows either way, so this
 * round-trip never changes what a file's own parent/child symbol
 * structure means, only (harmlessly) the order same-level siblings might
 * be listed in.
 */
async function loadPreviousFiles(projectId: string): Promise<Map<string, PreviousFileInfo>> {
  const index = await prisma.codebaseIndex.findUnique({
    where: { projectId },
    include: { files: { include: { symbols: true } } },
  });
  if (!index) return new Map();

  const byPath = new Map<string, PreviousFileInfo>();
  for (const file of index.files) {
    const orderedSymbols = [...file.symbols].sort((a, b) => a.startLine - b.startLine || a.id.localeCompare(b.id));
    const idToIndex = new Map(orderedSymbols.map((s, i) => [s.id, i]));
    byPath.set(file.path, {
      contentHash: file.contentHash,
      parseStatus: file.parseStatus,
      language: file.language,
      parseError: file.parseError,
      symbols: orderedSymbols.map((s) => ({
        name: s.name,
        type: s.type,
        startLine: s.startLine,
        endLine: s.endLine,
        parentIndex: s.parentId !== null ? (idToIndex.get(s.parentId) ?? null) : null,
        signature: s.signature,
      })),
    });
  }
  return byPath;
}

/**
 * Fetches the branch's file tree and, for each candidate file, either
 * records why it was skipped or fetches and parses its content. Nothing
 * here is fabricated: a skip reason is always a real, distinct
 * FileParseStatus, and a parse result always comes from a real ai-service
 * call — never a guessed or default-successful outcome.
 *
 * Incremental (Phase 14, Milestone 14.4 — docs/CODEBASE_INDEX_PHASE_PLAN.md's
 * addendum): when a file's current blob sha exactly matches the content
 * hash it had in the index's own last completed run, and that run
 * successfully parsed it, this reuses the previous parse result instead of
 * re-fetching the blob and re-calling ai-service — real, measurable I/O
 * savings on an unchanged file. A file that previously failed to parse
 * (`parse_error`) is deliberately never cache-skipped, even if its content
 * hash is unchanged — a transient ai-service failure or a since-fixed
 * parser bug deserves a fresh attempt every time, matching the task's own
 * "retryable failures" requirement. Every other skip reason
 * (unsupported/binary/too-large/index-limit) is already a cheap,
 * no-I/O computation, so there's nothing to cache for those.
 */
async function buildIndex(
  token: string,
  owner: string,
  repo: string,
  commitSha: string,
  previousFiles: Map<string, PreviousFileInfo>,
): Promise<{ files: CandidateFile[]; truncated: boolean; reusedFileCount: number }> {
  const tree = await githubClient.getTree(token, owner, repo, commitSha);

  const blobEntries = tree.entries
    .filter((entry) => entry.type === "blob" && !isInSkippedDirectory(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path));

  const files: CandidateFile[] = [];
  let reusedFileCount = 0;

  for (let i = 0; i < blobEntries.length; i++) {
    const entry = blobEntries[i];
    if (!entry) continue;
    const sizeBytes = entry.size ?? 0;
    const base = { path: entry.path, sizeBytes, contentHash: entry.sha };

    if (i >= MAX_INDEXED_FILES) {
      files.push({ ...base, parseStatus: "skipped_index_limit", parseError: null, language: null, symbols: [] });
      continue;
    }
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      files.push({ ...base, parseStatus: "skipped_too_large", parseError: null, language: null, symbols: [] });
      continue;
    }
    if (BINARY_EXTENSIONS.has(extensionOf(entry.path))) {
      files.push({ ...base, parseStatus: "skipped_binary", parseError: null, language: null, symbols: [] });
      continue;
    }
    if (!SUPPORTED_EXTENSIONS.has(extensionOf(entry.path))) {
      files.push({ ...base, parseStatus: "unsupported", parseError: null, language: null, symbols: [] });
      continue;
    }

    const previous = previousFiles.get(entry.path);
    if (previous && previous.contentHash === entry.sha && previous.parseStatus === "parsed") {
      files.push({
        ...base,
        parseStatus: "parsed",
        parseError: null,
        language: previous.language,
        symbols: previous.symbols,
      });
      reusedFileCount++;
      continue;
    }

    const content = await githubClient.getBlob(token, owner, repo, entry.sha);
    if (content.includes("\0")) {
      files.push({ ...base, parseStatus: "skipped_binary", parseError: null, language: null, symbols: [] });
      continue;
    }

    const parsed = await parseFileViaAiService(entry.path, content);
    if (parsed.status === "parsed") {
      files.push({
        ...base,
        parseStatus: "parsed",
        parseError: null,
        language: parsed.language,
        symbols: parsed.symbols,
      });
    } else if (parsed.status === "parse_error") {
      files.push({
        ...base,
        parseStatus: "parse_error",
        parseError: parsed.error,
        language: parsed.language,
        symbols: [],
      });
    } else {
      files.push({ ...base, parseStatus: "unsupported", parseError: null, language: null, symbols: [] });
    }
  }

  return { files, truncated: tree.truncated, reusedFileCount };
}

/** Replaces an index's files/symbols wholesale in one short transaction —
 * all I/O (GitHub, ai-service) has already happened by this point, so the
 * transaction itself only does fast DB writes. */
async function persistIndex(projectId: string, truncated: boolean, files: CandidateFile[]): Promise<CodebaseIndex> {
  return prisma.$transaction(async (tx) => {
    const index = await tx.codebaseIndex.findUniqueOrThrow({ where: { projectId } });

    await tx.indexedFile.deleteMany({ where: { indexId: index.id } });

    const fileIds = files.map(() => randomUUID());
    if (files.length > 0) {
      await tx.indexedFile.createMany({
        data: files.map((f, i) => ({
          id: fileIds[i]!,
          indexId: index.id,
          path: f.path,
          language: f.language,
          sizeBytes: f.sizeBytes,
          contentHash: f.contentHash,
          parseStatus: f.parseStatus,
          parseError: f.parseError,
        })),
      });
    }

    const symbolRows: {
      id: string;
      fileId: string;
      name: string;
      type: string;
      startLine: number;
      endLine: number;
      parentId: string | null;
      signature: string | null;
    }[] = [];
    files.forEach((f, fileIndex) => {
      if (f.symbols.length === 0) return;
      const symbolIds = f.symbols.map(() => randomUUID());
      f.symbols.forEach((s, symbolIndex) => {
        symbolRows.push({
          id: symbolIds[symbolIndex]!,
          fileId: fileIds[fileIndex]!,
          name: s.name,
          type: s.type,
          startLine: s.startLine,
          endLine: s.endLine,
          parentId: s.parentIndex !== null ? (symbolIds[s.parentIndex] ?? null) : null,
          signature: s.signature,
        });
      });
    });
    if (symbolRows.length > 0) {
      await tx.symbol.createMany({ data: symbolRows });
    }

    const parsedFileCount = files.filter((f) => f.parseStatus === "parsed").length;
    const failedFileCount = files.filter((f) => f.parseStatus === "parse_error").length;

    return tx.codebaseIndex.update({
      where: { id: index.id },
      data: {
        status: "completed",
        truncated,
        fileCount: files.length,
        parsedFileCount,
        failedFileCount,
        completedAt: new Date(),
        error: null,
      },
    });
  });
}

async function runIndexingPipeline(
  projectId: string,
  connection: RepositoryConnection,
  branch: string,
  token: string,
  commitSha: string,
): Promise<CodebaseIndex> {
  await prisma.codebaseIndex.upsert({
    where: { projectId },
    create: {
      projectId,
      repositoryConnectionId: connection.id,
      branch,
      commitSha,
      status: "indexing",
      startedAt: new Date(),
    },
    update: {
      repositoryConnectionId: connection.id,
      branch,
      commitSha,
      status: "indexing",
      startedAt: new Date(),
      completedAt: null,
      error: null,
    },
  });

  try {
    const previousFiles = await loadPreviousFiles(projectId);
    const { files, truncated } = await buildIndex(
      token,
      connection.githubOwner,
      connection.githubRepo,
      commitSha,
      previousFiles,
    );
    return await persistIndex(projectId, truncated, files);
  } catch (err) {
    const message = err instanceof AppError ? err.message : "Indexing failed.";
    await prisma.codebaseIndex.update({
      where: { projectId },
      data: { status: "failed", error: message, completedAt: new Date() },
    });
    throw err;
  }
}

async function resolveConnectionAndBranch(
  ownerId: string,
  projectId: string,
): Promise<{ connection: RepositoryConnection; branch: string; token: string }> {
  await requireOwnedProject(ownerId, projectId);

  const connection = await prisma.repositoryConnection.findUnique({ where: { projectId } });
  if (!connection) {
    throw new AppError(400, "NO_REPOSITORY_CONNECTED", "Connect a GitHub repository before indexing.");
  }

  // Checked before any GitHub API call — the same "check the dependency
  // before doing any work" order services/repository.ts's connectRepository
  // already uses.
  if (!isGithubIntegrationConfigured()) {
    throw new AppError(
      503,
      "GITHUB_INTEGRATION_NOT_CONFIGURED",
      "GitHub integration is not configured. Set GITHUB_TOKEN_ENCRYPTION_KEY in the API " +
        "environment to enable codebase indexing.",
    );
  }

  const branch = connection.selectedBranch ?? connection.defaultBranch;
  if (!branch) {
    throw new AppError(
      400,
      "NO_REPOSITORY_CONNECTED",
      "No branch is selected for the connected repository. Select a branch first.",
    );
  }

  return { connection, branch, token: decryptToken(connection.encryptedToken) };
}

/**
 * Resolves the branch's current commit and either reuses the existing
 * completed index (when unchanged and `force` is false) or runs the full
 * pipeline. Persists a "failed" row even when resolving the commit itself
 * fails — not just once the pipeline's own row exists — so a subsequent GET
 * reflects a real error instead of silently looking like indexing was never
 * attempted; mirrors services/repository.ts's verifyAccess degraded-state
 * pattern.
 */
async function runOrReuse(
  projectId: string,
  connection: RepositoryConnection,
  branch: string,
  token: string,
  { force }: { force: boolean },
): Promise<CodebaseIndex> {
  const existingBefore = await prisma.codebaseIndex.findUnique({ where: { projectId } });

  let commitSha: string;
  try {
    commitSha = await githubClient.getBranchCommit(token, connection.githubOwner, connection.githubRepo, branch);
  } catch (err) {
    const message = err instanceof AppError ? err.message : "Indexing failed.";
    await prisma.codebaseIndex.upsert({
      where: { projectId },
      create: {
        projectId,
        repositoryConnectionId: connection.id,
        branch,
        status: "failed",
        error: message,
        startedAt: new Date(),
        completedAt: new Date(),
      },
      update: { repositoryConnectionId: connection.id, branch, status: "failed", error: message, completedAt: new Date() },
    });
    throw err;
  }

  if (
    !force &&
    existingBefore &&
    existingBefore.status === "completed" &&
    existingBefore.branch === branch &&
    existingBefore.commitSha === commitSha
  ) {
    return existingBefore;
  }

  return runIndexingPipeline(projectId, connection, branch, token, commitSha);
}

/**
 * Starts indexing the connected repository's selected branch. Deterministic
 * for the same commit and branch: if the current index already completed
 * for this exact (branch, commitSha), returns it unchanged rather than
 * re-fetching and re-parsing everything — see docs/CODEBASE_INDEX_PHASE_PLAN.md.
 */
export async function startIndexing(ownerId: string, projectId: string): Promise<CodebaseIndex> {
  const { connection, branch, token } = await resolveConnectionAndBranch(ownerId, projectId);
  return runOrReuse(projectId, connection, branch, token, { force: false });
}

/** Always re-runs the pipeline, even if the commit is unchanged — the whole
 * point of an explicit reindex request is "run it again." */
export async function reindexRepository(ownerId: string, projectId: string): Promise<CodebaseIndex> {
  const { connection, branch, token } = await resolveConnectionAndBranch(ownerId, projectId);
  return runOrReuse(projectId, connection, branch, token, { force: true });
}

export async function getIndex(ownerId: string, projectId: string): Promise<CodebaseIndex | null> {
  await requireOwnedProject(ownerId, projectId);
  return prisma.codebaseIndex.findUnique({ where: { projectId } });
}

export async function listFiles(ownerId: string, projectId: string): Promise<IndexedFile[]> {
  await requireOwnedProject(ownerId, projectId);
  const index = await requireIndex(projectId);
  return prisma.indexedFile.findMany({ where: { indexId: index.id }, orderBy: { path: "asc" } });
}

export async function listSymbols(ownerId: string, projectId: string, fileId: string): Promise<Symbol[]> {
  await requireOwnedProject(ownerId, projectId);
  const index = await requireIndex(projectId);
  const file = await prisma.indexedFile.findFirst({ where: { id: fileId, indexId: index.id } });
  if (!file) {
    throw AppError.notFound("File not found in this codebase index");
  }
  return prisma.symbol.findMany({ where: { fileId: file.id }, orderBy: { startLine: "asc" } });
}
