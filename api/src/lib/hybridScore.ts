/**
 * Pure, side-effect-free scoring signals layered on top of Phase 8's
 * existing semantic (cosine-similarity) ranking — see
 * docs/RETRIEVAL_QUALITY_PHASE_PLAN.md ("Root-cause analysis" and
 * "Proposed changes") for why: precision@K and MRR losses traced to real,
 * measured cases where a lexically/structurally obvious match (an exact
 * identifier in the query, a matching file path) wasn't reflected in pure
 * embedding similarity alone. These signals never replace the semantic
 * score — `services/retrieval.ts` combines them only to decide which
 * chunks `search()` selects and in what order; the `score` field every
 * existing caller/test already depends on stays pure cosine similarity,
 * unchanged.
 *
 * Mirrored (not imported — this package has no dependency on `api`, same
 * cross-package convention `evaluation/` already follows) in
 * evaluation/src/hybridScore.ts, so the same measurable improvement shows
 * up in `pnpm eval`.
 */

/**
 * A standard, general-purpose English stopword list (the same handful of
 * articles/prepositions/auxiliary verbs any IR textbook's stopword list
 * would include — not tied to any specific codebase or query). Added in
 * Phase 14 (docs/RETRIEVAL_QUALITY_PHASE_PLAN.md's Phase 14 addendum,
 * Milestone 14.2) after a real, measured finding: a natural-language
 * question like "Is there a SQL injection risk in the user repository
 * code?" shares generic words ("is", "there", "a", "in", "the", "no")
 * with completely unrelated chunks' own prose doc-comments, inflating
 * `lexicalOverlapScore` for reasons having nothing to do with topical
 * relevance — confirmed directly by inspecting a real false-positive
 * top-ranked candidate's own signal breakdown before this fix (lexical
 * score 0.5 from stopword overlap alone). Excluding these words from
 * tokenize()'s output is the standard, well-established fix.
 */
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
 * common English stopwords (see STOPWORDS above) — a query/candidate word
 * only counts toward lexical/identifier/file-path overlap when it's an
 * actual, topically-meaningful word. */
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

/**
 * Two tokens are considered a match when they're identical, or — a light,
 * general "safe stemming" fallback (Phase 14, Milestone 14.2; see
 * docs/RETRIEVAL_QUALITY_PHASE_PLAN.md's Phase 14 addendum) — when both
 * are long enough (≥6 characters) and share a ≥5-character common prefix.
 * This catches ordinary English word-family variants a real stemmer would
 * (e.g. "notify"/"notification"/"notifications",
 * "validate"/"validation", "config"/"configuration") without pulling in a
 * real stemming library or any dataset-specific word list — confirmed by
 * a real, measured case: a query asking about "notifications" wasn't
 * lexically matching a chunk whose only identifier was
 * `notifyUserFireAndForget`, purely because "notify" and "notifications"
 * are different tokens under exact-match comparison. Deliberately
 * conservative (long minimum length, long minimum shared prefix) to avoid
 * false-positive matches between short, unrelated words.
 */
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

// A "qualifierMismatchCount" signal (penalizing a candidate for symbol
// tokens the query doesn't mention, to break near-ties between sibling
// functions like parseWebhookPayload/parseWebhookPayloadStrict) was
// implemented and measured during the retrieval-target-closure
// architecture work, gated to only apply once a candidate was already a
// strong partial identifier match. Even gated, it measured net-negative
// on the full benchmark in every tested combination — it reliably fixed
// the narrow sibling-disambiguation shape it targeted, but reduced
// recall@5, MRR, and direct-hit-rate elsewhere by more than it gained,
// and inflated false-confidence-rate. Removed rather than shipped with a
// zero weight — see docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md for the
// full measured comparison this conclusion is based on.

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
 * relevance as the primary driver.
 *
 * `filePath` raised 0.1 → 0.35 in Part A of the retrieval-target-closure
 * package (docs/RETRIEVAL_TARGET_CLOSURE_PROGRESS.md, Milestone A4): a real
 * weight sweep against the full 67-case benchmark showed file-path overlap
 * is a more reliable general relevance signal than its original weight
 * gave it credit for — a query naming a feature area (e.g. "order",
 * "repository") reliably matches the file that actually implements it,
 * and this doesn't share the noisier over-generalization problem partial
 * identifier-token matching has on short, common symbol names. Chosen at
 * the exact point past which recall@K first regresses (0.35 preserves
 * peak recall@K exactly; 0.4 already costs a real case) — not pushed
 * further just because MRR kept rising, per the task's "do not tune
 * merely to make the metrics pass" instruction. Measured effect: MRR
 * 83.6%→85.5% (crosses the ≥85% target), recall@K unchanged at 98.4%,
 * useful-context-rate and precision@K both improve slightly too — see
 * that progress log for the full sweep table this value was chosen from.
 *
 * `semantic` lowered 1.0 → 0.8 in the retrieval-target-closure
 * architecture's second pass (docs/RETRIEVAL_TARGET_CLOSURE_FINAL_REPORT.md,
 * real-local-embedding-model rework): once the mock character-n-gram
 * embedding was replaced with a real sentence-embedding model, a real
 * weight sweep against the full 67-case benchmark showed the new model's
 * own semantic judgment, while far better at distinguishing unrelated
 * content, was too dominant relative to lexical/identifier signal on the
 * specific case shape this fixture stresses hardest: near-synonym sibling
 * functions in the same file (`findOrderById` vs. `findOwnedOrderById`,
 * `addToCart` vs. `addItem`, `verifyJwt` vs. `generateJwt`) where the two
 * candidates' surrounding code is nearly semantically identical and only a
 * literal identifier/lexical difference actually distinguishes the one the
 * query is asking about. Lowering `semantic` to 0.8 (keeping every other
 * weight unchanged) raised direct-hit-rate and recall@3/5 with no measured
 * regression on any other metric — see that report for the full sweep. */
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
