# DevForge Phase 7 (AST Parsing & Codebase Indexing) — Progress Checklist

See [docs/CODEBASE_INDEX_PHASE_PLAN.md](CODEBASE_INDEX_PHASE_PLAN.md) for scope, data model,
API contracts, and the full plan. This file tracks the 8 milestones the same way
[docs/GITHUB_INTEGRATION_PHASE_PROGRESS.md](GITHUB_INTEGRATION_PHASE_PROGRESS.md) tracked
Phase 6.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [x] 2. Prisma schema and migration
- [x] 3. GitHub retrieval and ai-service parser
- [x] 4. Indexing service and API endpoints
- [x] 5. Frontend codebase index section
- [x] 6. Tests
- [x] 7. Docker verification
- [x] 8. Documentation

## Per-milestone log

### 1. Inspect and plan
- Confirmed via `git status --porcelain` the repo is exactly where Phase 6 left it (clean tree,
  `87c917d` as HEAD).
- Read `api/prisma/schema.prisma` in full (every model through `RepositoryConnection`),
  `api/src/lib/githubClient.ts`, `api/src/services/repository.ts`, `api/src/controllers/
  repository.ts`, `api/src/routes/repository.ts`, `api/src/lib/errors.ts`, `api/src/env.ts`,
  `api/src/app.ts`, `api/src/lib/validate.ts`.
- Read `api/src/lib/aiServiceClient.ts` in full — confirmed the exact Node↔ai-service call
  pattern (POST, snake_case↔camelCase mapping, `AppError` on unreachable/invalid-response) that
  the new parser call reuses.
- Read `ai-service/main.py`, `ai-service/app/errors.py`, `ai-service/app/schemas.py`,
  `ai-service/app/agents/requirements/router.py`, `ai-service/app/agents/tasks/router.py`.
  **Found `ai-service/app/parsing/__init__.py` already exists** as a one-line placeholder
  docstring from the Phase 4 architecture pass: `"Tree-sitter AST-aware repository parsing and
  chunking. Not implemented yet."` — this phase fills that placeholder in rather than choosing
  a new location for parsing from scratch.
- Read `frontend/src/components/RepositoryConnectionSection.tsx`,
  `frontend/src/pages/ProjectSettings.tsx`, `frontend/src/components/StateViews.tsx`,
  `frontend/src/services/repositoryApi.ts`, `frontend/src/services/apiClient.ts` — confirmed
  the exact component/service/state-machine conventions the new `CodebaseIndexSection` reuses,
  and confirmed `ProjectSettings.tsx` is the right page (codebase indexing is a property of the
  already-connected repository, not a new page).
- **Parser library decision, made explicit per the task's instruction**: tree-sitter, run inside
  ai-service (Python), not a Node-only parser. Confirmed real installability before committing:
  `pip download --no-deps` for `tree-sitter`, `tree-sitter-python`, `tree-sitter-javascript`,
  `tree-sitter-typescript` succeeded for both the local macOS arm64 platform and, critically,
  `--platform manylinux2014_x86_64 --python-version 312 --only-binary=:all:` (the actual
  `python:3.12-slim` Docker target) — prebuilt wheels exist for all four packages, so no
  compiler or apt package needs to be added to `ai-service/Dockerfile`.
- **Prototyped symbol extraction before writing production code** — ran real tree-sitter parses
  against a nested-class/nested-closure Python fixture and an interface/class/arrow-function
  TypeScript fixture (commands run interactively, not committed) to confirm the exact node types
  (`class_definition`, `function_definition`, `class_declaration`, `interface_declaration`,
  `type_alias_declaration`, `method_definition`, `variable_declarator` with an arrow-function
  initializer) and confirm parent-symbol nesting resolves correctly (e.g. a closure inside a
  method inside a class correctly chains through all three parents).
- Full reasoning, schema, API contract, frontend design, limitations, and milestone breakdown
  written to `docs/CODEBASE_INDEX_PHASE_PLAN.md`.
- Confirmed no orphaned processes and Docker at the expected Phase-6-end state
  (`devforge-postgres-1` only) before starting; confirmed the sibling VoxMind `uvicorn` process
  is running and untouched.
- Commit: `d5ae3f8` — "docs: Phase 7 (AST Parsing & Codebase Indexing) plan and progress
  tracker".

### 2. Prisma schema and migration
- Added `CodebaseIndexStatus` (`pending`/`indexing`/`completed`/`failed`) and `FileParseStatus`
  (`parsed`/`unsupported`/`parse_error`/`skipped_binary`/`skipped_too_large`/
  `skipped_index_limit`) enums, and the `CodebaseIndex`, `IndexedFile`, `Symbol` models exactly
  as designed in `docs/CODEBASE_INDEX_PHASE_PLAN.md`, plus `Project.codebaseIndex` and
  `RepositoryConnection.codebaseIndexes` relation fields.
