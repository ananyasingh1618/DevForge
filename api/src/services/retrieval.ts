import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requireOwnedProject } from "../lib/ownership.js";
import * as githubClient from "../lib/githubClient.js";
import { decryptToken, isGithubIntegrationConfigured } from "../lib/githubTokenCrypto.js";
import { generateEmbeddingsViaAiService } from "../lib/aiServiceClient.js";
import { chunkFile } from "../lib/chunking.js";
import { cosineSimilarity } from "../lib/similarity.js";
import { combinedScore, computeScoreSignals, HYBRID_WEIGHTS } from "../lib/hybridScore.js";
import { redactSecrets } from "../lib/secretRedaction.js";
import { buildSearchObservabilityEvent, logSearchObservability } from "../lib/searchObservability.js";
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
      // Redact high-confidence secret shapes before this chunk is ever
      // persisted, embedded, or sent to an LLM prompt — see
      // lib/secretRedaction.ts. Applied here, once, at index time, so every
      // downstream reader of CodeChunk.content (search results, Q&A
      // sources, review sources, embeddings) sees the same redacted text.
      const redactedContent = redactSecrets(chunk.content);
      rows.push({
        id: randomUUID(),
        projectId,
        codebaseIndexId,
        fileId: chunk.fileId,
        symbolId: chunk.symbolId,
        branch,
        commitSha,
        chunkIndex: chunk.chunkIndex,
        content: redactedContent,
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
  const searchStartedAt = Date.now();
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
        // The publicly-returned `score` field is, and stays, pure cosine
        // similarity — every existing caller/test depends on that exact
        // meaning (see docs/RETRIEVAL_QUALITY_PHASE_PLAN.md). Hybrid
        // signals (lexical/identifier/file-path) are computed separately,
        // purely to decide selection/ordering below.
        score: cosineSimilarity(queryVector, embedding.vector),
      };
    })
    .filter((r): r is SearchResult => r !== null);

  const results = selectRankedResults(input.query, scored, input.limit);

  // Observability (Phase 14, Milestone 14.5) — a single bounded, secret-
  // free structured log line per search request. Never logs the query
  // text, chunk content, or file paths — see searchObservability.ts's own
  // header comment for exactly what is and isn't included.
  const candidateSummaries = scored.map((c) => {
    const signals = computeScoreSignals(input.query, c.score, { content: c.content, symbolName: c.symbolName, filePath: c.filePath });
    return { semanticScore: signals.semanticScore, lexicalScore: signals.lexicalScore, combined: combinedScore(signals) };
  });
  const topCombined = candidateSummaries.length > 0 ? Math.max(...candidateSummaries.map((c) => c.combined)) : 0;
  logSearchObservability(
    buildSearchObservabilityEvent({
      query: input.query,
      candidates: candidateSummaries,
      finalResultCount: results.length,
      cutoffThreshold: topCombined * RELATIVE_SCORE_CUTOFF,
      latencyMs: Date.now() - searchStartedAt,
      indexBranch: index.branch,
      indexCommitSha: index.commitSha,
      indexCompletedAt: index.completedAt,
      indexFailedFileCount: index.failedFileCount,
    }),
  );

  return results;
}

/** Relative-to-top cutoff: a candidate is kept only while its combined
 * (semantic + lexical + identifier + file-path) score is within this
 * fraction of the top-ranked candidate's own combined score, capped at
 * `limit`. This is the direct fix for the precision-ceiling problem
 * documented in docs/RETRIEVAL_QUALITY_PHASE_PLAN.md ("Root-cause
 * analysis"): search() previously always returned exactly `limit` results
 * even when only one or two chunks were genuinely relevant, padding every
 * response with low-confidence noise. The always-keep-the-top-result rule
 * below means a genuinely irrelevant query never returns literally nothing
 * when at least one chunk exists — an honestly-empty result (no chunks at
 * all) is unaffected and unchanged.
 *
 * Tightened 0.7 → 0.78 in Phase 14 (docs/RETRIEVAL_QUALITY_PHASE_PLAN.md's
 * Phase 14 addendum, Milestone 14.2): re-measured against Phase 13's
 * larger, 67-case benchmark via evaluation/src/comparison/
 * rankingStrategyComparison.ts, 0.78 is a strict improvement over 0.7 on
 * every measured axis — precision@K and useful-context-rate both rise
 * substantially while recall@K and mean reciprocal rank are unchanged (the
 * handful of cases 0.7 already missed entirely were missing from the
 * ranked pool outright, not merely cut by the cutoff, so tightening it
 * costs nothing there). General and query-independent, never keyed to a
 * specific query or chunk id — see that comparison's own persisted report
 * (evaluation/reports/ranking-comparison.md) for the full six-strategy
 * before/after table this value was chosen from. */
export const RELATIVE_SCORE_CUTOFF = 0.78;

/** Re-ranks by the hybrid combined score (semantic dominant, refined by
 * lexical/identifier/file-path signals) and applies the adaptive cutoff
 * above. Exported and separately unit-testable so this selection logic
 * doesn't require a database or a real embedding call to verify.
 *
 * The cutoff threshold's *reference point* (Part A, Milestone A3/A4 —
 * see docs/RETRIEVAL_TARGET_CLOSURE_REPORT.md, "Case 3") is each
 * candidate's combined score with the binary exact-identifier jackpot
 * subtracted back out, not the raw top combined score. Root-caused via a
 * real failing case: when a query names one candidate's identifier
 * verbatim (e.g. asking about `removeFromCart` when the real target is
 * the function it delegates to), that one candidate's exact-match bonus
 * alone can make its score an outlier well above the general relevance
 * ceiling — since the threshold is `topScore * RELATIVE_SCORE_CUTOFF`,
 * one candidate's jackpot was unfairly raising the bar every *other*
 * candidate had to clear, even a clearly-relevant runner-up. Ranking
 * order is unaffected (an exact match still deserves to rank first) —
 * only the cutoff's own reference point is desensitized to this one
 * binary signal. */
export function selectRankedResults(query: string, candidates: SearchResult[], limit: number): SearchResult[] {
  if (candidates.length === 0) return [];

  const withCombined = candidates.map((c) => {
    const signals = computeScoreSignals(query, c.score, {
      content: c.content,
      symbolName: c.symbolName,
      filePath: c.filePath,
    });
    const combined = combinedScore(signals);
    const cutoffBasis = combined - HYBRID_WEIGHTS.exactIdentifier * signals.exactIdentifierScore;
    return { result: c, combined, cutoffBasis };
  });

  withCombined.sort((a, b) => b.combined - a.combined);

  const topCutoffBasis = Math.max(...withCombined.map((c) => c.cutoffBasis));
  const threshold = topCutoffBasis * RELATIVE_SCORE_CUTOFF;

  const selected: SearchResult[] = [];
  for (const { result, combined } of withCombined) {
    if (selected.length >= limit) break;
    if (selected.length > 0 && combined < threshold) break;
    selected.push(result);
  }
  return selected;
}
