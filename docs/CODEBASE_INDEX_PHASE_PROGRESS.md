# DevForge Phase 7 (AST Parsing & Codebase Indexing) — Progress Checklist

See [docs/CODEBASE_INDEX_PHASE_PLAN.md](CODEBASE_INDEX_PHASE_PLAN.md) for scope, data model,
API contracts, and the full plan. This file tracks the 8 milestones the same way
[docs/GITHUB_INTEGRATION_PHASE_PROGRESS.md](GITHUB_INTEGRATION_PHASE_PROGRESS.md) tracked
Phase 6.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Inspect and plan
- [ ] 2. Prisma schema and migration
- [ ] 3. GitHub retrieval and ai-service parser
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
_Not started._

### 3. GitHub retrieval and ai-service parser
_Not started._

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
