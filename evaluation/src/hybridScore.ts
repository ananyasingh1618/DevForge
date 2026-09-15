/**
 * Byte-for-byte mirror of api/src/lib/hybridScore.ts (this package has no
 * dependency on `api` — same cross-package convention every other shared
 * concept in evaluation/ already follows, e.g. its own deterministic
 * embedding standing in for Voyage AI). See that file's own header comment
 * and docs/RETRIEVAL_QUALITY_PHASE_PLAN.md for the full rationale. Used by
 * src/evaluators/retrievalEvaluator.ts so the same measurable ranking
 * improvement shows up in `pnpm eval`, not just in production.
 */

/** Splits camelCase/PascalCase/snake_case/kebab-case identifiers into real
 * word tokens (so a query word like "password" matches the identifier
 * `passwordHash`), then normalizes to lowercase words of length > 1. */
export function tokenize(text: string): string[] {
  const withBoundaries = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return withBoundaries
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/** Fraction of the query's own tokens that appear anywhere in the
 * candidate's token set — a simple, deterministic lexical-overlap signal,
 * independent of and complementary to semantic embedding similarity. */
export function lexicalOverlapScore(queryTokens: string[], contentTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const contentSet = new Set(contentTokens);
  const matched = queryTokens.filter((t) => contentSet.has(t)).length;
  return matched / queryTokens.length;
}

/** Fraction of a symbol's own tokens that appear in the query — rewards a
 * query that names (even partially, e.g. by one meaningful word) the
 * specific function/class being asked about. 0 when there's no symbol. */
export function identifierMatchScore(queryTokenSet: Set<string>, symbolName: string | null): number {
  if (!symbolName) return 0;
  const symbolTokens = tokenize(symbolName);
  if (symbolTokens.length === 0) return 0;
  const matched = symbolTokens.filter((t) => queryTokenSet.has(t)).length;
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
  const matched = pathTokens.filter((t) => queryTokenSet.has(t)).length;
  return matched / pathTokens.length;
}

export type ScoreSignals = {
  semanticScore: number;
  lexicalScore: number;
  identifierScore: number;
  exactIdentifierScore: number;
  filePathScore: number;
};

/** Hand-picked, documented weights — not learned, not a claim of
 * optimality (see the plan doc's "Risks" section). `semantic` dominates
 * deliberately: these signals refine ranking, they don't replace semantic
 * relevance as the primary driver. */
export const HYBRID_WEIGHTS = {
  semantic: 1.0,
  lexical: 0.35,
  identifier: 0.25,
  exactIdentifier: 0.4,
  filePath: 0.1,
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
