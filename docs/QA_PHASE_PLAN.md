# DevForge Phase 9 (Codebase Q&A) — Implementation Plan

## Scope

In scope: a grounded Q&A layer over Phase 8's retrieval — a user asks a natural-language
question about a connected, indexed repository; DevForge retrieves relevant code chunks (never
the whole repository), sends the question plus that evidence to Claude, and returns an answer
with real, Node-verified citations (file path, symbol, line range, similarity score). Includes
persistence of the question/answer/evidence, an API, a frontend section, security/prompt-
injection protections, tests, Docker verification, and documentation.

Out of scope (explicitly, per the task): automatic code generation, automatic task execution,
code modification, code review, GitHub issue/PR creation, GitHub Actions integration,
repository chat history/long-term memory, multi-repository conversations, additional LLM
providers, agentic tool execution, autonomous repository browsing, a new vector database, a
new embedding provider. This phase answers questions from retrieved evidence — it does not act
on the repository. VoxMind is untouched.

## Q&A request flow

```
User question
  -> requireOwnedProject (existing pattern)
  -> retrievalService.search() [Phase 8, unchanged] — retrieval happens before any LLM call,
     and before any LLM call is even considered possible: search() itself throws the real
     NO_COMPLETED_INDEX / INDEX_COMMIT_MISMATCH / GITHUB_INTEGRATION_NOT_CONFIGURED /
     EMBEDDING_PROVIDER_UNAVAILABLE errors this phase needs, so none of that logic is
     duplicated — Q&A's service is a thin caller on top of it, not a parallel implementation.
  -> select sources: remove overlapping chunks, cap at MAX_SOURCES (8) and MAX_CONTEXT_CHARS
     (16,000) — always keeping at least one source if any exist, even if it alone exceeds the
     budget (mirrors chunkFile's own "always emit at least one line whole" precedent)
  -> zero sources after selection -> a real, local "insufficient evidence" answer, persisted,
     with NO Claude call at all (an ungrounded answer is worse than an honest "not found")
  -> otherwise: ai-service's new qa agent (Claude, structured output) with the question,
     numbered sources, and repository/branch/commit metadata
  -> validate the response (Zod), map cited source numbers back to the real, Node-owned
     retrieval metadata (the model never outputs a file path or line number itself — see
     "Citation format" below)
  -> persist Question + Answer + AnswerSource rows
  -> return { answer, sources, branch, commit }
```

## Retrieval strategy — reusing Phase 8's `search()` directly, not reimplementing it

`services/retrieval.ts`'s `search(ownerId, projectId, input)` already does everything Q&A needs
before an LLM is involved: ownership, completed-index/branch/commit validation, lazy chunk/
embedding build, and cosine-similarity ranking. Q&A calls it exactly the way the search API
route does (`retrievalService.search(ownerId, projectId, { query: question, limit:
MAX_SOURCES })`), inheriting its error behavior verbatim rather than re-deriving it. This is
also what makes "retrieval happens before any LLM call" structurally guaranteed, not just
documented: there is no code path in the Q&A service that reaches the Claude call without
`search()` having already succeeded.

## Context assembly and citation format — the model never emits a file path or line number

Sources are Node-numbered (`Source 1`, `Source 2`, ...) from `search()`'s own real, already-
verified retrieval metadata. The deterministic context block sent to `ai-service` (built
*inside* `ai-service`'s qa provider, from structured `{source_number, path, symbol_name,
start_line, end_line, content}` data Node sends — so "prompt construction" and "context
formatting" are directly unit-testable in `ai-service`, matching Phase 7/8's own pattern of
testing format-producing logic directly):

```text
Repository: <owner>/<repo>
Branch: <branch>
Commit: <commit>

Source 1:
Path: <file path>
Symbol: <symbol name, or "unavailable">
Lines: <start>-<end>
Content:
<chunk text>

