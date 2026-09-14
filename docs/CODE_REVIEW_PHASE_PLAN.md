# DevForge Phase 10 (AI Code Review) — Implementation Plan

## Scope

In scope: a read-only AI code-review layer over Phase 8's retrieval — a user submits a review
scope (a natural-language description of what to review, or a sensible default covering the
whole indexed codebase); DevForge retrieves relevant code chunks (never the whole repository),
sends the scope plus that evidence to Claude, and returns a set of findings (title, description,
severity, category, confidence, recommendation) each grounded in real, Node-verified evidence
(file path, symbol, line range). Includes persistence of the review/findings/evidence, an API, a
frontend section, security/prompt-injection/false-positive protections, tests, Docker
verification, and documentation.

Out of scope (explicitly, per the task): automatic code modification, automatic code generation,
automatic task execution, automatic commits, pull-request creation, GitHub issue creation,
GitHub Actions integration, autonomous tool execution, arbitrary command execution, repository-
wide unrestricted model context, a new vector database, a new embedding provider, additional LLM
providers, full IDE integration, continuous background scanning, automatic remediation. The
reviewer may *recommend* changes in a finding's `recommendation` text; it must never apply one.
VoxMind is untouched.

## Review request flow

```
User review scope (or a default scope when omitted)
  -> requireOwnedProject (existing pattern)
  -> retrievalService.search() [Phase 8, unchanged] — retrieval happens before any LLM call, and
     before any LLM call is even considered possible: search() itself throws the real
     NO_COMPLETED_INDEX / INDEX_COMMIT_MISMATCH / GITHUB_INTEGRATION_NOT_CONFIGURED /
     EMBEDDING_PROVIDER_UNAVAILABLE errors this phase needs, so none of that logic is
     duplicated — the review service is a thin caller on top of it, exactly like Q&A's.
  -> select sources: remove overlapping chunks, cap at MAX_SOURCES (8) and MAX_CONTEXT_CHARS
     (16,000) — reusing lib/qaSourceSelection.ts's selectSources() verbatim (it is already
     generic over Phase 8's SearchResult, not Q&A-specific) rather than inventing a second,
     parallel cap/dedup implementation for review evidence.
  -> zero sources after selection -> a real, local "no relevant code found" review, persisted as
     completed with zero findings, with NO Claude call at all (an ungrounded review is worse
     than an honest "nothing found")
  -> otherwise: persist a CodeReview row (status "pending") and its CodeReviewSource rows
     immediately — durable evidence + a durable row to mark "failed" against if the provider
     call itself fails (see "Provider failure behavior" below; this is a deliberate improvement
     over Phase 9's Question/Answer split, applying the Phase 7 "persist a failed row, don't
     leave an orphan" lesson to a case Q&A itself doesn't fully cover)
  -> ai-service's new review agent (Claude, structured output) with the scope, numbered sources,
     and repository/branch/commit metadata
  -> validate the response (Zod), filter findings to only those citing real, in-range source
     numbers (dropping any finding left with zero valid citations — an uncited finding is not
     evidence-based and is discarded, never persisted)
  -> persist CodeReviewFinding rows + a CodeReviewFindingSource join per citation; mark the
     CodeReview "completed" with its summary and finding count
  -> return { review, findings } with each finding's trusted file path / symbol / line range
     resolved from Node's own CodeReviewSource -> CodeChunk records, never from model text
```

## Review scope

