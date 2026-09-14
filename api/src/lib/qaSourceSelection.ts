import type { SearchResult } from "../services/retrieval.js";

/** Maximum number of sources sent to the Q&A provider as evidence for one
 * question. Exported so tests assert against the real limit instead of a
 * duplicated literal. */
export const MAX_SOURCES = 8;

/** Maximum combined character budget across all selected sources' content —
 * a safety net beyond MAX_SOURCES, since Phase 8's own per-chunk cap
 * (MAX_CHUNK_CHARS = 4,000) times MAX_SOURCES could still be a lot of text. */
export const MAX_CONTEXT_CHARS = 16_000;

function overlaps(a: SearchResult, b: SearchResult): boolean {
  return a.filePath === b.filePath && a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/**
 * Deduplicates overlapping evidence (e.g. two overlapping split-pieces of
 * an oversized symbol, or a class chunk and its already-separately-ranked
 * nested method chunk) — keeping only the higher-scored chunk from each
 * overlapping group — then caps the result at MAX_SOURCES and
 * MAX_CONTEXT_CHARS. Always keeps at least one source if any exist, even if
 * it alone exceeds the character budget, mirroring chunkFile's own "always
 * emit at least one line whole" precedent (see lib/chunking.ts). Pure and
 * deterministic: the same input always produces the same selection.
 */
export function selectSources(results: SearchResult[]): SearchResult[] {
  const sorted = [...results].sort((a, b) => b.score - a.score);

  const deduped: SearchResult[] = [];
  for (const candidate of sorted) {
    if (!deduped.some((accepted) => overlaps(accepted, candidate))) {
      deduped.push(candidate);
    }
  }

  const capped = deduped.slice(0, MAX_SOURCES);

  const selected: SearchResult[] = [];
  let totalChars = 0;
  for (const result of capped) {
    if (selected.length > 0 && totalChars + result.content.length > MAX_CONTEXT_CHARS) {
      break;
    }
    selected.push(result);
    totalChars += result.content.length;
  }

  return selected;
}