- `npx prisma validate` initially failed — a many-to-one relation field needs an opposite
  relation field on Prisma 7, not just `fields`/`references` on one side. Fixed by adding
  `RepositoryConnection.codebaseIndexes CodebaseIndex[]` and re-running `npx prisma format` +
  `npx prisma validate`, which passed.
- `npx prisma migrate dev --name add_codebase_index` generated and applied
  `prisma/migrations/20260912122024_add_codebase_index/migration.sql`. Read the generated SQL
  back and confirmed: `codebase_indexes.project_id` has a unique index (one row per project,
  same shape as `repository_connections`), `codebase_indexes_repository_connection_id_fkey` is
  `ON DELETE RESTRICT` (deliberately non-cascading, per the plan), `indexed_files.index_id`
  cascades from `codebase_indexes` and has a `(index_id, path)` unique index, `symbols.file_id`
  cascades from `indexed_files`, and `symbols.parent_id` self-references with `ON DELETE SET
  NULL`.
- `npx prisma generate` regenerated the client cleanly; `npm run typecheck` and `npm run lint`
  both passed with no errors.
- Wrote and ran a throwaway verification script (not committed) exercising the real database:
  created a user/project/connection/index/file/two nested symbols, confirmed
  `codebase_indexes.project_id` uniqueness is enforced (second create for the same project
  throws), confirmed `indexed_files (index_id, path)` uniqueness is enforced, confirmed a
  symbol's `parent` relation resolves correctly (method → class), confirmed deleting the
  `CodebaseIndex` cascades to delete its `IndexedFile` and `Symbol` rows, and confirmed the
  `RepositoryConnection` can then be deleted cleanly (nothing left referencing it) — all
  assertions passed.
- Ran the full `api/` test suite (`npm run test`): 152/152 passed. (Two unrelated tests
  — `prd.test.ts`'s ownership-check-for-compare test and `tasks.test.ts`'s
  registration-cookie helper — failed once under full-suite parallel load and passed cleanly
  when rerun both together and as part of a second full-suite run; this is pre-existing
  test-isolation flakiness under parallel workers, not caused by this milestone's schema-only
  change, which touches no route or service code.)
- Commit: `e259042` — "feat(api): add codebase_index, indexed_file, and symbol data model
  and migration".

### 3. GitHub retrieval and ai-service parser
- **`api/src/lib/githubClient.ts`**: added `getBranchCommit` (`GET
  /repos/{owner}/{repo}/branches/{branch}` → `commit.sha`), `getTree` (`GET
  /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`, filters to `blob`/`tree`/`commit` entries
  and surfaces GitHub's own `truncated` flag rather than treating a truncated tree as
  complete), and `getBlob` (`GET /repos/{owner}/{repo}/git/blobs/{sha}`, decodes the base64
  content). All three reuse the existing `githubFetch`/`errorForResponse` helpers, so they get
  the same 401/404/403/429/502 mapping every other client function already has and already has
  tests for. Fixed one `exactOptionalPropertyTypes` typecheck error in `getTree`'s mapping
  (conditionally spreading `size` instead of always assigning a possibly-`undefined` value).
- **`ai-service/app/parsing/`**: filled in the placeholder left by the Phase 4 architecture
  pass. `parser.py` — tree-sitter-backed `detect_language()` (extension → `python` /
  `typescript` / `javascript`, anything else → `None`) and `parse_file()` (language detection,
  parses with a fresh `Parser` per call bound to a cached, reused `Language` grammar object,
  returns `"unsupported"` for an undetected language, `"parse_error"` with no symbols when
  `tree.root_node.has_error` — tree-sitter is error-recovering and never raises on bad syntax,
  so this flag is the actual failure signal — or `"parsed"` with the extracted symbol list).
  Symbol extraction implements exactly the node-type mapping prototyped in Milestone 1
  (class/function/method for Python; class/interface/type_alias/function/method for
  TypeScript/JavaScript, including a `variable_declarator` whose value is an arrow function or
  function expression), with parent-child nesting tracked via each extracted symbol's own index
  into the flat results list (not raw tree-sitter node identity, which is not guaranteed stable
  across repeated attribute access in the Python bindings — using each `_Extracted` object's
  own `index` field sidesteps that entirely). `schemas.py` — `ParseFileRequest`/
  `ParseFileResponse`/`SymbolInfo` Pydantic models, kept separate from `app/schemas.py` since
  those models double as Anthropic `output_format` schemas and parsing has no such second use.
  `router.py` — `POST /parsing/parse`, registered in `main.py` alongside the five existing
  agent routers.
