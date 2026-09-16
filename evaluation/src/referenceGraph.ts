/**
 * Lightweight, general-purpose call/import-reference detection over a
 * candidate pool's own already-fetched content — no new parser, no new
 * database schema, no dependency on Phase 7's AST symbol extraction. For
 * each pair of candidates in the pool, this checks whether candidate A's
 * text literally contains a call-shaped or import-shaped mention of
 * candidate B's own symbol name (`symbolName(` for a call, or an
 * `import`/`from ... import` line naming it for an import) — a real,
 * general static-text signal that works for any indexed TypeScript/
 * JavaScript/Python code, not a benchmark-specific lookup.
 *
 * This intentionally does not attempt real cross-file resolution (which
 * import binds to which actual file) — it only needs to answer "does this
 * candidate's own text reference that candidate's own name," which is
 * enough to support intent-driven reranking (Workstream 2, "Multi-query
 * retrieval"/"Reranking"; Workstream 3, "dependency tracing" intent) without
 * requiring a real code graph. A relationship it misses (e.g. a call
 * reached through an alias) simply doesn't contribute a bonus — a false
 * negative here costs nothing beyond not applying a rerank bonus; it never
 * fabricates evidence or changes what content is actually shown.
 */

export type ReferenceCandidate = { chunkId: string; symbolName: string | null; content: string };

/** True if `content` contains a call-shaped mention of `symbolName` — the
 * identifier immediately followed by `(` (after optional whitespace),
 * matching TS/JS/Python call syntax uniformly. Requires a real word
 * boundary before the identifier so a longer identifier that merely
 * contains this one as a substring (e.g. `findOrdersByUserIdAndStatus`
 * vs `findOrdersByUserId`) is never mistaken for a call to it.
 *
 * Excludes the identifier's own *declaration* line first — mirrors
 * api/src/lib/referenceGraph.ts's own fix exactly, see that file for the
 * full rationale (a real, general bug: two different files each defining
 * their own function under the same name would otherwise incorrectly
 * appear to "call" each other). */
function containsCallTo(content: string, symbolName: string): boolean {
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declarationPattern = new RegExp(`\\b(function|def|class|async\\s+function)\\s+${escaped}\\s*\\(`);
  const withoutDeclaration = content.replace(declarationPattern, "");
  return new RegExp(`\\b${escaped}\\s*\\(`).test(withoutDeclaration);
}

/** True if any single line of `content` both looks like an import/require
 * statement (ES `import`, CommonJS `require`, or Python `from`/`import`)
 * and names `symbolName` as a whole word on that same line — an ES
 * `import { symbolName }`/`import symbolName`, a CommonJS `require(...)`
 * destructure naming it, or a Python `from x import symbolName` /
 * `import symbolName`. Restricted to a single line (rather than the whole
 * content) so an unrelated later call/mention of the same name elsewhere
 * in the chunk is never mistaken for the import line itself. */
function containsImportOf(content: string, symbolName: string): boolean {
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = new RegExp(`\\b${escaped}\\b`);
  const importLinePattern = /\b(import|require|from)\b/;
  return content.split("\n").some((line) => importLinePattern.test(line) && boundary.test(line));
}

/**
 * Builds a directed reference graph over one candidate pool: an edge
 * `from -> to` means `from`'s own content contains a call- or import-
 * shaped mention of `to`'s symbol name. O(n^2) over the candidate pool
 * (bounded by a single search's candidate count, not the whole indexed
 * repository), computed fresh per search — no persistence, no new schema.
 */
export function buildReferenceGraph(candidates: ReferenceCandidate[]): Map<string, Set<string>> {
  const outgoing = new Map<string, Set<string>>();
  for (const from of candidates) {
    const edges = new Set<string>();
    for (const to of candidates) {
      if (from.chunkId === to.chunkId || !to.symbolName || to.symbolName.length < 3) continue;
      if (containsCallTo(from.content, to.symbolName) || containsImportOf(from.content, to.symbolName)) {
        edges.add(to.chunkId);
      }
    }
    outgoing.set(from.chunkId, edges);
  }
  return outgoing;
}

/** True if `a` references `b`, or `b` references `a` — used by reranking
 * and the coherence-aware cutoff to treat a caller/callee pair (in either
 * direction) as one coherent evidence group, independent of which one
 * happens to be the query's primary target. */
export function areLinked(graph: Map<string, Set<string>>, a: string, b: string): boolean {
  return (graph.get(a)?.has(b) ?? false) || (graph.get(b)?.has(a) ?? false);
}