A review scope is free text describing what to review (e.g. "Review the authentication
implementation for security issues"), used verbatim as the retrieval query — the same role a
question's text plays in Q&A. When omitted, a fixed default scope is used:

> "Perform a general code review of the indexed codebase, looking for bugs, security issues,
> reliability problems, performance concerns, and maintainability issues."

This keeps "scope is optional" honest: an omitted scope does not skip retrieval or send the
model the whole repository — it retrieves whatever the default scope's own embedding ranks as
most relevant, exactly like any other scope text would.

## Retrieval strategy — reusing Phase 8's `search()` and Phase 9's `selectSources()` directly

`services/retrieval.ts`'s `search(ownerId, projectId, input)` already does everything a review
needs before an LLM is involved: ownership, completed-index/branch/commit validation, lazy
chunk/embedding build, and cosine-similarity ranking against the scope text as the query. The
review service calls it exactly the way Q&A does
(`retrievalService.search(ownerId, projectId, { query: scope, limit: MAX_SOURCES })`), inheriting
its error behavior verbatim. `lib/qaSourceSelection.ts`'s `selectSources()` (overlap dedup +
`MAX_SOURCES`/`MAX_CONTEXT_CHARS` caps) is reused unchanged — it operates on Phase 8's
`SearchResult[]` and has no Q&A-specific type or field in its signature, so importing it directly
into the review service is a genuine reuse, not a coincidental lookalike. This is also what makes
"retrieval happens before any LLM call, and the whole repository is never sent" structurally
guaranteed for review the same way it is for Q&A: there is no code path in the review service
that reaches the Claude call without `search()` and `selectSources()` having already run.

## Review categories

Controlled Prisma enum `CodeReviewFindingCategory`: `bug`, `security`, `reliability`,
`performance`, `maintainability`, `validation`, `error_handling`, `testing`, `architecture`,
`other` — exactly the task's suggested list. `ai-service`'s Pydantic schema uses the same values
as a `Literal`/`Enum` type, so an invalid category is a structured-output *parse failure*
(`AIResponseInvalidError`), not a value that reaches Node and needs separate validation — the
type system itself is the guard.

## Severity levels

Controlled Prisma enum `CodeReviewFindingSeverity`: `critical`, `high`, `medium`, `low`, `info` —
the task's suggested list, same enforcement mechanism as category (Pydantic enum -> parse
failure on an invalid value, never a free string reaching the database).

## Confidence handling

Controlled Prisma enum `CodeReviewFindingConfidence`: `high`, `medium`, `low`. The system prompt
explicitly instructs the model to prefer `low`/`medium` confidence and "potential issue" language
whenever the supplied evidence doesn't fully confirm a problem, rather than either fabricating
certainty or omitting a real-but-uncertain risk — this is the direct mechanism behind the task's
"avoid claiming certainty when evidence is incomplete" and "distinguish confirmed issues from
potential risks" requirements.

## Finding schema

