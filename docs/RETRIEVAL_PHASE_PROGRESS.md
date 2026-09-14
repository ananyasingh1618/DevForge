# DevForge Phase 8 (Retrieval & Semantic Search) — Progress Checklist

See [docs/RETRIEVAL_PHASE_PLAN.md](RETRIEVAL_PHASE_PLAN.md) for scope, data model, API
contracts, and the full plan. This file tracks the 8 milestones the same way
[docs/CODEBASE_INDEX_PHASE_PROGRESS.md](CODEBASE_INDEX_PHASE_PROGRESS.md) tracked Phase 7.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Database (code chunks + embeddings)
- [ ] 3. Chunking service and embedding agent
- [ ] 4. Retrieval service and API
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
_Not started._

### 4. Retrieval service and API
_Not started._

### 5. Frontend Code Search page
_Not started._

### 6. Tests
_Not started._

### 7. Docker verification
_Not started._

### 8. Documentation
_Not started._
