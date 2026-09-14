import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import * as retrievalService from "./retrieval.js";
import {
  analyzeReviewViaAiService,
  type ReviewSourceForProvider,
} from "../lib/aiServiceClient.js";
import { MAX_SOURCES, selectSources } from "../lib/qaSourceSelection.js";
import { filterValidFindings } from "../lib/reviewFindingFiltering.js";
import type { Prisma } from "@prisma/client";

const DEFAULT_SCOPE =
  "Perform a general code review of the indexed codebase, looking for bugs, security issues, " +
  "reliability problems, performance concerns, and maintainability issues.";

export type CodeReviewSourceResult = {
  filePath: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  score: number;
};

export type CodeReviewFindingResult = {
  id: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  confidence: string;
  recommendation: string;
  actionable: boolean;
  sources: CodeReviewSourceResult[];
};

export type CodeReviewResult = {
  reviewId: string;
  scope: string;
  status: string;
  summary: string | null;
  findingCount: number;
  findings: CodeReviewFindingResult[];
  sources: CodeReviewSourceResult[];
  branch: string;
  commit: string;
  createdAt: string;
  completedAt: string | null;
};

async function requireOwnedProject(ownerId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId } });
  if (!project) {
    throw AppError.notFound("Project not found");
  }
  return project;
}

