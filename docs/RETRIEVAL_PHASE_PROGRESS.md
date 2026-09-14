# DevForge Phase 8 (Retrieval & Semantic Search) — Progress Checklist

See [docs/RETRIEVAL_PHASE_PLAN.md](RETRIEVAL_PHASE_PLAN.md) for scope, data model, API
contracts, and the full plan. This file tracks the 8 milestones the same way
[docs/CODEBASE_INDEX_PHASE_PROGRESS.md](CODEBASE_INDEX_PHASE_PROGRESS.md) tracked Phase 7.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Database (code chunks + embeddings)
- [x] 3. Chunking service and embedding agent
- [x] 4. Retrieval service and API
- [ ] 5. Frontend Code Search page
- [ ] 6. Tests
- [ ] 7. Docker verification
- [ ] 8. Documentation

## Per-milestone log

### 1. Inspect and plan
- Confirmed via `git status --porcelain` the repo is exactly where Phase 7 left it (clean
  tree, `1e97019` as HEAD).
- Re-read `api/prisma/schema.prisma` in full through the Phase 7 models, `api/src/services/
  codebaseIndex.ts`, `api/src/lib/githubClient.ts`, `api/src/lib/aiServiceClient.ts`,
  `ai-service/app/lib/provider_config.py`, `ai-service/app/agents/requirements/provider.py`
  and `router.py` (the exact provider-abstraction/test-double pattern reused for the new
  embeddings agent), `ai-service/main.py`, `docker-compose.yml`'s `ai-service` env
  pass-through (`ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}` — the exact pattern
  `VOYAGE_API_KEY` mirrors).
- **Docker daemon was not running at the start of this phase** (`docker compose ps` failed to
  connect) — started it (`open -a Docker`, waited for `docker info` to succeed) since Postgres
  is needed even for local, non-Docker verification; confirmed the standalone
  `devforge-postgres-1` container came back up healthy afterward.