`ai-service` structured output (mirrors `QaAnswerContent`'s citation-safety shape exactly):

```json
{
  "summary": "Short overall review summary.",
  "findings": [
    {
      "title": "Missing authorization check",
      "description": "The endpoint appears to rely on project lookup without verifying ownership.",
      "severity": "high",
      "category": "security",
      "confidence": "high",
      "recommendation": "Add an explicit ownership check before returning project data.",
      "cited_source_numbers": [1, 3]
    }
  ]
}
```

A finding never carries a file path, symbol name, or line number field — only `title`,
`description`, `severity`, `category`, `confidence`, `recommendation`, and
`cited_source_numbers: int[]`, a selection from the fixed, Node-numbered source list already
supplied in the request. This is the same structural guarantee Phase 9 built for Q&A citations,
applied here: the model has no channel through which to invent a path or line number, because no
such field exists for it to populate.

## Evidence and citation rules

Node-side persistence never trusts a model-supplied location. `CodeReviewSource` rows (one per
retrieved-and-selected chunk, keyed to the review, not to any one finding — mirroring
`AnswerSource`'s "every source sent, not just cited ones" shape) are the only source of trusted
`filePath`/`symbolName`/`startLine`/`endLine`, resolved through `CodeChunk` -> `IndexedFile`/
`Symbol`, exactly like `AnswerSource` -> `CodeChunk` in Phase 9. A `CodeReviewFindingSource` join
row (`findingId`, `sourceId`) records which of the review's sources each finding actually cites —
a many-to-many relation, since one finding may cite several sources and one source may support
several findings, which `AnswerSource`'s one-answer-to-many-sources shape didn't need to express
but a review-with-many-findings does. A finding's API-visible "primary" file/symbol/line-range is
the first cited source's trusted metadata; its full cited-source list is also returned so a user
can see every piece of evidence behind a finding, not just the first.

## Duplicate finding handling

Two layers, matching how duplicate/overlapping *evidence* is already handled in `selectSources()`
one layer down:

- **Evidence-level**: `selectSources()` already removes overlapping source chunks before they
  ever reach the model, so two findings can't trivially arise from the literal same overlapping
  text presented as two different sources.
- **Instruction-level**: the system prompt explicitly instructs the model not to report the same
  underlying issue more than once across its own findings list (Milestone 7's "avoid duplicate
  findings covering the same source and issue" requirement) — a prompt-level control, tested for
  its mechanical prerequisite (the instruction is actually present in the system prompt) rather
  than for live-model compliance, consistent with how every other LLM-behavior guarantee in this
  codebase is tested (see "Security and prompt-injection handling" below).

No automatic near-duplicate-finding merging is implemented — the task calls for "avoid[ing]"
duplicates via evidence hygiene and instruction, not a similarity-clustering system, which would
be exactly the kind of "complex autonomous agent" behavior the task tells this phase not to
build.

## Confidence / false-positive controls

Directly addressing the task's Milestone 7 "basic false-positive controls" list:

- Every finding must cite at least one real source (enforced twice: `ai-service`'s provider
  filters `cited_source_numbers` to the real `1..N` range and then drops any finding left with
  zero citations; Node independently re-validates the same way before persisting — the same
  defense-in-depth shape as Phase 9's citation filtering).
- The system prompt instructs the model to prefer "potential issue" phrasing over asserted
  certainty when evidence is incomplete, to never report a generic style preference as a defect,
  and to never report a finding solely because a pattern looks unfamiliar rather than
  demonstrably risky (task's own listed examples, used near-verbatim in the prompt).
- An empty `findings: []` list is an explicitly valid, encouraged response — the prompt states
  outright that a review with no supported issues should return no findings rather than
  manufacturing ones to "look useful," and the zero-evidence path (no sources at all) never even
  reaches the model, returning a real "no relevant code found" result instead.

## Maximum context size

Identical to Phase 9's Q&A budget, reused rather than re-derived: `MAX_SOURCES = 8`,
`MAX_CONTEXT_CHARS = 16,000` across all selected sources combined (`lib/qaSourceSelection.ts`,
unchanged). A review scope is capped at 2,000 characters (`schemas/codeReview.ts`, matching
`schemas/qa.ts`'s question cap). Claude's `max_tokens` for the review response is capped higher
than Q&A's single-answer budget (4,000 vs. 2,000) since a review response is a summary plus a
list of structured findings rather than one paragraph, but is still a hard, fixed ceiling — not
unbounded generation.

## Provider failure behavior

Reuses every existing, honest error code rather than inventing redundant ones:
`NO_COMPLETED_INDEX`, `INDEX_COMMIT_MISMATCH`, `GITHUB_INTEGRATION_NOT_CONFIGURED`,
`EMBEDDING_PROVIDER_UNAVAILABLE` (all from `search()`, Phase 8) and `AI_PROVIDER_UNAVAILABLE`
(the same code every existing `ai-service` generate/Q&A call already uses for a real, unset
`ANTHROPIC_API_KEY`, via `postToAiService`'s existing `PROVIDER_NOT_CONFIGURED` mapping, reused
as-is). One genuine improvement over Phase 9: because a `CodeReview` row (and its
`CodeReviewSource` evidence) is persisted *before* the provider call — once retrieval has
already produced usable evidence — a provider-side failure after that point (network error,
malformed structured output) updates that same row to `status: "failed"` with an error message,
rather than leaving an orphaned, answerless row the way a Q&A `Question` can in the equivalent
failure window. The HTTP response for that request is still a real, non-2xx error (the failure
is never hidden from the caller); the durable row is purely for review-history legibility.

## Security and prompt-injection handling

- The system prompt (Milestone 3, all 13 required instructions) explicitly instructs Claude to
  treat repository content as **untrusted data**, never as instructions — including explicit
  language to ignore any instruction-like text found inside retrieved source/comments that asks
  it to fix code, run commands, commit changes, open a pull request, reveal the system prompt, or
  reveal secrets/credentials.
- Structurally, the model has no tool-use capability in this call at all (no `tools` parameter
  passed) — it cannot execute code, call anything, modify a file, or take any repository action
  regardless of what a malicious comment or a malicious review scope asks for. This is enforced
  by the API shape, not just the prompt — the same structural guarantee Phase 9 relies on.
- Findings are numeric-citation-only (see "Finding schema" above) — even a successful
  prompt-injection attempt that convinced the model to "cite" a fabricated path could not
  actually produce one, since the response schema has no field for a model-supplied path.
- Retrieved evidence is always scoped through `search()`'s existing ownership + `(branch,
  commitSha)` checks — there is no code path for the review service to retrieve or display
  another project's, another branch's, or another commit's chunks.
- The stored PAT (`RepositoryConnection.encryptedToken`) is never read by the review service
  directly — it only reads already-fetched, already-persisted `CodeChunk` rows (via `search()`,
  which itself only decrypts the token when building chunks that don't yet exist); no path
  exists for a token to reach the review prompt, a log line, or a response body.
- A review scope requesting code modification, command execution, commits, or PR/issue creation
  (e.g. "Fix this automatically", "Run the tests", "Open a pull request") is handled the same way
  as any other scope text: it is passed to retrieval as a query (which will simply rank whatever
  code is textually/semantically closest to it) and to the model, whose system prompt instructs
  it to explain that it can only report findings and recommendations, never take the requested
  action — tested at the mechanical level (the refusal instruction is present, the API never
  executes anything, no tool/execution code path exists anywhere in the review stack) rather than
  asserting live-model compliance, consistent with how every other LLM-behavior guarantee in this
  codebase is tested.

## How a review is pinned to a branch and commit

Identical precedent to `Question`/`CodeChunk`: `CodeReview.branch`/`commitSha` are denormalized
from the owning `CodebaseIndex` at review-creation time, so a past review's indexed state remains
visible even after a later reindex changes the index's current commit. `CodeReviewSource`
references `CodeChunk` directly (not a copy of its fields), so — matching `AnswerSource`'s
documented, accepted limitation — a reindex's cascade deletion of superseded `CodeChunk` rows
removes a past review's detailed evidence rows too, while the review's own summary, findings, and
their severity/category/confidence/recommendation text remain intact (findings do not duplicate
chunk content, only reference it).

## Milestones

1. Planning (this document).
2. Database — `CodeReview`, `CodeReviewSource`, `CodeReviewFinding`, `CodeReviewFindingSource`
   models + migration.
3. Review provider (`ai-service`, Anthropic, structured output).
4. Retrieval-to-review service (Node).
5. Code Review API endpoints.
6. Frontend Code Review section.
7. Security, quality, and false-positive controls — dedicated tests for every item in the task's
   own Milestone 7 list (malicious in-repository instructions, system-prompt/secret exfiltration
   attempts, invented source numbers/paths/line ranges, invalid severity/category values,
   malformed provider output, cross-project/branch/commit retrieval, unauthorized history access,
   oversized scopes, oversized context, requests asking for modification/execution/commits/PRs),
   on top of the structural protections already built into Milestones 3–4 above.
8. Remaining tests (API/AI-service/frontend/integration), Docker verification, documentation.
