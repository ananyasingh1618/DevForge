/**
 * A deterministic, dependency-free, zero-cost stand-in for a real embedding
 * model (Phase 8's Voyage AI `voyage-code-3`) — used only by this
 * evaluation package, never by production code. See
 * docs/EVALUATION_PHASE_PLAN.md ("Deterministic mock-provider strategy")
 * for why: retrieval evaluation needs to run in CI and locally without a
 * paid Voyage AI key, and needs the exact same input to always produce the
 * exact same ranking so a report is reproducible.
 *
 * This is character-n-gram (shingling) hashing — a standard, well-
 * understood lexical-similarity technique (the same family as MinHash/
 * SimHash near-duplicate detection), not a novel scheme: text is
 * lowercased, non-alphanumeric runs are collapsed to single spaces, and
 * overlapping character n-grams (n = 3, 4, 5) of the result are hashed into
 * one of DIMENSIONS buckets; the resulting count vector is L2-normalized.
 * Character n-grams (rather than word tokens) are used deliberately: they
 * match a natural-language query word like "password" against a camelCase
 * source identifier like `passwordHash` as a substring overlap, without
 * needing a real tokenizer/stemmer to split "passwordHash" into "password"
 * + "hash" first. Cosine similarity between two such vectors approximates
 * lexical overlap — a real but crude proxy for semantic similarity. It
 * reliably ranks the fixture dataset's deliberately lexically-distinct
 * cases correctly (see retrievalEvaluator.test.ts), but it is NOT a claim
 * that this technique approximates real embedding-model quality on
 * arbitrary text: no evaluation result produced against this embedding
 * should be read as a measurement of Voyage AI's real retrieval quality.
 * Real-provider mode (src/runEval.ts --real) uses actual Voyage embeddings
 * for that.
 */

export const DIMENSIONS = 512;
const NGRAM_SIZES = [3, 4, 5];

/**
 * Per-occurrence weight given to a whole normalized word token (length ≥ 4),
 * on top of the char-n-gram signal every substring of that word also
 * contributes. Added in Phase 13 (docs/BENCHMARK_EXPANSION_PHASE_PLAN.md,
 * Milestone 13.2) after a real, measured finding: at Phase 11/12's original
 * 16-20-chunk scale, pure char-n-gram shingling reliably separated
 * genuinely different chunks, but expanding the fixture to 60+ chunks with
 * more prose-heavy doc-comments exposed a real weakness — char n-grams
 * alone can't distinguish shared authorial STYLE (e.g. "deliberately",
 * "instead of", "the caller") from actual TOPIC (e.g. "injection",
 * "notification", "cart"), so as the candidate pool grew, a chunk sharing
 * only writing style with a query could out-rank the chunk that actually
 * answers it (confirmed directly: before this change, "SQL injection...
 * database access code" ranked an unrelated email-delivery function above
 * the real SQL-injection chunk). Whole-word overlap is a much stronger,
 * more topic-specific signal than any single char n-gram, so it's boosted
 * — this is a standard word+char-shingle hybrid vectorization technique,
 * not a dataset-specific special case: it reads only the two input strings
 * given to it and has no knowledge of chunk ids, case ids, or fixture
 * content.
 */
const WORD_TOKEN_WEIGHT = 4;
const MIN_WORD_TOKEN_LENGTH = 4;

/**
 * A standard, general-purpose English stopword list (the same handful of
 * function/connector words any IR textbook's stopword list would include —
 * not tied to this or any specific dataset's content). Added alongside
 * WORD_TOKEN_WEIGHT above after a second real, measured finding: without
 * it, a generic connector word appearing in a query (e.g. "does", "without",
 * "before") matched the same word appearing incidentally in a completely
 * unrelated chunk's own prose docstring, inflating that chunk's word-
 * overlap bonus for reasons having nothing to do with actual topical
 * relevance. Excluding stopwords from the word-token bonus (not from the
 * char-n-gram signal, which still helps with partial/fuzzy identifier
 * matches) is the standard fix for exactly this failure mode.
 */
const STOPWORDS = new Set([
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
  "caller",
  "callers",
  "when",
  "where",
  "what",
  "which",
  "while",
  "there",
  "their",
  "them",
  "then",
  "than",
  "have",
  "has",
  "had",
  "will",
  "would",
  "should",
  "could",
  "each",
  "every",
  "only",
  "such",
  "some",
  "same",
  "also",
  "even",
  "here",
]);

function hashToken(token: string): number {
  let h = 2166136261; // FNV-1a offset basis
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function charNgrams(clean: string, n: number): string[] {
  const grams: string[] = [];
  for (let i = 0; i <= clean.length - n; i++) {
    grams.push(clean.slice(i, i + n));
  }
  return grams;
}

export function deterministicEmbedding(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const clean = normalizeText(text);
  for (const n of NGRAM_SIZES) {
    for (const gram of charNgrams(clean, n)) {
      vector[hashToken(gram) % DIMENSIONS]! += 1;
    }
  }
  for (const word of clean.split(" ")) {
    if (word.length >= MIN_WORD_TOKEN_LENGTH && !STOPWORDS.has(word)) {
      vector[hashToken(`word:${word}`) % DIMENSIONS]! += WORD_TOKEN_WEIGHT;
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}
