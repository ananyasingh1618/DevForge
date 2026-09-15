import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { requireOwnedProject } from "../lib/ownership.js";
import * as retrievalService from "./retrieval.js";
import { answerQuestionViaAiService, type QaSourceForProvider } from "../lib/aiServiceClient.js";
import { MAX_SOURCES, selectSources } from "../lib/qaSourceSelection.js";
import { groundAnswer } from "../lib/qaAnswerGrounding.js";
import type { Prisma } from "@prisma/client";

export type QaSourceResult = {
  filePath: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  score: number;
  cited: boolean;
};

export type QaResult = {
  questionId: string;
  question: string;
  answer: string;
  insufficientEvidence: boolean;
  sources: QaSourceResult[];
  branch: string;
  commit: string;
  createdAt: string;
};


const questionWithAnswerInclude = {
  answer: {
    include: {
      sources: {
        include: { chunk: { include: { file: true, symbol: true } } },
        orderBy: { sourceOrder: "asc" as const },
      },
    },
  },
} satisfies Prisma.QuestionInclude;

type QuestionWithAnswer = Prisma.QuestionGetPayload<{ include: typeof questionWithAnswerInclude }>;

function serializeQuestion(question: QuestionWithAnswer): QaResult {
  const answer = question.answer;
  if (!answer) {
    // Every persisted Question gets its Answer created in the same
    // request that created it (see askQuestion below) — this should be
    // unreachable, but a real error is still safer than fabricating one.
    throw new AppError(502, "QA_ANSWER_MISSING", "This question has no recorded answer.");
  }
  return {
    questionId: question.id,
    question: question.question,
    answer: answer.answer,
    insufficientEvidence: answer.insufficientEvidence,
    sources: answer.sources.map((source) => ({
      filePath: source.chunk.file.path,
      symbolName: source.chunk.symbol?.name ?? null,
      startLine: source.chunk.startLine,
      endLine: source.chunk.endLine,
      score: source.score,
      cited: source.cited,
    })),
    branch: question.branch,
    commit: question.commitSha,
    createdAt: question.createdAt.toISOString(),
  };
}

/**
 * Asks a question against a project's currently indexed codebase. Retrieval
 * (Phase 8's search()) always runs first, and its real errors (no
 * completed index, branch/commit mismatch, GitHub/embedding provider not
 * configured) propagate unchanged — there is no code path here that
 * reaches the Claude call without search() having already succeeded. A
 * genuinely empty (post-dedup/cap) evidence set skips the Claude call
 * entirely and returns a real, local "insufficient evidence" answer,
 * persisted the same as any other — never a fabricated grounded answer
 * from zero evidence.
 */
export async function askQuestion(
  ownerId: string,
  projectId: string,
  question: string,
): Promise<QaResult> {
  await requireOwnedProject(ownerId, projectId);

  const results = await retrievalService.search(ownerId, projectId, {
    query: question,
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
    throw new AppError(400, "NO_COMPLETED_INDEX", "Connect a repository and complete indexing before asking.");
  }

  const selected = selectSources(results);

  const questionRow = await prisma.question.create({
    data: { projectId, codebaseIndexId: index.id, question, branch, commitSha },
  });

  if (selected.length === 0) {
    const answerRow = await prisma.answer.create({
      data: {
        questionId: questionRow.id,
        answer:
          "No relevant code was found in the indexed repository for this question. Try " +
          "rephrasing it, or ask about a more specific file, function, or feature.",
        insufficientEvidence: true,
        model: "none",
      },
    });
    return {
      questionId: questionRow.id,
      question,
      answer: answerRow.answer,
      insufficientEvidence: true,
      sources: [],
      branch,
      commit: commitSha,
      createdAt: answerRow.createdAt.toISOString(),
    };
  }

  const providerSources: QaSourceForProvider[] = selected.map((source, i) => ({
    sourceNumber: i + 1,
    path: source.filePath,
    symbolName: source.symbolName,
    startLine: source.startLine,
    endLine: source.endLine,
    content: source.content,
  }));

  const aiAnswer = await answerQuestionViaAiService(question, repository, branch, commitSha, providerSources);

  // groundAnswer() independently re-validates cited source numbers against
  // the real range Node itself provided (defense in depth on top of the
  // same filtering ai-service's own provider already does — never trust
  // either layer alone) and deterministically falls back to an honest
  // insufficient-evidence answer if the provider claimed a confident
  // answer while citing zero valid sources — see
  // docs/RETRIEVAL_QUALITY_PHASE_PLAN.md, Milestone 4.
  const grounded = groundAnswer(aiAnswer, selected.length);
  const { citedOrders } = grounded;

  const answerRow = await prisma.answer.create({
    data: {
      questionId: questionRow.id,
      answer: grounded.answer,
      insufficientEvidence: grounded.insufficientEvidence,
      model: "claude-opus-5",
    },
  });

  await prisma.answerSource.createMany({
    data: selected.map((source, i) => ({
      id: randomUUID(),
      answerId: answerRow.id,
      chunkId: source.chunkId,
      sourceOrder: i + 1,
      cited: citedOrders.has(i + 1),
      score: source.score,
    })),
  });

  return {
    questionId: questionRow.id,
    question,
    answer: grounded.answer,
    insufficientEvidence: grounded.insufficientEvidence,
    sources: selected.map((source, i) => ({
      filePath: source.filePath,
      symbolName: source.symbolName,
      startLine: source.startLine,
      endLine: source.endLine,
      score: source.score,
      cited: citedOrders.has(i + 1),
    })),
    branch,
    commit: commitSha,
    createdAt: answerRow.createdAt.toISOString(),
  };
}

export async function listQuestions(ownerId: string, projectId: string): Promise<QaResult[]> {
  await requireOwnedProject(ownerId, projectId);
  const questions = await prisma.question.findMany({
    where: { projectId },
    include: questionWithAnswerInclude,
    orderBy: { createdAt: "desc" },
  });
  return questions.map(serializeQuestion);
}

export async function getQuestion(
  ownerId: string,
  projectId: string,
  questionId: string,
): Promise<QaResult> {
  await requireOwnedProject(ownerId, projectId);
  const question = await prisma.question.findFirst({
    where: { id: questionId, projectId },
    include: questionWithAnswerInclude,
  });
  if (!question) {
    throw AppError.notFound("Question not found");
  }
  return serializeQuestion(question);
}
