/**
 * Bounded, safe retrieval observability (Phase 14, Milestone 14.5 — see
 * docs/RETRIEVAL_QUALITY_PHASE_PLAN.md's Phase 14 addendum). Emits one
 * structured JSON log line per search() call, deliberately never including:
 * the raw query text, any chunk's content, file paths beyond a bare count,
 * or any credential/token. Numbers and counts only — enough to diagnose a
 * production ranking problem (candidate volume, cutoff behavior, latency,
 * index staleness) without ever risking a secret or sensitive source
 * excerpt ending up in a log aggregator.
 */

export type SearchObservabilityEvent = {
  event: "search";
  queryLength: number;
  candidateCount: number;
  semanticCandidateCount: number;
  lexicalCandidateCount: number;
  finalResultCount: number;
  candidatesRemovedByCutoff: number;
  cutoffThreshold: number;
  topCombinedScore: number | null;
  meanCombinedScore: number | null;
  latencyMs: number;
  indexBranch: string;
  indexCommitSha: string;
  indexAgeMs: number;
  indexFailedFileCount: number;
};

export type CandidateScoreSummary = { semanticScore: number; lexicalScore: number; combined: number };

export function buildSearchObservabilityEvent(params: {
  query: string;
  candidates: CandidateScoreSummary[];
  finalResultCount: number;
  cutoffThreshold: number;
  latencyMs: number;
  indexBranch: string;
  indexCommitSha: string;
  indexCompletedAt: Date | null;
  indexFailedFileCount: number;
  now?: Date;
}): SearchObservabilityEvent {
  const { query, candidates, finalResultCount, cutoffThreshold, latencyMs, indexBranch, indexCommitSha, indexCompletedAt, indexFailedFileCount } =
    params;
  const now = params.now ?? new Date();

  const combinedScores = candidates.map((c) => c.combined);
  const topCombinedScore = combinedScores.length > 0 ? Math.max(...combinedScores) : null;
  const meanCombinedScore =
    combinedScores.length > 0 ? combinedScores.reduce((sum, v) => sum + v, 0) / combinedScores.length : null;

  return {
    event: "search",
    queryLength: query.length,
    candidateCount: candidates.length,
    semanticCandidateCount: candidates.filter((c) => c.semanticScore > 0).length,
    lexicalCandidateCount: candidates.filter((c) => c.lexicalScore > 0).length,
    finalResultCount,
    candidatesRemovedByCutoff: Math.max(0, candidates.length - finalResultCount),
    cutoffThreshold,
    topCombinedScore,
    meanCombinedScore,
    latencyMs,
    indexBranch,
    indexCommitSha,
    indexAgeMs: indexCompletedAt ? now.getTime() - indexCompletedAt.getTime() : -1,
    indexFailedFileCount,
  };
}

/** Logs the event as a single, bounded JSON line — the only place this
 * module touches process I/O, kept separate from buildSearchObservabilityEvent
 * so the event's own construction is pure and unit-testable without
 * capturing console output. */
export function logSearchObservability(event: SearchObservabilityEvent): void {
  console.log(JSON.stringify(event));
}
