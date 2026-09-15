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