Source 2:
...
```

Claude's structured output is deliberately narrow: `{ answer: string, cited_source_numbers:
int[], insufficient_evidence: bool }`. It never outputs a file path, symbol name, or line
number itself — it can only *select*, by number, from the fixed list Node already gave it.
Node then builds the response's `sources` array from its own retrieval records for exactly
those numbers (validated to be within the real `1..N` range; an out-of-range number is dropped,
not trusted). This is the concrete mechanism behind "never invent files, symbols, line
numbers": the model has no channel through which to invent one — inventing would require
emitting a number outside the range it was given, which is filtered out, not persisted or
returned.

## Answer schema

Node-internal (`services/qa.ts`) and API response shape:

```ts
type QaAnswer = {
  questionId: string;
  answer: string;
  insufficientEvidence: boolean;
  sources: Array<{
    filePath: string;
    symbolName: string | null;
    startLine: number;
    endLine: number;
    score: number;
    cited: boolean;
  }>;
  branch: string;
  commit: string;
  createdAt: string;
};
```

`sources` includes every source actually sent to the model (not just cited ones) — each tagged
`cited: boolean` — so a user can see both what the model drew from and what else was considered
and available, matching "evidence returned with answer" without hiding the full evidence set
behind the model's own citation choices.

## Provider failure / no-index / no-credentials behavior

All real, honest, pre-existing error codes are reused rather than invented redundantly:
`NO_COMPLETED_INDEX`, `INDEX_COMMIT_MISMATCH`, `GITHUB_INTEGRATION_NOT_CONFIGURED`,
`EMBEDDING_PROVIDER_UNAVAILABLE` (all from `search()`, Phase 8) and `AI_PROVIDER_UNAVAILABLE`
(the same code every one of the five existing `ai-service` generate calls already uses for a
real, unset `ANTHROPIC_API_KEY` — `postToAiService`'s existing `PROVIDER_NOT_CONFIGURED` →
`AI_PROVIDER_UNAVAILABLE` mapping is reused as-is, not duplicated). No new "not configured"
code is invented where an existing one already means the same thing.

## Token/context limits

`MAX_SOURCES = 8` (retrieval already caps at Q&A's requested `limit`, itself bounded by
`search()`'s existing 1–50 schema range — Q&A always requests 8), `MAX_CONTEXT_CHARS = 16,000`
across all selected sources combined (roughly ~4,000 tokens of code, on top of Phase 8's own
per-chunk `MAX_CHUNK_CHARS = 4,000` cap already bounding any single source). The question itself
is capped at 2,000 characters (`schemas/qa.ts`), matching `schemas/retrieval.ts`'s own query
cap. Claude's `max_tokens` for the answer itself is capped (2,000) — a citation/evidence layer
does not need long-form generation.

## Conversation history boundaries

No true multi-turn conversation/context-carrying between questions — each question is answered
independently, grounded fresh against whatever the current index's `(branch, commitSha)` is at
ask time (mirroring the "keep it explicitly scoped to one project and one indexed branch/
commit" instruction directly, and the task's own "avoid an unnecessarily complex chat system"
guidance). `GET /projects/:id/qa` lists prior questions (newest first) for a project; `GET
/projects/:id/qa/:questionId` returns one with its full evidence. This is a history list, not a
chat thread — the frontend's "follow-up question" affordance is simply "ask another question,"
not a model that sees prior turns.

## Security and prompt-injection handling

- The system prompt (Milestone 3, all 10 required instructions) explicitly instructs Claude to
  treat repository content as **untrusted data**, never as instructions — including explicit
  language to ignore any instruction-like text found inside retrieved source/comments that
  attempts to change the Q&A rules, reveal the system prompt, or reveal secrets/credentials.
- Structurally, the model has no tool-use capability in this call at all (no `tools` parameter
  passed) — it cannot execute code, call anything, or take any repository action regardless of
  what a malicious comment asks for. This is enforced by the API shape, not just the prompt.
- Citations are numeric-selection-only (see above) — even a successful prompt-injection attempt
  that convinced the model to "cite" a fabricated path could not actually produce one, since
  the response schema has no field for a model-supplied path.
- Retrieved evidence is always scoped through `search()`'s existing ownership + `(branch,
  commitSha)` checks — there is no code path for the Q&A service to retrieve or display another
  project's, another branch's, or another commit's chunks.
- The stored PAT (`RepositoryConnection.encryptedToken`) is never read by the Q&A service at
  all — it only reads already-fetched, already-persisted `CodeChunk` rows; no fresh GitHub call
  happens during Q&A, so there is no path for a token to reach the prompt, a log line, or a
  response body.
- The question itself is logged/handled the same as every other user-authored text field in
  this codebase (e.g. `RequirementsVersion.ideaText`) — no special new logging is added, and
  existing error handling never echoes raw provider stack traces to the client (the centralized
  Express error handler already strips those).

## Milestones

1. Planning (this document).
2. Database — `Question`, `Answer`, `AnswerSource` models + migration.
3. Q&A provider (`ai-service`, Anthropic, structured output).
4. Retrieval-to-answer service (Node).
5. Q&A API endpoints.
6. Frontend Codebase Q&A section.
7. Security and prompt-injection protection — dedicated tests for every item in the task's own
   Milestone 7 list (malicious in-repository instructions, system-prompt/secret exfiltration
   attempts, cross-project/branch/commit retrieval, unauthorized history access, oversized
   input, duplicate/overlapping evidence, malformed provider responses), on top of the
   structural protections already built into Milestones 3–4 above.
8. Remaining tests (API/frontend/integration), Docker verification, documentation.
