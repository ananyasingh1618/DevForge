/** Cosine similarity between two equal-length vectors, in [-1, 1] (in
 * practice [0, 1] for embedding models like Voyage's, whose vectors are not
 * expected to point in opposing directions). Used to rank code chunks
 * against a query embedding — see services/retrieval.ts. Throws if the
 * vectors aren't the same length, since that would silently produce a
 * meaningless score rather than a real error. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Cannot compare vectors of different lengths (${a.length} vs ${b.length})`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
