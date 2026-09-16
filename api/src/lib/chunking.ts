import { createHash } from "node:crypto";

/**
 * Turns a Phase 7 parsed file's content and extracted symbols into
 * deterministic, source-location-preserving code chunks — pure
 * string-slicing, no network/DB access, so it's trivially unit-testable and
 * belongs in the Node API next to the rest of the codebase-index pipeline
 * (see docs/RETRIEVAL_PHASE_PLAN.md for why this isn't an ai-service
 * concern).
 */

/** A single-symbol chunk budget. Deliberately generous (~1000 tokens) — see
 * docs/RETRIEVAL_PHASE_PLAN.md. Exported so tests assert against the real
 * constant, not a duplicated literal. */
export const MAX_CHUNK_CHARS = 4000;
export const CHUNK_OVERLAP_CHARS = 200;

export type SymbolForChunking = {
  id: string;
  startLine: number;
  endLine: number;
};

export type FileForChunking = {
  fileId: string;
  content: string;
  language: string;
  symbols: SymbolForChunking[];
};

export type ChunkResult = {
  fileId: string;
  symbolId: string | null;
  chunkIndex: number;
  content: string;
  contentHash: string;
  language: string;
  startLine: number;
  endLine: number;
};

type LinePiece = { content: string; startLine: number; endLine: number };

/**
 * Splits `lines` (1-indexed starting at `baseStartLine`) into pieces of at
 * most MAX_CHUNK_CHARS, with roughly CHUNK_OVERLAP_CHARS of trailing-line
 * overlap between consecutive pieces. A single line longer than
 * MAX_CHUNK_CHARS is still emitted whole (never split mid-line) — the
 * budget is a target, not a hard cap, so source lines stay intact and
 * readable. Deterministic: identical input always produces identical
 * output.
 */
function windowLines(lines: string[], baseStartLine: number): LinePiece[] {
  if (lines.length === 0) {
    return [];
  }

  const pieces: LinePiece[] = [];
  let i = 0;

  while (i < lines.length) {
    let charCount = 0;
    let j = i;
    while (j < lines.length && charCount + (lines[j]?.length ?? 0) + 1 <= MAX_CHUNK_CHARS) {
      charCount += (lines[j]?.length ?? 0) + 1;
      j++;
    }
    if (j === i) {
      // A single line alone exceeds the budget — include it whole rather
      // than looping forever or splitting mid-line.
      j = i + 1;
    }

    pieces.push({
      content: lines.slice(i, j).join("\n"),
      startLine: baseStartLine + i,
      endLine: baseStartLine + j - 1,
    });

    if (j >= lines.length) {
      break;
    }

    // Step the next window's start back by however many trailing lines fit
    // within CHUNK_OVERLAP_CHARS, guaranteeing forward progress.
    let overlapChars = 0;
    let k = j;
    while (k > i && overlapChars < CHUNK_OVERLAP_CHARS) {
      k--;
      overlapChars += (lines[k]?.length ?? 0) + 1;
    }
    i = Math.max(k, i + 1);
  }

  return pieces;
}

function contentHashOf(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function toChunkResults(
  file: FileForChunking,
  symbolId: string | null,
  pieces: LinePiece[],
): ChunkResult[] {
  return pieces.map((piece, chunkIndex) => ({
    fileId: file.fileId,
    symbolId,
    chunkIndex,
    content: piece.content,
    contentHash: contentHashOf(piece.content),
    language: file.language,
    startLine: piece.startLine,
    endLine: piece.endLine,
  }));
}

/**
 * One chunk per symbol (oversized symbols split via windowLines, preserving
 * their own precise line ranges); a parsed file with zero symbols falls
 * back to windowing the whole file instead, producing `symbolId: null`
 * chunks. Never called for unsupported/binary/skipped files — those are
 * excluded before this function is ever invoked (see
 * services/retrieval.ts).
 */
export function chunkFile(file: FileForChunking): ChunkResult[] {
  // A genuinely empty (or whitespace-only) file — e.g. a Python package's
  // conventional empty __init__.py — has nothing worth chunking. Without
  // this check, "".split("\n") returns [""] (length 1, not 0), so the
  // symbol-less-file fallback below would build a single chunk whose
  // content is "" instead of correctly producing zero chunks. Found live:
  // a real embedding provider (Voyage) rejects an entire batch request
  // outright when any text in it is an empty string, so one such chunk
  // could break embedding for every other chunk batched alongside it.
  if (file.content.trim() === "") {
    return [];
  }

  // A trailing newline (the overwhelmingly common case for real source
  // files) makes split("\n") emit one phantom empty trailing element —
  // without trimming it, a symbol-less file's fallback chunk would report
  // an endLine one past the file's real last line.
  const rawLines = file.content.split("\n");
  const lines =
    file.content.endsWith("\n") && rawLines[rawLines.length - 1] === ""
      ? rawLines.slice(0, -1)
      : rawLines;

  if (file.symbols.length === 0) {
    return toChunkResults(file, null, windowLines(lines, 1));
  }

  const results: ChunkResult[] = [];
  for (const symbol of file.symbols) {
    const symbolLines = lines.slice(symbol.startLine - 1, symbol.endLine);
    results.push(...toChunkResults(file, symbol.id, windowLines(symbolLines, symbol.startLine)));
  }
  return results;
}