- **Vector storage decision, made explicit per the task's instruction**: plain PostgreSQL
  `Float[]` columns with cosine similarity computed in the Node API, not pgvector, an external
  vector database, or a local embedded index. Confirmed `double precision[]` arrays work
  against the real running dev Postgres (`psql` round-trip) before committing to the schema.
  Full reasoning — including why pgvector was rejected (Docker image change +
  `Unsupported("vector(n))"` + raw SQL, none of which this project's scale needs) — recorded
  in `docs/RETRIEVAL_PHASE_PLAN.md`.
- **Embedding provider decision, made explicit per the task's instruction**: Voyage AI
  (`voyage-code-3`, a code-retrieval-specific embedding model), gated by an optional
  `VOYAGE_API_KEY` read at call time exactly like `ANTHROPIC_API_KEY`/
  `GITHUB_TOKEN_ENCRYPTION_KEY`. Confirmed the real endpoint before adopting it: `curl -X POST
  https://api.voyageai.com/v1/embeddings` with a fake key returned a genuine
  `{"detail":"Provided API key is invalid."}` (401), not a network failure — the same
  "real endpoint, fake credential, real rejection" check every prior phase's new external
  dependency got before being adopted. A local embedding model (`sentence-transformers`) was
  considered and rejected — unverified Docker install footprint and a much heavier dependency
  than tree-sitter's confirmed-lightweight wheels, for a project that has never once needed
  real paid credentials to demonstrate honest behavior in any prior phase.
- **Chunking design decision**: one chunk per `Symbol` (Phase 7's already-extracted AST
  symbols), with oversized-symbol splitting (4000 chars, 200-char overlap) and whole-file
  fallback windowing for symbol-less parsed files. Chunking itself lives in the Node API
  (pure string-slicing over already-persisted Phase 7 data, plus a GitHub blob refetch it
  already knows how to do), not in `ai-service` — only embedding generation is a Python/
  `ai-service` concern.
- Full reasoning, schema, API contract, frontend design, limitations, and milestone breakdown
  written to `docs/RETRIEVAL_PHASE_PLAN.md`.
- Commit: `17f2a75` — "docs: Phase 8 (Retrieval & Semantic Search) plan and progress
  tracker".

### 2. Database (code chunks + embeddings)
- Added `CodeChunk` (project/codebaseIndex/file/symbol relations, branch, commitSha,
  chunkIndex, content, contentHash, language, startLine, endLine) and `Embedding` (chunk
  relation, model, dimensions, `vector Float[]`) models exactly as designed in
  `docs/RETRIEVAL_PHASE_PLAN.md`, plus `Project.codeChunks`, `CodebaseIndex.codeChunks`,
  `IndexedFile.codeChunks`, `Symbol.codeChunks` back-relations.
  `@@unique([codebaseIndexId, commitSha, contentHash])` on `CodeChunk` and
  `@@unique([chunkId, model])` on `Embedding` are the direct schema answers to "no duplicate
  chunks" and "no duplicate embeddings for the same chunk+model".
- `npx prisma format` + `npx prisma validate` passed on the first try — no relation-field
  errors this time (learned from Phase 7's Milestone 2 miss: added both sides of every new
  relation up front).
- `npx prisma migrate dev --name add_code_chunks_and_embeddings` generated and applied
  `prisma/migrations/20260914165206_add_code_chunks_and_embeddings/migration.sql`. Read the
  generated SQL back and confirmed: `vector` is a real `DOUBLE PRECISION[]` column (not a
  JSON blob), `code_chunks_codebase_index_id_commit_sha_content_hash_key` and
  `embeddings_chunk_id_model_key` are real unique indexes, and every FK (`project_id`,
  `codebase_index_id`, `file_id`, `symbol_id`, `chunk_id`) is `ON DELETE CASCADE` — so a Phase
  7 reindex's wholesale `IndexedFile` deletion correctly cascades away any chunks/embeddings
  tied to the superseded commit, rather than orphaning them.
- `npx prisma generate` regenerated the client cleanly; `npm run typecheck` and `npm run lint`
  both passed with no errors.
- Wrote and ran a throwaway verification script (not committed) against the real database:
  created a user/project/connection/index/file/symbol/chunk/embedding, confirmed
  `(codebaseIndexId, commitSha, contentHash)` chunk uniqueness is enforced, confirmed
  `(chunkId, model)` embedding uniqueness is enforced, confirmed a `Float[]` vector round-trips
  byte-for-byte through Prisma (`[0.1, 0.2, 0.3, 0.4]` in, identical array out), and confirmed
  deleting the `CodebaseIndex` cascades to delete its chunk and embedding — all assertions
  passed.
- **Docker daemon note**: had to `open -a Docker` and wait for it before any of the above,
  since the standalone dev Postgres container depends on it and wasn't running at the start of
  this session; confirmed `devforge-postgres-1` came back up healthy automatically once the
  daemon was ready.
- Proactively applied the migration to `devforge_test` in this same milestone (`DATABASE_URL=
  ...devforge_test npx prisma migrate deploy`) rather than waiting to discover the gap when
  Milestone 6's tests first touch the new tables — the exact gap Phase 7's Milestone 6 hit and
  had to fix reactively.
- Ran the full `api/` test suite (`npm run test`): 174/174 passed.
- Commit: `01fae82` — "feat(api): add code_chunk and embedding data model and migration".

### 3. Chunking service and embedding agent
- **`ai-service/app/agents/embeddings/`** (new): `provider.py` — `EmbeddingProvider` ABC +
  `VoyageEmbeddingProvider` (real `httpx.post` to `https://api.voyageai.com/v1/embeddings`,
  `voyage-code-3`, 1024 dimensions, `input_type` "document"/"query" passed through for Voyage's
  asymmetric embedding), `get_provider()` reading `VOYAGE_API_KEY` at call time. `schemas.py` —
  `EmbedRequest`/`EmbedResponse`, kept separate from `app/schemas.py` for the same reason
  `app/parsing/schemas.py` is (not an LLM `output_format`). `router.py` — `POST
  /embeddings/generate`, registered in `main.py` alongside the six existing routers.
- **`ai-service/app/errors.py`**: generalized `ProviderNotConfiguredError` to accept `env_var`/
  `provider_name` (defaulting to the original `ANTHROPIC_API_KEY`/"No LLM provider" values, so
  every existing call site's message is byte-for-byte unchanged) instead of hardcoding
  "ANTHROPIC_API_KEY" — the embeddings agent needed its real missing variable
  (`VOYAGE_API_KEY`) named accurately, not a copy-pasted-wrong message. Confirmed no existing
  test asserts the message text (only the `error.code`, via `grep`), so this was safe.
  **`ai-service/app/lib/provider_config.py`**: added `get_voyage_api_key(feature)`, mirroring
  `get_anthropic_api_key` exactly.
- **`ai-service/requirements.txt`**: added `httpx==0.28.1` as a direct dependency (already
  present transitively via `anthropic`, pinned to the exact version already resolved so this
  changes nothing at install time — just makes the dependency explicit for a module that now
  imports it directly).
- **`docker-compose.yml`**: added `VOYAGE_API_KEY: ${VOYAGE_API_KEY:-}` to `ai-service`'s
  environment, mirroring `ANTHROPIC_API_KEY`'s existing pass-through exactly. **Corrects a
  wrong precedent named in this phase's own plan doc**: the plan said this would mirror
  `GITHUB_TOKEN_ENCRYPTION_KEY` being deliberately *omitted* from `docker-compose.yml` — but on
  reflection `VOYAGE_API_KEY` is a real external provider credential a user might actually
  have, exactly like `ANTHROPIC_API_KEY`, not an internally-generated encryption key like
  `GITHUB_TOKEN_ENCRYPTION_KEY`. Mirroring the pass-through pattern (rather than the omission
  pattern) is the more consistent choice; noted here rather than silently diverging from the
  plan doc's stated reasoning.
- **`api/src/lib/chunking.ts`** (new): pure, network/DB-free `chunkFile()` — one chunk per
  Phase 7 `Symbol` (oversized symbols split via a deterministic line-windowing function with a
  4000-char budget and ~200-char trailing-line overlap between consecutive pieces, never
  splitting mid-line), a whole-file windowed fallback for a parsed file with zero symbols.
  `contentHash` is `sha256` of the chunk's own text (Node's built-in `crypto`, matching
  `githubTokenCrypto.ts`'s own use of the same module).
- **Found and fixed a real off-by-one during manual verification**: `content.split("\n")` on
  newline-terminated content (true for essentially every real source file) emits one phantom
  trailing empty-string element, which — unguarded — made the whole-file fallback path report
  `endLine` one past the file's actual last line. Fixed by trimming exactly one trailing empty
  element when `content` ends with `"\n"`, before either chunking path runs; symbol-based
  chunking was never affected (Phase 7's tree-sitter-derived `endLine` values never reach past
  the file's real last line in the first place).
- **`api/src/lib/aiServiceClient.ts`**: added `generateEmbeddingsViaAiService(texts,
  inputType)`, deliberately not reusing the existing `postToAiService` helper — a distinct
  `EMBEDDING_PROVIDER_UNAVAILABLE` code (not `AI_PROVIDER_UNAVAILABLE`, since the real missing
  configuration is `VOYAGE_API_KEY`, not `ANTHROPIC_API_KEY`) and a batch-in/vectors-out shape
  that doesn't fit `postToAiService`'s single-content-object assumption.
- Commands run and results:
  - `pip install -r requirements.txt`, then `python -m pytest -q`: 52/52 existing ai-service
    tests still pass after the `ProviderNotConfiguredError` signature change (no new test added
    yet — deferred to Milestone 6, matching every prior phase's own Milestone 3).
  - Booted `uvicorn main:app` on a scratch port with no `VOYAGE_API_KEY` set: `POST
    /embeddings/generate` correctly returned 503 `PROVIDER_NOT_CONFIGURED` with the accurate
    "Set VOYAGE_API_KEY..." message, and an empty `texts` array correctly returned a real
    FastAPI 400 `VALIDATION_ERROR`.
  - Restarted with a fake, never-real `VOYAGE_API_KEY`: got a genuine 502 `AI_PROVIDER_ERROR`
    with message "Authentication with the embedding provider failed: Provided API key is
    invalid." — confirming the call really reaches `https://api.voyageai.com` (the same
    "real endpoint, fake credential, real rejection" check used for every external dependency
    adopted in this project) — and confirmed via `ps aux` that no orphaned `uvicorn` process
    was left after stopping it.
  - Ran a throwaway script (not committed) exercising `chunkFile()` directly: a small
    TypeScript fixture with a class containing a nested method plus a top-level function
    (confirmed independent, correctly-ranged chunks for all three, including the nested one);
    a synthetic ~20,000-character single-symbol file (confirmed it split into 6 overlapping
    pieces, each ≤ ~4000 chars, with real line overlap between consecutive pieces); a
    symbol-less Python file (confirmed the whole-file fallback, and confirmed the endLine
    off-by-one fix); and a determinism check (identical input produced byte-identical output
    across two calls).
  - `npm run typecheck` / `npm run lint` (api): clean, both before and after the off-by-one
    fix.
- Commit: `32660c6` — "feat(api,ai-service): add code chunking and Voyage AI embedding
  generation".

### 4. Retrieval service and API
- **`api/src/lib/similarity.ts`** (new): `cosineSimilarity(a, b)` — a plain, dependency-free
  pure function (throws on mismatched vector lengths rather than silently returning a
  meaningless score).
- **`api/src/schemas/retrieval.ts`** (new): `searchRequestSchema` (`query` 1–2000 chars,
  optional `branch`/`commit`, `limit` 1–50 defaulting to 10) and `projectIdParamSchema`.
- **`api/src/services/retrieval.ts`** (new): `search(ownerId, projectId, input)` —
  `requireOwnedProject`, then resolves the project's `CodebaseIndex` (must exist and be
  `status: "completed"`, else 400 `NO_COMPLETED_INDEX`), validates any caller-supplied
  `branch`/`commit` against the index's actual current values (else 400
  `INDEX_COMMIT_MISMATCH`, naming the real branch/commit), checks the repository connection
  and `isGithubIntegrationConfigured()` (else 503 `GITHUB_INTEGRATION_NOT_CONFIGURED` — the
  same code `services/repository.ts`/`services/codebaseIndex.ts` already use), lazily builds
  `CodeChunk` rows (skipped entirely if any already exist for this `(codebaseIndexId,
  commitSha)`) by re-fetching each parsed file's content via `githubClient.getBlob` and running
  Milestone 3's `chunkFile()`, lazily embeds any chunk missing an `Embedding` for the current
  model (batched `EMBED_BATCH_SIZE = 32` chunks per `generateEmbeddingsViaAiService` call),
  embeds the query itself (`input_type: "query"`), and ranks every persisted chunk embedding
  for this index/commit/model by cosine similarity, returning the top `limit` with file path,
  symbol name/type, snippet, location, language, branch/commit, and score. `CodeChunk` rows
  persist via `createMany({ skipDuplicates: true })` so a chunk whose `(index, commit,
  contentHash)` already exists (concurrent request, or two files producing byte-identical
  chunk text) is silently deduplicated rather than erroring the whole batch — same for
  `Embedding` rows on `(chunk, model)`.
- **`api/src/controllers/retrieval.ts`** / **`api/src/routes/retrieval.ts`** (new): `POST
  /projects/:projectId/search`, under `requireAuth`, registered in `api/src/app.ts`.
- Commands run and results:
  - `npm run typecheck` / `npm run lint`: clean on the first pass.
  - Manual live verification, in this order, cleaning up all created data and stopping every
    manually-started process afterward: booted `ai-service` and `api` (unconfigured) against
    the real local Postgres; registered a user, created a project; confirmed `POST
    .../search` with no index at all returns 400 `NO_COMPLETED_INDEX`. Generated a local,
    never-committed `GITHUB_TOKEN_ENCRYPTION_KEY`, restarted the API with it configured, and
    directly inserted (via a throwaway script, not through the real connect/index flow, since
    no real PAT exists) a verified `RepositoryConnection` + a `completed` `CodebaseIndex` +
    one `parsed` `IndexedFile` — all pointing at the real public repo `octocat/Hello-World`,
    reusing its actual, real commit SHA and README blob SHA. Confirmed a mismatched `branch`
    and a mismatched `commit` in the request body both correctly return 400
    `INDEX_COMMIT_MISMATCH`, naming the real indexed branch/commit in the message. Confirmed a
    matching-branch/commit search request genuinely reaches GitHub and fails with a real 401
    `GITHUB_INVALID_CREDENTIALS` (the connection's token is validly-encrypted but
    intentionally fake) — confirming `buildChunksForIndex` really calls `getBlob`. Confirmed
    the raw response contains no `ghp_` substring, and confirmed directly against the database
    that **zero** `CodeChunk` rows were persisted from the failed attempt (the whole
    file-processing loop throws before its single `createMany` call, so a mid-loop GitHub
    failure leaves no partial chunk data behind — the same all-or-nothing-per-attempt shape
    Phase 7's own `buildIndex` already has, not a new gap this phase introduces). Deleted the
    scratch project/user afterward.
  - The full happy path (real chunks persisted, real embeddings generated, real ranked
    results) could not be exercised live without both a real GitHub PAT and a real
    `VOYAGE_API_KEY` — neither exists in this environment. Deferred to Milestone 6's
    deterministic, mocked-fetch Supertest tests, matching exactly how Phase 7's Milestone 4
    handled the same constraint.
  - `npm run test` (full `api/` suite): 174/174 passed, confirming no regression.
  - Confirmed no orphaned `tsx watch`/`uvicorn` processes after stopping the manually-started
    servers; the sibling VoxMind `uvicorn` process was the only one left running, untouched.
- Commit: `c93949c` — "feat(api): add semantic search retrieval service and API endpoint".

### 5. Frontend Code Search page
_Not started._

### 6. Tests
_Not started._

### 7. Docker verification
_Not started._

### 8. Documentation
_Not started._
