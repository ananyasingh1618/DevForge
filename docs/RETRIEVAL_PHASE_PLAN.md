# DevForge Phase 8 (Retrieval & Semantic Search) — Implementation Plan

## Scope

In scope: turning Phase 7's AST index into searchable code chunks, generating embeddings for
those chunks and for a user's query, storing vectors, ranking by similarity, an API endpoint
that returns relevant chunks with file/symbol/location/score metadata, branch/commit
validation against the current index, a frontend Code Search section, tests, Docker
verification, and documentation.

Out of scope (explicitly, per the task): codebase Q&A, chat with the repository, code review,
automatic code generation, automatic task execution, GitHub issue/PR creation, GitHub Actions
integration, additional LLM providers. This phase returns ranked, relevant *chunks* — it does
not synthesize an answer from them. VoxMind is untouched.

## Vector storage — decision: `Float[]` columns + application-level cosine similarity, not pgvector

Evaluated against the task's own four options:

1. **pgvector** — rejected as the default choice. It would require switching
   `docker-compose.yml`'s `postgres:16-alpine` image to a `pgvector/pgvector:pg16`-style image
   (a real Docker config change), `CREATE EXTENSION vector` in a migration, and Prisma's
   `Unsupported("vector(n)")` escape hatch plus hand-written raw SQL (`$queryRaw`) for every
   similarity query, since Prisma 7 has no native vector type or distance-operator support.
   That's real, unavoidable extra surface area for a project whose realistic scale (one
   connected repository's chunks per project, at Phase 7's own file/size caps) does not need
   approximate-nearest-neighbor indexing to stay fast.
2. **An external vector database** (e.g. Pinecone/Qdrant/Weaviate) — rejected outright: a new
   network dependency, a new account/credential, and a second datastore for data that fits
   comfortably in the one Postgres instance this project already runs — directly against the
   task's own "do not introduce a separate database unnecessarily."
3. **A lightweight local vector store** (a separate embedded index file, e.g. FAISS/usearch on
   disk) — rejected: it would need its own persistence/backup story independent of the
   Postgres data it's derived from, and a new native dependency in `ai-service` (or `api`)
   whose install footprint hasn't been verified the way tree-sitter's was in Phase 7.
4. **Chosen: plain PostgreSQL `Float[]` columns, ranked with cosine similarity computed in the
   Node API.** Postgres arrays are a first-class, already-relied-upon Prisma/Postgres feature
   (confirmed with a real `double precision[]` column against the running dev database before
   committing to the schema) — no new extension, no new image, no raw SQL. Cosine similarity
   between a query vector and a project's chunk vectors is a handful of multiplications; at
   this project's scale a linear scan in the Node process (which already owns "fetch, apply
   business logic, return sanitized result" for every other feature) is fast and needs no new
   infrastructure. This is the same "smallest reliable approach" reasoning Phase 6 used for PAT
   over OAuth and Phase 7 used for a synchronous request over a job queue — documented as a
   deliberate simplicity tradeoff with an explicit scaling limitation (see below), not an
   oversight.

## Embedding provider — decision: Voyage AI (`voyage-code-3`), not a local model

The task explicitly warns not to assume Anthropic provides an embeddings API — correct: Claude
has no embeddings endpoint. Anthropic's own documentation recommends Voyage AI as its
embeddings partner, which makes Voyage the "Anthropic-compatible architecture" answer among the
task's own options, and it ships a model purpose-built for this exact feature,
`voyage-code-3`, a code-retrieval embedding model. Confirmed the endpoint is real before
adopting it: `curl -X POST https://api.voyageai.com/v1/embeddings` with a fake key returns a
genuine `{"detail":"Provided API key is invalid."}` / 401 — the same "real endpoint, fake
credential, real rejection" check Phase 6 did for the GitHub API and Phase 7 did for
`pip download` against `manylinux` wheels.

