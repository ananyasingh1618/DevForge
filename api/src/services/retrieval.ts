import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import * as githubClient from "../lib/githubClient.js";
import { decryptToken, isGithubIntegrationConfigured } from "../lib/githubTokenCrypto.js";
import { generateEmbeddingsViaAiService } from "../lib/aiServiceClient.js";
import { chunkFile } from "../lib/chunking.js";
import { cosineSimilarity } from "../lib/similarity.js";
import type { SearchRequestInput } from "../schemas/retrieval.js";

export type SearchResult = {
  chunkId: string;
  filePath: string;
  symbolName: string | null;
  symbolType: string | null;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  branch: string;
  commitSha: string;
  score: number;
};

async function requireOwnedProject(ownerId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId } });
  if (!project) {
    throw AppError.notFound("Project not found");
  }
  return project;
}

/**
 * Fetches each parsed file's content from GitHub and chunks it (Milestone
 * 3's pure chunkFile()), then persists the results with
 * `skipDuplicates: true` — a chunk with the same (index, commit,
 * contentHash) as one already persisted (e.g. from a concurrent request, or
 * because two files produced byte-identical chunk text) is silently
 * deduplicated rather than erroring the whole batch.
 */
async function buildChunksForIndex(
  codebaseIndexId: string,
  projectId: string,
  branch: string,
  commitSha: string,
  token: string,
  owner: string,
  repo: string,
): Promise<void> {
  const files = await prisma.indexedFile.findMany({
    where: { indexId: codebaseIndexId, parseStatus: "parsed" },
    include: { symbols: true },
  });

  const rows: {
    id: string;
    projectId: string;
    codebaseIndexId: string;
    fileId: string;
    symbolId: string | null;
    branch: string;
    commitSha: string;
    chunkIndex: number;
    content: string;
    contentHash: string;
    language: string;
    startLine: number;
    endLine: number;
  }[] = [];

  for (const file of files) {
    const content = await githubClient.getBlob(token, owner, repo, file.contentHash);
    const chunks = chunkFile({
      fileId: file.id,
      content,
      language: file.language ?? "unknown",
      symbols: file.symbols.map((s) => ({ id: s.id, startLine: s.startLine, endLine: s.endLine })),
    });
    for (const chunk of chunks) {
      rows.push({
        id: randomUUID(),
        projectId,
        codebaseIndexId,
        fileId: chunk.fileId,
        symbolId: chunk.symbolId,
        branch,
        commitSha,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        contentHash: chunk.contentHash,
        language: chunk.language,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      });
    }
  }

  if (rows.length > 0) {
    await prisma.codeChunk.createMany({ data: rows, skipDuplicates: true });
  }
}

const EMBED_BATCH_SIZE = 32;

/** Embeds every chunk (for this index/commit) that doesn't already have an
 * embedding for the given model, in fixed-size batches to keep any single
 * ai-service request reasonably sized. */
async function ensureEmbeddings(codebaseIndexId: string, commitSha: string): Promise<string> {
  const chunksNeedingEmbeddings = await prisma.codeChunk.findMany({
    where: {
      codebaseIndexId,
      commitSha,
      embeddings: { none: {} },
    },
    select: { id: true, content: true },
  });

  let model = "voyage-code-3";
  for (let i = 0; i < chunksNeedingEmbeddings.length; i += EMBED_BATCH_SIZE) {
    const batch = chunksNeedingEmbeddings.slice(i, i + EMBED_BATCH_SIZE);
    const result = await generateEmbeddingsViaAiService(
      batch.map((c) => c.content),
      "document",
    );
    model = result.model;
    await prisma.embedding.createMany({
      data: batch.map((chunk, idx) => ({
        id: randomUUID(),
        chunkId: chunk.id,
        model: result.model,
        dimensions: result.dimensions,
        vector: result.embeddings[idx] ?? [],
      })),
      skipDuplicates: true,
    });
  }

  return model;
}

export async function search(
  ownerId: string,
  projectId: string,
  input: SearchRequestInput,
): Promise<SearchResult[]> {
  await requireOwnedProject(ownerId, projectId);

  const index = await prisma.codebaseIndex.findUnique({ where: { projectId } });
  if (!index || index.status !== "completed" || !index.commitSha) {
    throw new AppError(
      400,
      "NO_COMPLETED_INDEX",
      "Connect a repository and complete indexing before searching.",
    );
  }

  if (
    (input.branch !== undefined && input.branch !== index.branch) ||
    (input.commit !== undefined && input.commit !== index.commitSha)
  ) {
    throw new AppError(
      400,
      "INDEX_COMMIT_MISMATCH",
      `The current index is for branch "${index.branch}" at commit "${index.commitSha}". ` +
        "Reindex to search a different branch or commit.",
    );
  }

  const connection = await prisma.repositoryConnection.findUnique({
    where: { projectId },
  });
  if (!connection) {
    throw new AppError(
      400,
      "NO_COMPLETED_INDEX",
      "Connect a repository and complete indexing before searching.",
    );
  }
  if (!isGithubIntegrationConfigured()) {
    throw new AppError(
      503,
      "GITHUB_INTEGRATION_NOT_CONFIGURED",
      "GitHub integration is not configured. Set GITHUB_TOKEN_ENCRYPTION_KEY in the API " +
        "environment to enable search.",
    );
  }

  const existingChunkCount = await prisma.codeChunk.count({
    where: { codebaseIndexId: index.id, commitSha: index.commitSha },
  });
  if (existingChunkCount === 0) {
    const token = decryptToken(connection.encryptedToken);
    await buildChunksForIndex(
      index.id,
      projectId,
      index.branch,
      index.commitSha,
      token,
      connection.githubOwner,
      connection.githubRepo,
    );
  }

  const model = await ensureEmbeddings(index.id, index.commitSha);

  const queryEmbedding = await generateEmbeddingsViaAiService([input.query], "query");
  const queryVector = queryEmbedding.embeddings[0];
  if (!queryVector) {
    throw new AppError(502, "EMBEDDING_SERVICE_ERROR", "The embedding provider returned no vector for the query.");
  }

  const chunksWithEmbeddings = await prisma.codeChunk.findMany({
    where: { codebaseIndexId: index.id, commitSha: index.commitSha },
    include: {
      embeddings: { where: { model } },
      file: { select: { path: true } },
      symbol: { select: { name: true, type: true } },
    },
  });

  const scored = chunksWithEmbeddings
    .map((chunk) => {
      const embedding = chunk.embeddings[0];
      if (!embedding) return null;
      return {
        chunkId: chunk.id,
        filePath: chunk.file.path,
        symbolName: chunk.symbol?.name ?? null,
        symbolType: chunk.symbol?.type ?? null,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        language: chunk.language,
        branch: chunk.branch,
        commitSha: chunk.commitSha,
        score: cosineSimilarity(queryVector, embedding.vector),
      };
    })
    .filter((r): r is SearchResult => r !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit);

  return scored;
}