const reviewWithDetailInclude = {
  sources: {
    include: { chunk: { include: { file: true, symbol: true } } },
    orderBy: { sourceOrder: "asc" as const },
  },
  findings: {
    include: {
      sources: {
        include: { source: { include: { chunk: { include: { file: true, symbol: true } } } } },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.CodeReviewInclude;

type ReviewWithDetail = Prisma.CodeReviewGetPayload<{ include: typeof reviewWithDetailInclude }>;

function serializeReview(review: ReviewWithDetail): CodeReviewResult {
  return {
    reviewId: review.id,
    scope: review.scope,
    status: review.status,
    summary: review.summary,
    findingCount: review.findingCount,
    findings: review.findings.map((finding) => ({
      id: finding.id,
      title: finding.title,
      description: finding.description,
      severity: finding.severity,
      category: finding.category,
      confidence: finding.confidence,
      recommendation: finding.recommendation,
      actionable: finding.actionable,
      sources: finding.sources.map((link) => ({
        filePath: link.source.chunk.file.path,
        symbolName: link.source.chunk.symbol?.name ?? null,
        startLine: link.source.chunk.startLine,
        endLine: link.source.chunk.endLine,
        score: link.source.score,
      })),
    })),
    sources: review.sources.map((source) => ({
      filePath: source.chunk.file.path,
      symbolName: source.chunk.symbol?.name ?? null,
      startLine: source.chunk.startLine,
      endLine: source.chunk.endLine,
      score: source.score,
    })),
    branch: review.branch,
    commit: review.commitSha,
    createdAt: review.createdAt.toISOString(),
    completedAt: review.completedAt ? review.completedAt.toISOString() : null,
  };
}

/**
 * Runs a code review against a project's currently indexed codebase.
 * Retrieval (Phase 8's search()) always runs first, and its real errors (no
 * completed index, branch/commit mismatch, GitHub/embedding provider not
 * configured) propagate unchanged — there is no code path here that reaches
 * the Claude call without search() having already succeeded. A genuinely
 * empty (post-dedup/cap) evidence set skips the Claude call entirely and
 * returns a real, local "no relevant code found" review, persisted the same
 * as any other. Once usable evidence exists, the CodeReview row and its
 * CodeReviewSource evidence are persisted *before* the provider call — a
 * deliberate improvement over Phase 9's Question/Answer split (see
 * docs/CODE_REVIEW_PHASE_PLAN.md) — so a provider-side failure updates a
 * real "failed" row instead of leaving an orphaned one.
 */
export async function createReview(
  ownerId: string,
  projectId: string,
  scope: string | undefined,
): Promise<CodeReviewResult> {
  await requireOwnedProject(ownerId, projectId);

  const effectiveScope = scope && scope.length > 0 ? scope : DEFAULT_SCOPE;

  const results = await retrievalService.search(ownerId, projectId, {
    query: effectiveScope,
    limit: MAX_SOURCES,
  });

  const index = await prisma.codebaseIndex.findUniqueOrThrow({ where: { projectId } });
  const connection = await prisma.repositoryConnection.findUniqueOrThrow({ where: { projectId } });
  const repository = `${connection.githubOwner}/${connection.githubRepo}`;
  const branch = index.branch;
  const commitSha = index.commitSha;
  if (!commitSha) {
    // search() already requires a non-null commitSha to have succeeded;
    // unreachable in practice, but keeps this function's types honest.
    throw new AppError(400, "NO_COMPLETED_INDEX", "Connect a repository and complete indexing before reviewing.");
  }

  const selected = selectSources(results);

  if (selected.length === 0) {
    const reviewRow = await prisma.codeReview.create({
      data: {
        projectId,
        codebaseIndexId: index.id,
        scope: effectiveScope,
        branch,
        commitSha,
        status: "completed",
        summary:
          "No relevant code was found in the indexed repository for this scope. Try " +
          "narrowing it, or naming a more specific file, function, or feature.",
        findingCount: 0,
        model: "none",
        completedAt: new Date(),
      },
    });
    return {
      reviewId: reviewRow.id,
      scope: effectiveScope,
      status: "completed",
      summary: reviewRow.summary,
      findingCount: 0,
      findings: [],
      sources: [],
      branch,
      commit: commitSha,
      createdAt: reviewRow.createdAt.toISOString(),
      completedAt: reviewRow.completedAt ? reviewRow.completedAt.toISOString() : null,
    };
  }

  const reviewRow = await prisma.codeReview.create({
    data: { projectId, codebaseIndexId: index.id, scope: effectiveScope, branch, commitSha, status: "pending" },
  });

  const sourceIds = selected.map(() => randomUUID());
  await prisma.codeReviewSource.createMany({
    data: selected.map((source, i) => ({
      id: sourceIds[i]!,
      reviewId: reviewRow.id,
      chunkId: source.chunkId,
      sourceOrder: i + 1,
      score: source.score,
    })),
  });

  const providerSources: ReviewSourceForProvider[] = selected.map((source, i) => ({
    sourceNumber: i + 1,
    path: source.filePath,
    symbolName: source.symbolName,
    startLine: source.startLine,
    endLine: source.endLine,
    content: source.content,
  }));

  let aiReview;
  try {
    aiReview = await analyzeReviewViaAiService(effectiveScope, repository, branch, commitSha, providerSources);
  } catch (err) {
    const message = err instanceof AppError ? err.message : "The AI service failed to complete this review.";
    await prisma.codeReview.update({ where: { id: reviewRow.id }, data: { status: "failed", error: message } });
    throw err;
  }

  const validFindings = filterValidFindings(aiReview.findings, selected.length);

  await prisma.$transaction(
    validFindings.map((finding) =>
      prisma.codeReviewFinding.create({
        data: {
          reviewId: reviewRow.id,
          title: finding.title,
          description: finding.description,
          severity: finding.severity,
          category: finding.category,
          confidence: finding.confidence,
          recommendation: finding.recommendation,
          sources: { create: finding.citedSourceNumbers.map((n) => ({ sourceId: sourceIds[n - 1]! })) },
        },
      }),
    ),
  );

  const completedAt = new Date();
  await prisma.codeReview.update({
    where: { id: reviewRow.id },
    data: {
      status: "completed",
      summary: aiReview.summary,
      findingCount: validFindings.length,
      model: "claude-opus-5",
      completedAt,
    },
  });

  const full = await prisma.codeReview.findUniqueOrThrow({
    where: { id: reviewRow.id },
    include: reviewWithDetailInclude,
  });
  return serializeReview(full);
}

export async function listReviews(ownerId: string, projectId: string): Promise<CodeReviewResult[]> {
  await requireOwnedProject(ownerId, projectId);
  const reviews = await prisma.codeReview.findMany({
    where: { projectId },
    include: reviewWithDetailInclude,
    orderBy: { createdAt: "desc" },
  });
  return reviews.map(serializeReview);
}

export async function getReview(
  ownerId: string,
  projectId: string,
  reviewId: string,
): Promise<CodeReviewResult> {
  await requireOwnedProject(ownerId, projectId);
  const review = await prisma.codeReview.findFirst({
    where: { id: reviewId, projectId },
    include: reviewWithDetailInclude,
  });
  if (!review) {
    throw AppError.notFound("Review not found");
  }
  return serializeReview(review);
}
