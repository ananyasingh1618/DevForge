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
import { applyIntentRerank, areLinked, buildReferenceGraph } from "../lib/rerank.js";
import { negatedClauseText } from "../lib/queryIntent.js";
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

// Lowered from 32 after a real, live failure: a genuine free-tier Voyage
// account (no payment method on file) caps requests at 10,000 tokens/minute
// as well as 3 requests/minute. A real batch of 32 chunks (each up to
// chunking.ts's MAX_CHUNK_CHARS=4000) from this project's own codebase
// measured ~32,000 characters (~8,000-10,000 tokens) — right at that cap,
// so the request was rejected outright, and no amount of the embedding
// provider's own retry/backoff (app/agents/embeddings/provider.py) could
// fix it, since the request itself, not the timing, was the problem. 8
// keeps a typical real batch comfortably under a quarter of that limit
// even if every chunk in it happens to be near the max size.
const EMBED_BATCH_SIZE = 8;

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

  // Fails fast (a single small embedding call) on a missing/unreachable
  // embedding provider *before* the expensive chunk-building pass below —
  // found live: on a real ~500-file repository's first search, an unset
  // VOYAGE_API_KEY was previously only discovered after ~150s of chunk
  // building (which re-fetches every file's content from GitHub, since raw
  // content is never persisted — see buildChunksForIndex), because this
  // same query-embedding call used to happen only after that pass. Reusing
  // its result below means real, configured runs pay no extra cost at
  // all — this is a reordering, not a new call.
  const queryEmbedding = await generateEmbeddingsViaAiService([input.query], "query");
  const queryVector = queryEmbedding.embeddings[0];
  if (!queryVector) {
    throw new AppError(502, "EMBEDDING_SERVICE_ERROR", "The embedding provider returned no vector for the query.");
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

  // Embedding-based negation suppression (rerank.ts's NEGATED_SEMANTIC_PENALTY)
  // — one extra real embedding call, only when the query itself contains a
  // detected negation cue (the large majority of queries have none, so this
  // stays a no-op call-count-wise for them). Computed once here (not per
  // candidate) and compared locally against each candidate's already-
  // fetched embedding vector below — no second per-candidate provider call.
  const negClauseText = negatedClauseText(input.query);
  let negClauseVector: number[] | null = null;
  if (negClauseText) {
    const negEmbedding = await generateEmbeddingsViaAiService([negClauseText], "query");
    negClauseVector = negEmbedding.embeddings[0] ?? null;
  }

  const chunksWithEmbeddings = await prisma.codeChunk.findMany({
    where: { codebaseIndexId: index.id, commitSha: index.commitSha },
    include: {
      embeddings: { where: { model } },
      file: { select: { path: true } },
      symbol: { select: { name: true, type: true } },
    },
  });

  const negatedSimilarityByChunkId = new Map<string, number>();
  const scored = chunksWithEmbeddings
    .map((chunk) => {
      const embedding = chunk.embeddings[0];
      if (!embedding) return null;
      if (negClauseVector) {
        negatedSimilarityByChunkId.set(chunk.id, Math.max(0, cosineSimilarity(negClauseVector, embedding.vector)));
      }
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

  const results = selectRankedResults(input.query, scored, input.limit, negatedSimilarityByChunkId);

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
 * before/after table this value was chosen from.
 *
 * Tightened again, 0.78 → 0.82, in the retrieval-target-closure
 * architecture's real-local-embedding-model third pass
 * (docs/RETRIEVAL_ARCHITECTURE_MAXIMUM_UPGRADE.md): once recall@K/MRR were
 * decoupled from this cutoff entirely (they're now measured against the
 * uncut top-K ranking, not the selected/returned set — see
 * retrieval.test.ts and evaluation's own retrievalEvaluator.ts for the
 * full rationale), tightening this value no longer costs any recall at
 * all, only reduces useful-context-diluting padding. Re-swept and
 * re-verified directly against every `QA_CASES` case's required-evidence
 * chunk (not just the retrieval-only benchmark) at each candidate value:
 * 0.82 is the highest value confirmed to add zero new grounding-safety
 * gaps; 0.85 reintroduces the exact historical `qa-notification-failures`
 * fragility this file's own git history already documents (see
 * docs/RETRIEVAL_QUALITY_PHASE_PLAN.md's "Q&A invalid-citation rate"
 * section) — treated as a hard blocker, the same way `INCOHERENCE_STRICTNESS`
 * below was, rather than a metric to trade away. */
export const RELATIVE_SCORE_CUTOFF = 0.82;

/**
 * A candidate that shares neither the top-ranked candidate's top-level
 * directory nor a detected call/import reference to (or from) it is
 * treated as structurally *incoherent* with the top match, and must clear
 * a stricter bar to survive the cutoff — this is the direct architectural
 * fix for the useful-context-rate gap documented in
 * docs/RETRIEVAL_TARGET_CLOSURE_PROGRESS.md: real diagnostic data showed
 * the single relative-to-top ratio cutoff cannot distinguish "several
 * genuinely-related candidates whose scores decay gradually because they
 * really are all part of one coherent answer" (e.g. several methods of the
 * same service) from "several topically-adjacent-but-irrelevant candidates
 * whose scores decay just as gradually purely because a small fixture's
 * vocabulary overlaps" — both produce the same smooth score curve, so no
 * fixed ratio threshold can cut one shape without also cutting the other.
 * Structural coherence (same directory, or an actual detected reference)
 * is a signal the score curve alone doesn't carry. Deliberately a *bonus
 * removed*, not a penalty applied beyond the baseline — a candidate that
 * already has strong enough independent signal to clear the standard bar
 * is never blocked by this; only a candidate that was merely riding the
 * baseline bar on topical-adjacency noise loses that ride.
 *
 * A first sweep against the retrieval-only 67-case benchmark alone found
 * useful-context-rate climbing all the way to a 1.6 plateau with no
 * apparent cost. That measurement was incomplete: re-run against the
 * Q&A and code-review cases too (whose questions/scopes are worded very
 * differently from the tight retrieval-case queries, and share this same
 * rankChunks()), values above ~1.15 started silently dropping required
 * grounding evidence entirely out of the ranked pool in cases the
 * retrieval-only benchmark never exercised (e.g. a top-ranked candidate
 * that is itself a pre-existing ranking mistake, with the actually-correct
 * answer sitting in a different directory — the coherence check then
 * compounds that one mistake into a second one by cutting the correct
 * answer too). 1.15 was, at the time, the highest value confirmed safe
 * against every QA/review case's required evidence.
 *
 * Re-swept in the retrieval-target-closure architecture's real-local-
 * embedding-model third pass (docs/RETRIEVAL_ARCHITECTURE_MAXIMUM_UPGRADE.md):
 * with a real embedding model (rather than the character-n-gram mock this
 * constant was originally tuned against), the 1.6 plateau this comment
 * already documented turns out to be genuinely safe — directly re-verified
 * against every `QA_CASES` required-evidence chunk again, zero breaks up
 * to and including values far beyond 1.6 (tested to 5.0). Set to 1.6 (the
 * exact plateau value, not pushed further once no additional useful-
 * context-rate gain was measured past it) rather than re-litigated from
 * scratch, since it's the same number this comment's own prior sweep
 * already identified as the retrieval-only ceiling — what changed is that
 * the grounding-safety caveat that blocked it no longer holds under the
 * new embedding model. See docs/RETRIEVAL_ARCHITECTURE_MAXIMUM_UPGRADE.md
 * for the full re-sweep.
 */
const INCOHERENCE_STRICTNESS = 1.6;

function topLevelDirectory(filePath: string): string {
  const idx = filePath.indexOf("/");
  return idx === -1 ? "" : filePath.slice(0, idx);
}

/** Re-ranks by the hybrid combined score (semantic dominant, refined by
 * lexical/identifier/file-path signals — see hybridScore.ts), applies
 * intent-aware reranking (rerank.ts), then applies a coherence-aware
 * adaptive cutoff. Exported and separately
 * unit-testable so this selection logic doesn't require a database or a
 * real embedding call to verify.
 *
 * Stages, each independently documented at its own definition:
 * 1. Base hybrid scoring (`computeScoreSignals`/`combinedScore`).
 * 2. Cutoff-basis desensitization to the binary exact-identifier signal
 *    (Part A, Milestone A3/A4 — docs/RETRIEVAL_TARGET_CLOSURE_REPORT.md,
 *    "Case 3") — a query naming one candidate's identifier verbatim must
 *    not inflate the bar every *other* candidate has to clear.
 * 3. Intent-aware reranking (`applyIntentRerank` — rerank.ts): a small,
 *    query-wording-driven, content-derived bonus for candidates that
 *    structurally match what kind of answer the query is actually asking
 *    for (the public entry point, the orchestrating function, the
 *    imported/called dependency, etc.) — signals no single per-candidate
 *    score can express, since they depend on relationships *between*
 *    candidates in the pool.
 * 4. Coherence-aware adaptive cutoff (`INCOHERENCE_STRICTNESS` above): a
 *    per-candidate effective threshold, not one global threshold — a
 *    candidate structurally disconnected from the top match faces a
 *    stricter bar than one that shares its directory or is linked to it
 *    by a real detected reference.
 *
 * Ranking order itself only changes where a stage above provides a real,
 * general, content-derived reason to change it — never a benchmark-
 * specific lookup.
 *
 * `negatedSimilarityByChunkId` (optional) carries each candidate's cosine
 * similarity against the query's own negated-clause text, when one was
 * detected and embedded by the caller (`search()`, which has embedding
 * provider access this function deliberately doesn't) — see rerank.ts's
 * `NEGATED_SEMANTIC_PENALTY` for the full rationale. Omitted entirely by
 * every existing caller/test that doesn't need it, in which case it's a
 * pure no-op. */
export function selectRankedResults(
  query: string,
  candidates: SearchResult[],
  limit: number,
  negatedSimilarityByChunkId?: Map<string, number>,
): SearchResult[] {
  if (candidates.length === 0) return [];

  const withCombined = candidates.map((c) => {
    const signals = computeScoreSignals(query, c.score, {
      content: c.content,
      symbolName: c.symbolName,
      filePath: c.filePath,
    });
    const combined = combinedScore(signals);
    const cutoffBasis = combined - HYBRID_WEIGHTS.exactIdentifier * signals.exactIdentifierScore;
    const negatedSimilarity = negatedSimilarityByChunkId?.get(c.chunkId) ?? 0;
    return { chunkId: c.chunkId, symbolName: c.symbolName, filePath: c.filePath, content: c.content, result: c, combined, cutoffBasis, signals, negatedSimilarity };
  });

  const reranked = applyIntentRerank(query, withCombined);
  reranked.sort((a, b) => b.adjustedScore - a.adjustedScore);

  const topAdjustedCutoffBasis = Math.max(...reranked.map((c) => c.adjustedCutoffBasis));
  const baseThreshold = topAdjustedCutoffBasis * RELATIVE_SCORE_CUTOFF;

  const referenceGraph = buildReferenceGraph(reranked);
  const top = reranked[0]!;

  const selected: SearchResult[] = [];
  for (const candidate of reranked) {
    if (selected.length >= limit) break;
    if (selected.length === 0) {
      selected.push(candidate.result);
      continue;
    }
    const coherent =
      topLevelDirectory(candidate.filePath) === topLevelDirectory(top.filePath) ||
      areLinked(referenceGraph, candidate.chunkId, top.chunkId);
    const effectiveThreshold = coherent ? baseThreshold : baseThreshold * INCOHERENCE_STRICTNESS;
    if (candidate.adjustedScore < effectiveThreshold) continue;
    selected.push(candidate.result);
  }
  return selected;
}
