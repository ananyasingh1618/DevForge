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
- [ ] 4. Indexing service and API endpoints
- [ ] 5. Frontend codebase index section
- [ ] 6. Tests
- [ ] 7. Docker verification
- [ ] 8. Documentation

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
_Not started._

### 5. Frontend codebase index section
_Not started._

### 6. Tests
_Not started._

### 7. Docker verification
_Not started._

### 8. Documentation
_Not started._