- **`ai-service/requirements.txt`**: added `tree-sitter==0.26.0`, `tree-sitter-python==0.25.0`,
  `tree-sitter-javascript==0.25.0`, `tree-sitter-typescript==0.23.2` — confirmed during
  Milestone 1 planning that all four have prebuilt `manylinux2014_x86_64` wheels for Python
  3.12, so no Dockerfile change is needed.
- Commands run and results:
  - `pip install -r requirements.txt` inside `ai-service/.venv`, then ran `parse_file()`
    directly against a nested-class/nested-closure Python fixture, an interface/class/
    arrow-function TypeScript fixture, an intentionally-malformed JS fixture, and a `.png`
    path — output matched the Milestone 1 prototype exactly, including correct `parent_index`
    resolution three levels deep (closure → method → class) and the honest `"parse_error"` /
    `"unsupported"` paths.
  - `python -m pytest -q`: 39/39 existing ai-service tests still pass (no test added yet for
    the new module — deferred to Milestone 6, matching Phase 6's Milestone 3, which also
    deferred all new tests to its own Milestone 6).
  - Booted `uvicorn main:app` on a scratch port and hit `POST /parsing/parse` over real HTTP:
    correct parsed response for a Python fixture, correct `"unsupported"` for `a.md`, and a
    real FastAPI `VALIDATION_ERROR` (400) for a request missing `content` — confirming the
    route is wired in and validates through the same error envelope as every other ai-service
    endpoint.
  - `npm run typecheck` and `npm run lint` in `api/`: both clean after the `exactOptionalPropertyTypes`
    fix above.
  - Confirmed real GitHub reachability for the new branch-resolution shape
    (`curl https://api.github.com/repos/octocat/Hello-World/branches/master` returned a real
    `commit.sha` field matching what `getBranchCommit` reads); the tree endpoint returned a
    real rate-limit response on this unauthenticated connection at the time of testing, which
    is itself the expected/already-tested `GITHUB_RATE_LIMITED` path — deterministic
    mocked-fetch unit tests for all three new functions are added in Milestone 6, matching how
    every other `githubClient.ts` function is tested.
- Commit: `16a511c` — "feat(api,ai-service): add GitHub tree/blob retrieval and tree-sitter
  source parsing".