A local embedding model (e.g. `sentence-transformers`) was considered and rejected: it would
add a heavy native/ML dependency whose Docker install footprint is unverified (unlike
tree-sitter's confirmed-lightweight wheels), and would need model weights either baked into the
image or downloaded at container start — meaningfully different risk from every other
dependency this project has adopted. Using Voyage AI instead keeps this feature honest in
exactly the same shape as every other AI capability in DevForge: a real provider, gated by an
optional API key read at call time (`VOYAGE_API_KEY`, mirroring `ANTHROPIC_API_KEY` and
`GITHUB_TOKEN_ENCRYPTION_KEY` exactly), with a real 503 `PROVIDER_NOT_CONFIGURED` when unset —
never a fabricated vector. This environment has no `VOYAGE_API_KEY`, so — exactly like every
prior phase's LLM/GitHub dependency — the honest "not configured" path is what gets verified
for real in this environment; a `FakeEmbeddingProvider` test double (mirroring
`FakeTasksProvider` etc. in every existing `ai-service` test file) provides deterministic
vectors for the normal test suite, which never needs paid credentials.

Implementation: a sixth `ai-service` agent, `app/agents/embeddings/` (`provider.py` +
`router.py`), following the exact structure of the other five — `EmbeddingProvider` ABC,
`get_provider()` called inside the route handler (after body validation, matching the bug fix
already documented in `app/agents/requirements/router.py`), one real implementation
(`VoyageEmbeddingProvider`). `POST /embeddings/generate` accepts a batch (`{texts: string[],
input_type: "document" | "query"}`) — Voyage's asymmetric embedding: chunks are embedded as
`"document"`, a search query as `"query"`, which measurably improves retrieval quality over
embedding both the same way — and returns `{model, dimensions, embeddings: number[][]}` in
input order. Batching one HTTP call per chunking run (rather than one call per chunk) keeps
indexing a project's chunks from being a chunk-count-many-round-trips operation.

## Chunking — reusing Phase 7's AST index, not a second parser

Chunking is pure string-slicing over data Phase 7 already computed and persisted (`IndexedFile`,
`Symbol`), so it belongs in the Node API next to `services/codebaseIndex.ts`, not in
`ai-service` — the same "Node owns data/orchestration, ai-service owns one specialized
capability" split every phase has used. Concretely, for the project's current, `completed`
`CodebaseIndex`:

- Only `IndexedFile` rows with `parseStatus: "parsed"` are chunked. Files recorded as
  `unsupported`/`skipped_*` are deliberately excluded — Phase 7 never determined a language or
  retained their content, and chunking raw, un-language-identified bytes as "code" would be a
  materially different, lower-quality feature not in scope here.
- File content isn't stored anywhere (Phase 7 deliberately never stores source), so chunking
  re-fetches each file's raw bytes from GitHub via `githubClient.getBlob(token, owner, repo,
  sha)` — using `IndexedFile.contentHash`, which Phase 7 deliberately set to the git blob SHA
  (not a re-hash of fetched bytes) specifically "for future change-detection." That design
  choice is what makes this refetch a single, direct blob lookup rather than needing a second
  tree/path resolution step.
- **One chunk per `Symbol`** (every symbol, not just top-level ones — a class chunk and its
  nested method's chunk are both independently useful search targets, and multi-granularity
  chunking is standard practice for code search). A symbol's chunk text is the file's
  `startLine..endLine` slice.
- **Oversized symbols**: if a symbol's sliced text exceeds `MAX_CHUNK_CHARS` (4000, roughly
  ~1000 tokens — a deliberately generous single-symbol budget), it's split into sequential
  sub-chunks of `MAX_CHUNK_CHARS` with `CHUNK_OVERLAP_CHARS` (200) of overlap between
  consecutive pieces, each still tagged with the same file/symbol reference and its own
  precise `startLine`/`endLine` recomputed from the split point.
- **Files without symbols** (a parsed, supported-language file that yielded zero extracted
  symbols — e.g. a file of only imports/constants): the same size/overlap windowing is applied
  to the whole file's content instead, producing `symbolId: null` chunks.
- **Determinism**: no randomness anywhere in this pipeline — same file content + same symbol
  list always produces the same chunk boundaries and text, byte for byte.
- Each chunk records `branch`/`commitSha` (denormalized from the owning `CodebaseIndex` at
  chunking time) and a `contentHash` (SHA-256 of the chunk's own text) that is this schema's
  real dedup key — `@@unique([codebaseIndexId, commitSha, contentHash])` — rather than trying
  to encode uniqueness through a nullable `symbolId`, which Postgres would not enforce reliably
  (`NULL <> NULL` in a unique index).

## Retrieval flow — lazy build, persisted for reuse (Milestone 4)

One endpoint, `POST /projects/:id/search`, does all of the following inside a single request
— matching Phase 7's own "synchronous, capped request" precedent rather than a background job:

1. Resolve project ownership, the connected repository, and the project's `CodebaseIndex` —
   it must exist and be `status: "completed"` (400 `NO_COMPLETED_INDEX` otherwise: covers both
   "no repository connected" and "index not yet built/failed" as the same real, honest
   dependency-chain error every prior phase's `NO_ACTIVE_*` guards already use this exact
   shape for).
2. **Branch/commit handling**: this project has exactly one current index (Phase 7's
   single-row-per-project design, not a version history), so there is exactly one indexed
   `(branch, commitSha)` pair to search at any time. An optional `branch`/`commit` request
   field is *validated* against the index's actual current values, not used to select among
   multiple indexed states that don't exist — a mismatch is a real, honest 400
   `INDEX_COMMIT_MISMATCH` ("the index is for branch X at commit Y; reindex to search a
   different commit") rather than silently searching stale or wrong data. This is the
   "stale index" handling the task asks for: staleness is surfaced as an explicit error, never
   papered over.
3. **Lazy build, persisted for reuse**: if `CodeChunk` rows already exist for this
   `(codebaseIndexId, commitSha)`, chunking is skipped entirely. Otherwise the chunking
   pipeline above runs once and persists its output — so the *first* search after an index
   completes pays the chunking+embedding cost, and every subsequent search for the same commit
   is a fast read+rank. Embeddings are generated per chunk only if a row for
   `(chunkId, model)` doesn't already exist — covering both "never embedded" and "embedded
   with a since-changed model," without discarding chunks.
4. The query text is embedded once (`input_type: "query"`).
5. Cosine similarity is computed in Node between the query vector and every persisted chunk
   embedding for this `(codebaseIndex, commitSha, model)`, sorted descending, truncated to the
   requested `limit` (default 10, max 50).
6. Each result returns: file path, symbol name (`null` for a file-fallback chunk), a snippet
   (the chunk text, possibly truncated for the response), `startLine`/`endLine`, similarity
   score, and the branch/commit it was indexed at. Never any content from a different project
   — every query in this path is scoped by `projectId`/`codebaseIndexId` end to end, the same
   ownership discipline every other endpoint in this codebase already has.

## Milestone 2 — Database

```prisma
model CodeChunk {
  id              String   @id @default(uuid())
  projectId       String   @map("project_id")
  codebaseIndexId String   @map("codebase_index_id")
  fileId          String   @map("file_id")
  symbolId        String?  @map("symbol_id")
  branch          String
  commitSha       String   @map("commit_sha")
  chunkIndex      Int      @map("chunk_index")
  content         String
  contentHash     String   @map("content_hash")
  language        String
  startLine       Int      @map("start_line")
  endLine         Int      @map("end_line")
  createdAt       DateTime @default(now()) @map("created_at")

  project       Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  codebaseIndex CodebaseIndex @relation(fields: [codebaseIndexId], references: [id], onDelete: Cascade)
  file          IndexedFile   @relation(fields: [fileId], references: [id], onDelete: Cascade)
  symbol        Symbol?       @relation(fields: [symbolId], references: [id], onDelete: Cascade)
  embeddings    Embedding[]

  @@unique([codebaseIndexId, commitSha, contentHash])
  @@index([projectId])
  @@index([codebaseIndexId, commitSha])
  @@map("code_chunks")
}

