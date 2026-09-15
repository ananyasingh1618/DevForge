/**
 * Case-level retrieval diagnostics — see
 * docs/RETRIEVAL_QUALITY_PHASE_PLAN.md, Milestone 2. Builds on the same
 * per-candidate score-signal breakdown api/src/lib/retrievalDiagnostics.ts
 * produces in production (mirrored here via hybridScore.ts), adding the
 * ground-truth-aware fields only an evaluation run has: which expected
 * chunk ranked where, and which expected chunks never made the final
 * returned set at all. Included in the JSON evaluation report (never in
 * production logs, which have no ground truth to compare against).
 */

import { chunkContent, FIXTURE_CHUNKS, type FixtureChunk } from "./dataset/fixtureRepo.js";
import { deterministicEmbedding, cosineSimilarity } from "./deterministicEmbedding.js";
import { combinedScore, computeScoreSignals, type ScoreSignals } from "./hybridScore.js";
import type { RetrievalCase } from "./dataset/retrievalCases.js";

export type ChunkDiagnostic = {
  chunkId: string;
  filePath: string;
  symbolName: string | null;
  rank: number;
  signals: ScoreSignals;
  combinedScore: number;
  duplicateGroup: number | null;
};

export type CaseDiagnostics = {
  caseId: string;
  query: string;
  expectedChunkIds: string[];
  returnedChunkIds: string[];
  firstRelevantRank: number | null;
  missingFromReturned: string[];
  breakdown: ChunkDiagnostic[];
};

function overlaps(a: FixtureChunk, b: FixtureChunk): boolean {
  return a.filePath === b.filePath && a.startLine <= b.endLine && b.startLine <= a.endLine;
}

function assignDuplicateGroups(chunks: FixtureChunk[]): Map<string, number> {
  const groupOf = new Map<string, number>();
  let nextGroup = 0;
  for (const a of chunks) {
    if (groupOf.has(a.chunkId)) continue;
    const overlapping = chunks.filter((b) => b.chunkId !== a.chunkId && overlaps(a, b));
    if (overlapping.length === 0) continue;
    const group = nextGroup++;
    groupOf.set(a.chunkId, group);
    for (const b of overlapping) groupOf.set(b.chunkId, group);
  }
  return groupOf;
}

/** Full, rank-ordered breakdown of every fixture chunk against one query —
 * not just the ones ultimately returned, so a case's diagnostics can show
 * exactly how far down the ranking a missed expected chunk actually fell. */
export function rankWithDiagnostics(query: string, chunks: FixtureChunk[] = FIXTURE_CHUNKS): ChunkDiagnostic[] {
  const queryVector = deterministicEmbedding(query);
  const scored = chunks.map((chunk) => {
    const semanticScore = cosineSimilarity(queryVector, deterministicEmbedding(chunkContent(chunk)));
    const signals = computeScoreSignals(query, semanticScore, {
      content: chunkContent(chunk),
      symbolName: chunk.symbolName,
      filePath: chunk.filePath,
    });
    return { chunk, signals, combined: combinedScore(signals) };
  });
  scored.sort((a, b) => b.combined - a.combined);
  const groupOf = assignDuplicateGroups(chunks);
  return scored.map((s, i) => ({
    chunkId: s.chunk.chunkId,
    filePath: s.chunk.filePath,
    symbolName: s.chunk.symbolName,
    rank: i + 1,
    signals: s.signals,
    combinedScore: s.combined,
    duplicateGroup: groupOf.get(s.chunk.chunkId) ?? null,
  }));
}

export function buildCaseDiagnostics(testCase: RetrievalCase, returnedChunkIds: string[]): CaseDiagnostics {
  const breakdown = rankWithDiagnostics(testCase.query);
  const firstRelevant = breakdown.find((d) => testCase.expectedChunkIds.includes(d.chunkId));
  const missingFromReturned = testCase.expectedChunkIds.filter((id) => !returnedChunkIds.includes(id));
  return {
    caseId: testCase.id,
    query: testCase.query,
    expectedChunkIds: testCase.expectedChunkIds,
    returnedChunkIds,
    firstRelevantRank: firstRelevant ? firstRelevant.rank : null,
    missingFromReturned,
    breakdown,
  };
}
