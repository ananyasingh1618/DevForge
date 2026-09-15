#!/usr/bin/env node
/**
 * Repository-scale indexing benchmark (Phase 15, Milestone 15.6 — see
 * docs/PHASE_15_JOB_ARCHITECTURE_PLAN.md). Measures two real, separable
 * costs: (1) `chunkFile()`'s own CPU-bound throughput (files/sec, chunks/
 * sec) at three synthetic corpus sizes, generated deterministically so this
 * is reproducible without needing a real large GitHub repository; (2) real
 * PostgreSQL bulk-write throughput for persisting the resulting chunks,
 * against the actual `code_chunks` table shape via a real (test-database)
 * `createMany` call — not a synthetic estimate.
 *
 * What this does NOT measure, and does not claim to: live GitHub API
 * latency for fetching thousands of real file blobs (a network-bound cost
 * that scales roughly linearly with file count, already established
 * qualitatively in every prior phase's own Docker verification against a
 * small real repository) or ai-service's real parse latency for a large
 * corpus (this benchmark exercises `chunkFile()`, the pure post-parse
 * chunking step, not the parser itself). See the progress log's own
 * Milestone 15.6 entry for the full, honest scope statement.
 *
 * Run: DATABASE_URL=... pnpm --filter @devforge/api exec tsx src/scripts/indexingBenchmark.ts
 */

import { randomUUID } from "node:crypto";
import { chunkFile, type FileForChunking } from "../lib/chunking.js";
import { prisma } from "../lib/prisma.js";
import type { PrismaClient } from "@prisma/client";

const WORDS = ["process", "validate", "fetch", "compute", "resolve", "update", "order", "user", "payment", "session"];

function pseudoWord(seed: number): string {
  return WORDS[seed % WORDS.length]!;
}

/** Generates one synthetic file with `symbolCount` functions, each with a
 * realistic-length body — deterministic for a given (fileIndex, symbolCount). */
function generateFile(fileIndex: number, symbolCount: number): FileForChunking {
  const symbols: FileForChunking["symbols"] = [];
  const lines: string[] = [];
  for (let i = 0; i < symbolCount; i++) {
    const name = `${pseudoWord(fileIndex + i)}Handler${i}`;
    const startLine = lines.length + 1;
    lines.push(
      `export function ${name}(input: unknown): unknown {`,
      `  const result = input;`,
      `  if (!result) {`,
      `    throw new Error("Invalid input to ${name}");`,
      `  }`,
      `  return result;`,
      `}`,
      ``,
    );
    symbols.push({ id: `f${fileIndex}-s${i}`, startLine, endLine: lines.length - 1 });
  }
  return { fileId: `synthetic-file-${fileIndex}`, content: lines.join("\n"), language: "typescript", symbols };
}

function benchmarkChunking(fileCount: number, symbolsPerFile: number) {
  const files = Array.from({ length: fileCount }, (_, i) => generateFile(i, symbolsPerFile));
  const start = performance.now();
  let totalChunks = 0;
  for (const file of files) {
    totalChunks += chunkFile(file).length;
  }
  const elapsedMs = performance.now() - start;
  return {
    fileCount,
    totalChunks,
    elapsedMs,
    filesPerSecond: fileCount / (elapsedMs / 1000),
    chunksPerSecond: totalChunks / (elapsedMs / 1000),
  };
}

async function benchmarkDbWrite(prisma: PrismaClient, projectId: string, indexId: string, fileId: string, chunkCount: number) {
  const rows = Array.from({ length: chunkCount }, (_, i) => ({
    id: randomUUID(),
    projectId,
    codebaseIndexId: indexId,
    fileId,
    symbolId: null,
    branch: "main",
    commitSha: "benchmark-commit",
    chunkIndex: i,
    content: `// synthetic chunk ${i}`,
    contentHash: randomUUID(),
    language: "typescript",
    startLine: i * 10 + 1,
    endLine: i * 10 + 9,
  }));
  const start = performance.now();
  await prisma.codeChunk.createMany({ data: rows });
  const elapsedMs = performance.now() - start;
  return { chunkCount, elapsedMs, chunksPerSecond: chunkCount / (elapsedMs / 1000) };
}

async function main() {
  console.log("=== Chunking throughput (CPU-bound, no I/O) ===\n");
  const sizes = [
    { label: "small", fileCount: 30, symbolsPerFile: 5 },
    { label: "medium", fileCount: 300, symbolsPerFile: 8 },
    { label: "large", fileCount: 2000, symbolsPerFile: 10 },
  ];
  for (const { label, fileCount, symbolsPerFile } of sizes) {
    const result = benchmarkChunking(fileCount, symbolsPerFile);
    console.log(
      `${label.padEnd(8)} files=${result.fileCount.toString().padStart(5)} chunks=${result.totalChunks.toString().padStart(6)} ` +
        `time=${result.elapsedMs.toFixed(1).padStart(8)}ms  ${result.filesPerSecond.toFixed(0).padStart(6)} files/s  ${result.chunksPerSecond.toFixed(0).padStart(6)} chunks/s`,
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("\nDATABASE_URL not set — skipping the real Postgres bulk-write benchmark.");
    return;
  }

  console.log("\n=== Postgres bulk-write throughput (real code_chunks table) ===\n");
  try {
    const user = await prisma.user.create({
      data: { id: randomUUID(), email: `bench-${randomUUID()}@example.com`, passwordHash: "x" },
    });
    const project = await prisma.project.create({ data: { id: randomUUID(), ownerId: user.id, name: "Indexing Benchmark" } });
    const connection = await prisma.repositoryConnection.create({
      data: {
        id: randomUUID(),
        projectId: project.id,
        githubOwner: "bench",
        githubRepo: "bench",
        githubRepoId: "0",
        githubAccountLogin: "bench",
        repositoryUrl: "https://github.com/bench/bench",
        defaultBranch: "main",
        encryptedToken: "not-a-real-token",
        tokenLast4: "0000",
        status: "verified",
      },
    });
    const index = await prisma.codebaseIndex.create({
      data: { id: randomUUID(), projectId: project.id, repositoryConnectionId: connection.id, branch: "main", status: "completed" },
    });
    const file = await prisma.indexedFile.create({
      data: { id: randomUUID(), indexId: index.id, path: "bench.ts", sizeBytes: 100, contentHash: "x", parseStatus: "parsed" },
    });

    for (const chunkCount of [50, 500, 5000]) {
      const result = await benchmarkDbWrite(prisma, project.id, index.id, file.id, chunkCount);
      console.log(
        `chunks=${result.chunkCount.toString().padStart(5)}  time=${result.elapsedMs.toFixed(1).padStart(8)}ms  ${result.chunksPerSecond.toFixed(0).padStart(6)} chunks/s (bulk insert)`,
      );
      await prisma.codeChunk.deleteMany({ where: { codebaseIndexId: index.id } });
    }

    await prisma.project.delete({ where: { id: project.id } }); // cascades
    await prisma.user.delete({ where: { id: user.id } });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error("Benchmark failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