model Embedding {
  id         String   @id @default(uuid())
  chunkId    String   @map("chunk_id")
  model      String
  dimensions Int
  vector     Float[]
  createdAt  DateTime @default(now()) @map("created_at")

  chunk CodeChunk @relation(fields: [chunkId], references: [id], onDelete: Cascade)

  @@unique([chunkId, model])
  @@index([chunkId])
  @@map("embeddings")
}
```

`Project.codeChunks`, `CodebaseIndex.codeChunks`, `IndexedFile.codeChunks`, `Symbol.codeChunks`
back-relations are added alongside these. Cascading from `IndexedFile`/`Symbol` is deliberate:
Phase 7's `persistIndex` wholesale-*deletes* every `IndexedFile` row on each reindex, so a
project's old chunks/embeddings — tied to a now-superseded commit — correctly disappear along
with the file rows that produced them, rather than accumulating orphaned rows forever.
`@@unique([chunkId, model])` is this schema's direct answer to "do not store duplicate
embeddings for identical chunks and model versions." No secrets are stored anywhere here.

## API design (Milestone 4)

| Method | Path | Behavior |
|---|---|---|
| POST | `/projects/:projectId/search` | Body `{ query, branch?, commit?, limit? }`. Session-authenticated, ownership-enforced. Lazily builds chunks/embeddings for the current completed index if not already built, then returns ranked results. |

Errors: `NOT_FOUND` (404, missing/foreign project — existing convention), `NO_COMPLETED_INDEX`
(400, no repository connected / no completed index), `INDEX_COMMIT_MISMATCH` (400, requested
branch/commit doesn't match the current index), `EMBEDDING_PROVIDER_UNAVAILABLE` (503, no
`VOYAGE_API_KEY` — mirrors `AI_PROVIDER_UNAVAILABLE`/`GITHUB_INTEGRATION_NOT_CONFIGURED`'s
exact shape), `EMBEDDING_SERVICE_ERROR` (502, provider call failed), `VALIDATION_ERROR` (400,
empty/oversized query, invalid `limit`). Ownership and project isolation reuse
`services/codebaseIndex.ts`'s established `requireOwnedProject` pattern exactly.

## Frontend (Milestone 5)

A third section on the existing `ProjectSettings` page — no, on reflection, search is a
distinct workflow from "settings" (a one-time repository/indexing configuration action) rather
than another settings toggle, so it gets its own page, `/projects/:id/search`, linked from
`ProjectOverview` the same way `/projects/:id/settings` already is. States, gated the same way
`CodebaseIndexSection` gates on a connection: `no-repository` (reuses the exact copy pattern),
`no-index` (explains indexing is required, links to Settings), `ready` (search input, submit
button, optional branch/commit fields, a result-limit control), `results` (each result's file
path, symbol name, snippet, location, score, branch/commit), `empty` (a real zero-results
state, distinct from an error), `error` (the real error message for any of the API's distinct
error codes above — never a fabricated empty-results state standing in for a real failure).
Same `Button`/`Card`/`EmptyState`/`ErrorState`/`LoadingState` components, no new design system.

## Testing strategy (Milestone 6)

Same three-tier split as Phases 6–7: mocked-fetch unit tests for the new Node chunking utility
and the Voyage-calling `aiServiceClient` function; a `FakeEmbeddingProvider`-backed pytest
module for the new `ai-service` agent (deterministic vectors, no network, no paid key); mocked
GitHub+ai-service Supertest tests for the search route covering the full lazy-build-then-search
flow, branch/commit mismatch, missing index, and provider-unavailable paths; one real-HTTP
`tests/` integration test proving the honest `NO_COMPLETED_INDEX` (or equivalent) path;
RTL tests for every `CodeSearchPage` state. Chunking tests directly exercise the pure
chunking function (no HTTP) against fixture symbol lists, covering nested symbols, oversized
symbols requiring a split, and a symbol-less file's fallback windowing — all deterministic.

## Docker verification strategy (Milestone 7)

Same volume-wiped rebuild as Phases 6–7, plus: confirm `POST /embeddings/generate` reaches the
containerized `ai-service` and returns the honest 503 with no `VOYAGE_API_KEY` set in the host
shell (`docker-compose.yml` *does* pass `VOYAGE_API_KEY` through, exactly like
`ANTHROPIC_API_KEY` — corrected during Milestone 3 from this plan's original statement that it
would be omitted like `GITHUB_TOKEN_ENCRYPTION_KEY`; see
docs/RETRIEVAL_PHASE_PROGRESS.md's Milestone 3 entry for why the pass-through pattern is the
more consistent choice for a real external provider credential), and confirm `POST
/projects/:id/search` reaches that same honest unconfigured/no-index path through the full
containerized stack without ever claiming a real semantic search succeeded.

## Explicit limitations (documented up front)

- Vector search is a linear scan (`Float[]` + in-process cosine similarity), not an ANN index —
  reasonable at this project's per-project chunk-count scale, but would not scale to a
  very large monorepo's full chunk set. pgvector (or another ANN-backed store) is the natural
  upgrade path and is future work, not this phase.
- Chunking only covers `parsed` files from the three Phase 7 languages (Python, TypeScript,
  JavaScript); `unsupported`/binary/skipped files are never chunked.
- Retrieval covers exactly one `(branch, commitSha)` per project — the CodebaseIndex's current
  state — not a searchable history of past commits; requesting a different branch/commit is a
  real, honest mismatch error, not silently ignored.
- The first search after an index completes (or after a reindex to a new commit) pays a real
  chunking+embedding cost synchronously, within that one HTTP request — bounded by Phase 7's
  own file caps, but still the slowest possible search request a user will see.
- No re-verification of GitHub access happens before re-fetching blob content during chunking;
  a revoked token surfaces as the same real `GITHUB_INVALID_CREDENTIALS` failure any other
  GitHub-calling endpoint would produce.

## Explicit non-goals (per the user's instructions)

Codebase Q&A, chat with the repository, code review, automatic code generation, automatic task
execution, GitHub issue/PR creation, GitHub Actions integration, additional LLM providers. None
are implemented, referenced, or stubbed with fake behavior in this phase.

## Milestones

1. Planning (this document).
2. Database — `CodeChunk`, `Embedding` models + migration.
3. Chunking service (Node) + embedding agent (`ai-service`, Voyage AI).
4. Retrieval service + API endpoint.
5. Frontend Code Search page.
6. Tests (chunking, embeddings, retrieval, API, frontend).
7. Docker verification.
8. Documentation.