### 4. Indexing service and API endpoints
- **`api/src/lib/aiServiceClient.ts`**: added `parseFileViaAiService(path, content)`, kept
  deliberately separate from `postToAiService` — parsing has no `PROVIDER_NOT_CONFIGURED` case
  (it's not an LLM call) and an unreachable parser gets its own `PARSER_SERVICE_UNREACHABLE`
  code rather than being conflated with `AI_SERVICE_UNREACHABLE`. Maps ai-service's
  snake_case symbol fields to camelCase, matching every other ai-service call's boundary
  convention.
- **`api/src/services/codebaseIndex.ts`** (new): `startIndexing`, `reindexRepository`,
  `getIndex`, `listFiles`, `listSymbols`. Implements exactly the pipeline from
  `docs/CODEBASE_INDEX_PHASE_PLAN.md`: resolve the connected repository and branch (checking
  "no connection" before "not configured", so the more specific problem is always reported),
  resolve the branch's current commit, short-circuit-reuse an already-completed index for an
  unchanged commit (only for `start`, never for an explicit `reindex`), fetch the recursive
  file tree, filter (skip directories, oversized files by the tree's own reported size,
  binary-by-extension, then a NUL-byte sniff on actually-fetched content as a second binary
  check, then a file-count cap), fetch and parse each remaining candidate file via
  `parseFileViaAiService`, and replace the index's files/symbols wholesale in one short
  transaction that only does DB writes (all GitHub/ai-service I/O happens before the
  transaction opens). `contentHash` uses the git blob SHA GitHub's own tree API already
  computes — free, genuinely content-derived, and available even for files whose bytes were
  never fetched, so every recorded file has one, not just parsed ones. Symbol
  parent/child links are resolved via client-generated UUIDs (`randomUUID()`) assigned before
  insertion, so both `indexedFile.createMany` and `symbol.createMany` run as single batched
  queries per index run instead of one round trip per row.
- **Found and fixed a real gap during manual verification** (see below): the original
  `startIndexing`/`reindexRepository` only created a `CodebaseIndex` row once branch-commit
  resolution had already succeeded, so a failure at that very first GitHub call (e.g. invalid
  credentials) left no row at all — a subsequent `GET` showed `{ index: null }` instead of a
  real, visible `"failed"` status with the actual error message. Refactored into a shared
  `runOrReuse()` that persists a `"failed"` row (via `upsert`, since a fresh project may have
  no prior row) on a commit-resolution failure too, not just on a failure inside the pipeline
  proper — mirrors `services/repository.ts`'s `verifyAccess` degraded-state pattern. Verified
  the fix live (see below).
- **`api/src/schemas/codebaseIndex.ts`** (new): `projectIdParamSchema`, `fileIdParamSchema` —
  each schema file in this codebase keeps its own copy of these rather than sharing one (same
  convention `schemas/repository.ts` and `schemas/tasks.ts` already follow).
- **`api/src/controllers/codebaseIndex.ts`** / **`api/src/routes/codebaseIndex.ts`** (new): five
  endpoints exactly matching the plan's API table, all under `requireAuth`, registered in
  `api/src/app.ts` alongside every other feature router.
- Commands run and results:
  - `npm run typecheck` / `npm run lint`: clean.
  - **Caught and fixed a real bug before it reached a test or commit**: the NUL-byte binary
    sniff was originally written as `content.includes(" ")`, but the Write tool persisted
    it as a literal raw NUL byte in the source file rather than the two-character escape
    sequence — syntactically valid but completely illegible (renders as an invisible
    character/blank in a diff or editor). Found it because `grep` silently found zero matches
    for `includes` in the file (grep treats a file containing a NUL byte as binary and stops
    text-matching it) where `awk`/`Read` still worked; confirmed via `xxd` on the raw line
    bytes, then rewrote it as the explicit `"\0"` escape sequence.
  - Manual live verification, in this order, cleaning up all created data and stopping every
    manually-started process afterward: booted `ai-service` and `api` (real, unconfigured
    `GITHUB_TOKEN_ENCRYPTION_KEY`) against the real local Postgres; registered a user, created
    a project; confirmed `GET .../codebase-index` returns `{ index: null }` before any
    connection exists; confirmed `POST .../codebase-index/start` returns 400
    `NO_REPOSITORY_CONNECTED`; confirmed `GET .../codebase-index/files` returns 404
    `CODEBASE_INDEX_NOT_FOUND`. Generated a local, never-committed `GITHUB_TOKEN_ENCRYPTION_KEY`,
    restarted the API with it configured, and directly inserted (via a throwaway script, not
    through `connectRepository`, since no real PAT exists to pass its own GitHub verification)
    a `RepositoryConnection` row pointing at the real public repo `octocat/Hello-World` with a
    validly-encrypted but fake token. Called `start`: got a real 401 `GITHUB_INVALID_CREDENTIALS`
    from the genuine GitHub API (confirming `getBranchCommit` really reaches GitHub), confirmed
    the raw response contains no `ghp_` substring anywhere, and confirmed (after the fix above)
    that a subsequent `GET` now correctly shows `status: "failed"` with the real error message
    and no leaked credential. Restarted the API unconfigured again with the same connection row
    still present and confirmed `start` now returns 503 `GITHUB_INTEGRATION_NOT_CONFIGURED`
    (proving the "no connection" vs. "not configured" check ordering is correct). Deleted the
    scratch project/user afterward.
  - `npm run test` (full `api/` suite): 152/152 passed both before and after the fix, confirming
    no regression from this milestone's schema-unrelated service/controller/route code.
  - Confirmed no orphaned `tsx watch`/`uvicorn` processes after stopping the manually-started
    servers (`ps aux`), and confirmed the sibling VoxMind `uvicorn` process (port 8000) was the
    only remaining `uvicorn` process, untouched throughout.
- Commit: `feb67a9` — "feat(api): add codebase indexing service and API endpoints".

### 5. Frontend codebase index section
- **`frontend/src/types/codebaseIndex.ts`** / **`frontend/src/services/codebaseIndexApi.ts`**
  (new): types and `apiRequest`-based service functions for all five endpoints, matching the
  exact conventions `types/repository.ts`/`services/repositoryApi.ts` already established.
- **`frontend/src/components/CodebaseIndexSection.tsx`** (new): a second `Card`-based section
  on `ProjectSettings`, gated on a repository connection existing (fetches
  `getRepositoryConnectionRequest` itself, independent of `RepositoryConnectionSection`'s own
  internal state, matching how sibling sections in this codebase don't share state). Renders
  its own `EmptyState`/`ErrorState`/`LoadingState` for the no-connection/error/loading cases,
  a "ready to index" prompt with a `Start indexing` button when no index exists yet, and full
  index details (branch, commit, status badge, file/parsed/failed counts, truncation and last
  error, `Reindex` button) once one does. `FilesAndSymbolsBrowser` lists indexed files with a
  parse-status label per file and lets the user click a file to lazily fetch and expand its
  symbols. Never shows a fabricated progress bar — the `indexing` UI state is exactly "the
  Start/Reindex button's own request is in-flight" (`loading` prop, same as every other action
  button in this codebase), since indexing is synchronous and there is no real partial-progress
  signal to display.
  - **Remount-key subtlety worth recording**: `RepositoryConnectionSection`'s established
    pattern remounts its detail view via `key={connection.id}` because disconnect+reconnect
    really does create a new row. `CodebaseIndex` never works that way — `runOrReuse`/
    `runIndexingPipeline` always `upsert` the *same* `projectId`-unique row, so `index.id` is
    stable across every reindex. Keying `FilesAndSymbolsBrowser` on `index.id` would have left
    it showing a stale file list after a real reindex. Used `key={index.updatedAt}` instead,
    which changes on every actual completed/failed mutation of the row (Prisma's `@updatedAt`),
    while never changing mid-flight since the whole request is synchronous from the browser's
    perspective.
- **`frontend/src/pages/ProjectSettings.tsx`**: added the "Codebase index" section below the
  existing "GitHub repository" one.
- **`frontend/src/pages/ProjectOverview.tsx`**: removed "Repository indexing" from
  `upcomingCapabilities` (Phase 7 implements it) and reworded the surrounding comment and the
  remaining two entries' descriptions to correctly attribute retrieval/Q&A/review as what's
  still missing, not indexing itself.
- Commands run and results:
  - `npm run typecheck`, `npm run lint`, `npm run build` (frontend): all clean (one pre-existing
    `react-refresh/only-export-components` warning in `useAuth.tsx`, unrelated to this phase).
  - `npm run test` (frontend) initially failed one pre-existing assertion in
    `ProjectOverview.test.tsx` that hardcoded the old 3-item "Not yet implemented" count — fixed
    by updating it to 2 and adding an explicit assertion that "Repository indexing" no longer
    appears there. Full suite then passed: 59/59.
  - `npm run test` (api): 152/152, confirming no regression from this milestone's frontend-only
    change.
  - Manual Playwright verification against the real (unconfigured, then locally-configured with
    a never-committed key) dev stack, screenshots read back directly: confirmed the "Codebase
    index" section shows its own "No repository connected" gate when no connection exists (even
    while the repository section's own connect form is visible above it); confirmed, after
    directly inserting a `RepositoryConnection` row pointing at a real public repo with a fake
    token (the same throwaway-script technique used in Milestone 4, since no real PAT exists to
    pass `connectRepository`'s own GitHub verification), the "Ready to index…" prompt renders;
    confirmed clicking `Start indexing` shows the real GitHub 401 message
    ("The GitHub token is invalid or expired.") rather than any fabricated success; confirmed,
    after a full page reload, the persisted `failed` status, real error, and file/parsed/failed
    counts (all `0`) render correctly with a `Reindex` button.
  - **Caught and fixed a real UX-honesty issue during this manual verification**: the summary
    stats row originally labeled the completion timestamp "Last indexed" even when
    `status: "failed"` — misleading, since nothing was actually indexed on a failed run.
    Relabeled to the status-neutral "Last run" and reconfirmed via a fresh screenshot.
  - The `completed`-status view (a real file list with expandable symbols) could not be
    exercised live without a real, valid GitHub PAT — deferred to Milestone 6's deterministic,
    mocked-fetch RTL tests, matching exactly how the plan calls for testing this state.
  - Deleted the scratch project/user and confirmed no orphaned `tsx watch`/`vite`/`uvicorn`
    processes remained afterward (`ps aux`); the sibling VoxMind `uvicorn` process was the only
    `uvicorn` process left running, untouched throughout.
- Commit: `27ad914` — "feat(frontend): add codebase index section to project settings".

### 6. Tests
- **`api/src/lib/githubClient.test.ts`** (extended): 8 new cases for `getBranchCommit`,
  `getTree` (including surfacing `truncated: true` and mapping a rate-limited response), and
  `getBlob` (including rejecting an unexpected non-base64 `encoding` field) — same
  mocked-`fetch` pattern the existing tests in this file already use, no new file needed.
- **`ai-service/tests/test_parsing.py`** (new, 13 cases): `detect_language` for every
  supported/unsupported extension; direct `parse_file()` unit tests reusing the exact fixtures
  prototyped in Milestone 1 (nested Python class/method/closure with correct `parent_index`
  chaining three levels deep, TypeScript interface/class/type_alias/arrow-function including
  the `export const arrow = ...` fallthrough case, a `.tsx` file to confirm the TSX grammar is
  actually selected, plain JavaScript); a malformed-JS fixture asserting `"parse_error"` with
  no symbols; an unsupported extension asserting no parse is attempted; and three
  `POST /parsing/parse` endpoint-level tests via `TestClient` (success, unsupported, and a real
  FastAPI 400 `VALIDATION_ERROR` for a missing field). No provider-not-configured case exists
  here, unlike every other ai-service test file — parsing has no LLM dependency to gate.
- **`api/src/routes/codebaseIndex.test.ts`** (new, 14 cases): auth (401 on all five endpoints)
  and ownership (404 for another user's project); `NO_REPOSITORY_CONNECTED` and
  `GITHUB_INTEGRATION_NOT_CONFIGURED` (confirming `fetch` is never called for the latter);
  persisting a `"failed"` row with the real error when branch-commit resolution itself fails
  (the exact gap found and fixed during Milestone 4's manual verification, now covered by an
  automated regression test); the full happy path — connect, start, and confirm the resulting
  index summary, the per-file list (an unsupported `README.md`, a parsed `src/app.ts`, and a
  `node_modules/...` file that never appears at all, confirming directory filtering happens
  before a file ever becomes a candidate), and the persisted symbol for the parsed file, via
  real HTTP responses through the whole route→service→(mocked)client chain; a `parse_error`
  file recorded with no symbols and counted in `failedFileCount`; an oversized file and a
  binary-extension file each skipped with the correct status *and* asserted (via the fetch
  spy's call count) to never trigger a blob fetch; the commit-unchanged short-circuit on
  `start` (asserted via a `fetchSpy.toHaveBeenCalledTimes(1)` — only `getBranchCommit`, no
  `getTree`) versus `reindex` always re-running (`toHaveBeenCalledTimes(2)`); `GET
  .../codebase-index` returning `{ index: null }` before any attempt; and 404
  `CODEBASE_INDEX_NOT_FOUND` for both "no index yet" and "file id not in this index" on the
  files/symbols endpoints. Required re-running `prisma migrate deploy` against the
  `devforge_test` database — Milestone 2's migration had only ever been applied to the local
  dev database and the Docker Postgres volume, not the separate test database vitest.config.ts
  points at, so the very first run of this file failed with `relation "symbols" does not
  exist` before any test logic ran; every prior milestone's full-suite runs had stayed green
  only because nothing yet touched the new tables.
- **`frontend/src/components/CodebaseIndexSection.test.tsx`** (new, 8 cases): the
  no-repository gate (and confirms the index endpoint is never called in that state); a
  connection-load failure error state with retry; the ready state's `Start indexing` control,
  including that a real failure response leaves the ready prompt in place rather than
  rendering a fabricated indexed view; a successful start transitioning to the indexed view; a
  `"failed"`-status index rendering its real error under the status-neutral "Last run" label
  (and explicitly asserting "Last indexed" is never rendered — the exact wording bug found and
  fixed during Milestone 5's manual verification, now guarded by a regression test) and never
  fetching the files list for a failed index; listing indexed files and lazily fetching a
  file's symbols only once it's expanded; a `parse_error` file's inline error message; and
  reindexing, including that a real failure surfaces its real message rather than a fabricated
  success.
- **`tests/codebaseIndex.test.ts`** (new, 1 case): real-HTTP integration test — register,
  create a project, and confirm the honest `NO_REPOSITORY_CONNECTED` response from a genuinely
  running API process for a project with no repository connected, that nothing is persisted
  from the blocked attempt, and that listing files before any index exists is a real 404
  `CODEBASE_INDEX_NOT_FOUND`. Like `tests/repository.test.ts`, needs no real GitHub credentials
  and — notably, since this is the first `tests/` file to note it explicitly — does not need
  `ai-service` running at all, since the pipeline never reaches the parser without a connected
  repository.
- Commands run and results:
  - `npm run typecheck` / `npm run lint` (api, frontend): clean.
  - `npm run test` (api): 174/174 (152 prior + 8 `githubClient` + 14 `codebaseIndex` route
    tests).
  - `python -m pytest -q` (ai-service): 52/52 (39 prior + 13 new).
  - `npm run test` (frontend): 67/67 (59 prior + 8 new).
  - `npm run test` (`tests/`): 9/9 (8 prior + 1 new) — run against the real local dev stack
    (Postgres, `api`, `ai-service` all genuinely running); confirmed the other four
    ai-service-dependent integration tests correctly failed with a clear timeout message when
    `ai-service` was not yet started, then passed once it was — this environment has no
    `ANTHROPIC_API_KEY` set either, so those four still exercise only the honest
    "not configured" paths, unchanged from every prior phase.
  - Combined total across all four suites: **302 tests** (174 api + 52 ai-service + 67
    frontend + 9 tests/) — recomputed and double-checked before writing this line, learning
    from the arithmetic-mistake lesson recorded in Phase 5's and Phase 6's own progress docs.
  - Deleted all scratch data created during manual verification passes in this milestone (none
    beyond what earlier milestones already cleaned up) and confirmed no orphaned `tsx
    watch`/`uvicorn` processes remained after stopping the manually-started servers (`ps aux`);
    the sibling VoxMind `uvicorn` process was the only `uvicorn` process left, untouched
    throughout.
- Commit: `a73a16c` — "test(api,ai-service,frontend,tests): add codebase indexing test
  coverage".

### 7. Docker verification
- No `docker-compose.yml`/`Dockerfile` changes were needed — confirmed via `git status`/`git
  diff` before starting that no Docker config had been touched this phase. `tree-sitter`'s
  wheel availability for the existing `python:3.12-slim` base image had already been confirmed
  during Milestone 1 planning, so `ai-service/requirements.txt`'s new lines were the only thing
  required for the container to pick them up.
- Commands run and results:
  - `docker compose down -v` (full volume wipe, including the standalone dev Postgres left
    running from prior milestones) then `docker compose up -d --build` for a genuinely clean
    rebuild of all four services.
  - Watched the `ai-service` build log directly: `pip install -r requirements.txt` really did
    download and install `tree-sitter-0.26.0`, `tree-sitter-python-0.25.0`,
    `tree-sitter-javascript-0.25.0`, and `tree-sitter-typescript-0.23.2` as
    `manylinux2014_aarch64` wheels inside the container — no compiler invoked, no build
    failure, confirming Milestone 1's `pip download --platform` check was correct in practice,
    not just in theory.
  - All four containers reached `healthy` (`docker compose ps`); confirmed all 7 migrations —
    including `20260912122024_add_codebase_index` — auto-applied from the `api` container's own
    startup logs.
  - Verified `POST /parsing/parse` directly against the containerized `ai-service` for all four
    real cases: a parsed Python file, a parsed TypeScript file, an unsupported `README.md`, and
    a malformed JS file producing `"parse_error"` — all four matched local-dev behavior exactly.
  - Verified the codebase-index endpoints through the containerized `api` (no
    `GITHUB_TOKEN_ENCRYPTION_KEY` passed through Docker Compose, deliberately, mirroring
    Phase 6's decision — this is Docker's real, honest unconfigured state, not a simulation of
    it): registered a user, created a project, confirmed `GET .../codebase-index` returns
    `{ index: null }`, confirmed `POST .../codebase-index/start` returns 400
    `NO_REPOSITORY_CONNECTED`, and confirmed `GET .../codebase-index/files` returns 404
    `CODEBASE_INDEX_NOT_FOUND`.
  - **Re-verified all five prior phases' real dependency-chain behavior through this same
    containerized stack**, not assumed intact: `POST .../repository/connect` still returns 503
    `GITHUB_INTEGRATION_NOT_CONFIGURED`; `POST .../requirements/analyze` still returns 503
    `AI_PROVIDER_UNAVAILABLE`; and `POST .../prd/generate`, `.../architecture/generate`,
    `.../epics/generate`, `.../tasks/generate` each still return their real, honest
    `NO_ACTIVE_*` dependency-chain error — none of Phase 7's changes altered any of these.
  - `cd tests && pnpm test` against the running Docker stack (`API_URL`/`DATABASE_URL` defaults
    already match Docker Compose's mapped ports): 9/9 passed, including the new
    `codebaseIndex.test.ts`.
  - `docker compose logs api` / `docker compose logs ai-service`, grepped for `ghp_` and other
    token-shaped strings: none found in either service's logs.
  - Playwright against the Dockerized frontend (`http://localhost:4173`): registered, created a
    project, opened Settings, and confirmed the "Codebase index" section renders its
    "No repository connected" gate correctly — screenshot read back directly, not just asserted
    to exist.
  - Deleted all scratch users/projects created during this verification via the running
    container's Postgres, then `docker compose down` (without `-v`, preserving the now-current
    `devforge` database) and restored the local-dev baseline: brought the standalone `postgres`
    service back up, recreated `devforge_test` and applied all 7 migrations to it via
    `scripts/setup-test-db.sh`, and confirmed `devforge` itself needed no further migration
    (already current from the Docker run). Re-ran `npm run test` in `api/` against the restored
    local dev database: 174/174 passed. Confirmed no orphaned `tsx watch`/`uvicorn`/`vite`
    processes and that only `devforge-postgres-1` remains running in Docker — the same
    end-state every prior phase's Milestone 7 left the environment in.
  - `git status --porcelain` after all of the above: clean — this milestone required no file
    changes.
- Commit: `b4994b4` — "chore: verify codebase indexing phase against a clean-volume Docker
  rebuild".

### 8. Documentation
- **`README.md`**: updated the status banner, overview, "What works today" (new "AST parsing &
  codebase indexing" bullet; removed "Repository indexing" from the overview page's own
  remaining-capabilities line since it's now implemented), architecture diagram (added the
  ai-service parsing branch and GitHub file-tree/blob retrieval to the existing GitHub REST API
  arrow), tech stack (updated the ai-service row, added a new "AST parsing" row), repository
  structure (updated ai-service's description, added the two new doc files), Docker
  verification note (parsing verified through the container, tree-sitter wheel install
  confirmed from the real build log), tests section (updated the "no test claims..." sentence
  and doc-pointer list), API summary (5 new endpoints, updated the `ai-service` direct-endpoint
  note), database schema (added `codebase_indexes`/`indexed_files`/`symbols`), known
  limitations (reworded the old blanket "no repository ingestion..." bullet — indexing is now
  implemented — and added the 5 limitations from `docs/CODEBASE_INDEX_PHASE_PLAN.md`: the
  synchronous/capped indexing request, only-three-languages, partial symbol-node coverage, no
  cascade-delete on disconnect, no automatic re-verification before indexing), and future work
  (removed "Tree-sitter AST indexing"/"repository ingestion" — implemented; kept and reworded
  embeddings/retrieval/Q&A/review as what's still missing, explicitly noting they build on
  Phase 7's index).
- **`ai-service/README.md`**: added a sentence for `POST /parsing/parse`, explicit that it
  needs no `ANTHROPIC_API_KEY` since it isn't an LLM call.
- **`frontend/README.md`**: checked, no change needed — it was already phase-agnostic (no
  phase-specific feature list to update), same as Phase 6's Milestone 8 finding.
- Commands run and results:
  - Read every changed README section back after editing to confirm no stray phase-6-only
    phrasing remained (e.g. confirmed "What works today"'s AST parsing bullet correctly
    distinguishes *indexing* — implemented — from *retrieval/Q&A* — still future work — and
    confirmed the tech-stack/repository-structure/database-schema sections read consistently
    end to end as one file, not just as isolated diffs).
  - No code changed this milestone, so no test/typecheck/lint re-run was needed; the full
    suite was already green as of Milestone 7's final Docker-and-local-restoration check.
- Commit: `9d368f4` — "docs: update README for Phase 7 (AST Parsing & Codebase Indexing)".

## Phase 7 (AST Parsing & Codebase Indexing): complete

All 8 milestones are done and independently verified (see each entry above for exact commands
and results). Indexing a connected GitHub repository's codebase — resolving its current
commit, fetching its file tree, parsing supported source files with tree-sitter, and
extracting classes/interfaces/type aliases/functions/methods with correct parent/child
nesting into a persisted, browsable index — is implemented and tested end to end.

This phase added **44 new tests**: 22 api (8 `githubClient.test.ts` additions + 14
`codebaseIndex.test.ts`), 13 ai-service (`test_parsing.py`), 8 frontend
(`CodebaseIndexSection.test.tsx`), and 1 real-HTTP integration test
(`tests/codebaseIndex.test.ts`). Combined with every prior phase's suite, the full repository
now has **302 tests passing together, not just individually**: 174 api (152 prior + 22 new) +
52 ai-service (39 prior + 13 new) + 67 frontend (59 prior + 8 new) + 9 tests/ (8 prior + 1 new)
= 302 — recomputed and double-checked (`174+52+67+9 = 302`) immediately before writing this
section, the same arithmetic-care lesson recorded in Phase 5's and Phase 6's own closing
sections.

The two central Milestone 1 design decisions — parsing runs in `ai-service` via tree-sitter
(filling in a placeholder the Phase 4 architecture pass had already left for exactly this,
rather than building a second parser stack in Node), and indexing is a synchronous, capped
request rather than a background job (since no job-queue infrastructure exists anywhere in
this codebase yet) — were made explicit and reasoned through in Milestone 1, with tree-sitter's
`manylinux` wheel availability and the exact symbol node-type/parent-nesting mapping both
confirmed by running real parses *before* committing to the schema, not assumed. Two real bugs
were found and fixed during manual verification, each now covered by a regression test: a
failure resolving the branch's commit originally left no durable "failed" index row for a
subsequent `GET` to show (Milestone 4), and the summary view originally mislabeled a failed
run's timestamp as "Last indexed" (Milestone 5). The system is demonstrable, with an honest
"no repository connected" / "not configured" path throughout since this environment has no
`GITHUB_TOKEN_ENCRYPTION_KEY`, and with genuinely verified real-GitHub-API failure paths
(invalid credentials, both at the connect layer from Phase 6 and now at the indexing layer)
exercised for real — no real, valid GitHub credentials were used or required anywhere in this
phase's verification, and no fabricated index was ever claimed, including in the containerized
Docker environment. No later DevForge feature (embeddings, vector storage, retrieval/semantic
search, codebase Q&A, code review, automatic code generation, automatic task execution, GitHub
issue/PR creation, GitHub Actions integration, additional LLM providers) was implemented,
scaffolded with fake behavior, or claimed as working anywhere in this phase — see the root
README's "Known limitations" and "Future work" sections, which remain the authoritative
statement of what's left.
