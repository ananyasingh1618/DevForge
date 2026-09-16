/**
 * Byte-for-byte mirror of api/src/lib/hybridScore.ts (this package has no
 * dependency on `api` — same cross-package convention every other shared
 * concept in evaluation/ already follows, e.g. its own deterministic
 * embedding standing in for Voyage AI). See that file's own header comment
 * and docs/RETRIEVAL_QUALITY_PHASE_PLAN.md for the full rationale. Used by
 * src/evaluators/retrievalEvaluator.ts so the same measurable ranking
 * improvement shows up in `pnpm eval`, not just in production.
 */

/** Mirrors api/src/lib/hybridScore.ts's own STOPWORDS exactly — see that
 * file for the full rationale (Phase 14, Milestone 14.2). */
const STOPWORDS = new Set([
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "the",
  "an",
  "of",
  "to",
  "in",
  "on",
  "at",
  "for",
  "and",
  "or",
  "but",
  "not",
  "no",
  "how",
  "what",
  "which",
  "who",
  "why",
  "when",
  "where",
  "there",
  "here",
  "this",
  "that",
  "these",
  "those",
  "with",
  "without",
  "from",
  "into",
  "onto",
  "about",
  "before",
  "after",
  "instead",
  "unlike",
  "rather",
  "than",
  "does",
  "did",
  "done",
  "doing",
  "have",
  "has",
  "had",
  "will",
  "would",
  "should",
  "could",
  "can",
  "each",
  "every",
  "only",
  "such",
  "some",
  "any",
  "same",
  "also",
  "even",
  "it",
  "its",
  "as",
  "by",
  "if",
]);

/** Splits camelCase/PascalCase/snake_case/kebab-case identifiers into real
 * word tokens (so a query word like "password" matches the identifier
 * `passwordHash`), normalizes to lowercase words of length > 1, and drops
 * common English stopwords. */
export function tokenize(text: string): string[] {
  const withBoundaries = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return withBoundaries
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Mirrors api/src/lib/hybridScore.ts's own tokensMatch/anyTokenMatches
 * exactly — a light, general "safe stemming" fallback (Phase 14,
 * Milestone 14.2): two tokens match when identical, or when both are
 * ≥6 characters and share a ≥5-character common prefix (e.g.
 * "notify"/"notifications"). See that file for the full rationale. */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 6 || b.length < 6) return false;
  return a.slice(0, 5) === b.slice(0, 5);
}

function anyTokenMatches(token: string, candidates: string[]): boolean {
  return candidates.some((c) => tokensMatch(token, c));
}

/** Fraction of the query's own tokens that appear anywhere in the
 * candidate's token set — a simple, deterministic lexical-overlap signal,
 * independent of and complementary to semantic embedding similarity. */
export function lexicalOverlapScore(queryTokens: string[], contentTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const matched = queryTokens.filter((t) => anyTokenMatches(t, contentTokens)).length;
  return matched / queryTokens.length;
}

/** Fraction of a symbol's own tokens that appear in the query — rewards a
 * query that names (even partially, e.g. by one meaningful word) the
 * specific function/class being asked about. 0 when there's no symbol. */
export function identifierMatchScore(queryTokenSet: Set<string>, symbolName: string | null): number {
  if (!symbolName) return 0;
  const symbolTokens = tokenize(symbolName);
  if (symbolTokens.length === 0) return 0;
  const queryTokens = [...queryTokenSet];
  const matched = symbolTokens.filter((t) => anyTokenMatches(t, queryTokens)).length;
  return matched / symbolTokens.length;
}

/** 1 when the query contains the symbol's exact name as a literal
 * substring (e.g. "what does verifyPassword do") — a strong, unambiguous
 * signal a lexical/semantic score alone won't always surface as the top
 * match. */
export function exactIdentifierBoost(query: string, symbolName: string | null): number {
  if (!symbolName || symbolName.length < 2) return 0;
  return query.toLowerCase().includes(symbolName.toLowerCase()) ? 1 : 0;
}

/** Fraction of a file path's own path-segment tokens that appear in the
 * query — rewards a query that names a file/module/directory. */
export function filePathMatchScore(queryTokenSet: Set<string>, filePath: string): number {
  const pathTokens = tokenize(filePath);
  if (pathTokens.length === 0) return 0;
  const queryTokens = [...queryTokenSet];
  const matched = pathTokens.filter((t) => anyTokenMatches(t, queryTokens)).length;
  return matched / pathTokens.length;
}

// Mirrors api/src/lib/hybridScore.ts exactly: a qualifierMismatchCount
// signal was implemented and measured here too, and removed for the same
// reason — see that file's own comment and
// docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md for the full measured
// comparison.

export type ScoreSignals = {
  semanticScore: number;
  lexicalScore: number;
  identifierScore: number;
  exactIdentifierScore: number;
  filePathScore: number;
};

/** Mirrors api/src/lib/hybridScore.ts's own HYBRID_WEIGHTS exactly — see
 * that file for the full rationale (`filePath` raised 0.1 → 0.35 in Part A
 * of the retrieval-target-closure package, Milestone A4; `semantic` lowered
 * 1.0 → 0.8 in that same package's real-local-embedding-model second pass,
 * both from real weight sweeps against the full 67-case benchmark). */
export const HYBRID_WEIGHTS = {
  semantic: 0.8,
  lexical: 0.35,
  identifier: 0.25,
  exactIdentifier: 0.4,
  filePath: 0.35,
} as const;

export function combinedScore(signals: ScoreSignals): number {
  return (
    HYBRID_WEIGHTS.semantic * signals.semanticScore +
    HYBRID_WEIGHTS.lexical * signals.lexicalScore +
    HYBRID_WEIGHTS.identifier * signals.identifierScore +
    HYBRID_WEIGHTS.exactIdentifier * signals.exactIdentifierScore +
    HYBRID_WEIGHTS.filePath * signals.filePathScore
  );
}

export function computeScoreSignals(
  query: string,
  semanticScore: number,
  candidate: { content: string; symbolName: string | null; filePath: string },
): ScoreSignals {
  const queryTokens = tokenize(query);
  const queryTokenSet = new Set(queryTokens);
  const contentTokens = tokenize(candidate.content);
  return {
    semanticScore,
    lexicalScore: lexicalOverlapScore(queryTokens, contentTokens),
    identifierScore: identifierMatchScore(queryTokenSet, candidate.symbolName),
    exactIdentifierScore: exactIdentifierBoost(query, candidate.symbolName),
    filePathScore: filePathMatchScore(queryTokenSet, candidate.filePath),
  };
}
