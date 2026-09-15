/**
 * Explainability layer for retrieval ranking — see
 * docs/RETRIEVAL_QUALITY_PHASE_PLAN.md, Milestone 2. Pure and side-effect-
 * free: given a query and a set of scored candidates, produces a per-
 * candidate score breakdown (semantic/lexical/identifier/file-path/
 * combined score, rank, duplicate grouping) safe to log or include in an
 * evaluation report. Deliberately carries only `chunkId`/`filePath`/
 * `symbolName`/`startLine`/`endLine` per candidate — never `content` — so
 * a diagnostic can never leak a secret-bearing source snippet, an API key,
 * a GitHub token, or any other credential a chunk might (in principle)
 * contain. Not wired into any HTTP response by default; callers opt in
 * explicitly (see services/retrieval.ts's internal use in Milestone 3).
 */

import { computeScoreSignals, combinedScore, type ScoreSignals } from "./hybridScore.js";

export type DiagnosticCandidate = {
  chunkId: string;
  filePath: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  content: string;
  semanticScore: number;
};

export type CandidateDiagnostic = {
  chunkId: string;
  filePath: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  rank: number;
  signals: ScoreSignals;
  combinedScore: number;
  /** Shared group id for chunks in the same file with overlapping line
   * ranges — null when this candidate doesn't overlap any other. Mirrors
   * lib/qaSourceSelection.ts's own overlap definition. */
  duplicateGroup: number | null;
};

function overlaps(a: DiagnosticCandidate, b: DiagnosticCandidate): boolean {
  return a.filePath === b.filePath && a.startLine <= b.endLine && b.startLine <= a.endLine;
}

function assignDuplicateGroups(ranked: DiagnosticCandidate[]): Map<string, number> {
  const groupOf = new Map<string, number>();
  let nextGroup = 0;
  for (let i = 0; i < ranked.length; i++) {
    const a = ranked[i]!;
    if (groupOf.has(a.chunkId)) continue;
    const overlapping = ranked.filter((b) => b.chunkId !== a.chunkId && overlaps(a, b));
    if (overlapping.length === 0) continue;
    const group = nextGroup++;
    groupOf.set(a.chunkId, group);
    for (const b of overlapping) groupOf.set(b.chunkId, group);
  }
  return groupOf;
}

/** Builds a full, rank-ordered diagnostic breakdown for every supplied
 * candidate (not just the ones ultimately selected) — the caller decides
 * how much of this to keep/log/return. Ordering is by combinedScore
 * descending, the same order services/retrieval.ts's search() uses to
 * select results (see Milestone 3). */
export function buildRetrievalDiagnostics(query: string, candidates: DiagnosticCandidate[]): CandidateDiagnostic[] {
  const scored = candidates.map((c) => {
    const signals = computeScoreSignals(query, c.semanticScore, {
      content: c.content,
      symbolName: c.symbolName,
      filePath: c.filePath,
    });
    return { candidate: c, signals, combined: combinedScore(signals) };
  });

  scored.sort((a, b) => b.combined - a.combined);

  const provisional: DiagnosticCandidate[] = scored.map((s) => s.candidate);
  const groupOf = assignDuplicateGroups(provisional);

  return scored.map((s, i) => ({
    chunkId: s.candidate.chunkId,
    filePath: s.candidate.filePath,
    symbolName: s.candidate.symbolName,
    startLine: s.candidate.startLine,
    endLine: s.candidate.endLine,
    rank: i + 1,
    signals: s.signals,
    combinedScore: s.combined,
    duplicateGroup: groupOf.get(s.candidate.chunkId) ?? null,
  }));
}
