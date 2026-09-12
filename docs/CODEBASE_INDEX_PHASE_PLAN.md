# DevForge Phase 7 (AST Parsing & Codebase Indexing) — Implementation Plan

## Scope

In scope: retrieving source files from a connected GitHub repository, detecting
supported languages, parsing those files into an AST, extracting top-level and
nested symbols (functions, classes, methods, interfaces, type aliases), persisting
the resulting index (files + symbols), an indexing lifecycle (start, status,
reindex), API endpoints, a frontend Codebase Index section, tests, Docker
verification, and documentation.

Out of scope (explicitly, per the task): embeddings, vector databases, retrieval
or semantic search, codebase Q&A, code review, automatic code generation,
automatic task execution, GitHub issue/PR creation, GitHub Actions integration,
additional LLM providers, unrelated refactoring. This phase produces a
structured index — it does not consume it. VoxMind is untouched.

## Where indexing lives — decision: ai-service does the parsing, the Node API orchestrates

Every prior phase's `content: Json` generation (requirements → PRD →
architecture → epics → tasks) already splits responsibility the same way: the
Node API owns auth, ownership, persistence, and orchestration; ai-service (Python)
owns the actual transformation and returns validated structured JSON over HTTP
(see `api/src/lib/aiServiceClient.ts` and `ai-service/app/agents/*/router.py`).
Codebase indexing follows the same split, for two concrete reasons:

1. `ai-service/app/parsing/__init__.py` already exists as a placeholder from the
   Phase 4 architecture pass (`"Tree-sitter AST-aware repository parsing and
   chunking. Not implemented yet."`) — this phase fills that placeholder in,
   rather than inventing a new location for parsing.
2. AST parsing needs a real parser library, and **tree-sitter** is the only
   option evaluated that is (a) genuinely multi-language from one API, (b)
   ships prebuilt wheels — confirmed by `pip download --platform
   manylinux2014_x86_64 --python-version 312 --only-binary=:all:` for
   `tree-sitter`, `tree-sitter-python`, `tree-sitter-javascript`, and
   `tree-sitter-typescript` — so the existing `python:3.12-slim` ai-service
   Docker image needs no compiler or apt packages added, and (c) is not an LLM
   call, so it belongs next to the other "worker for the Node API" concerns in
   ai-service rather than duplicated as a second parser stack inside Node.

Concretely: the Node API's `repository` service already decrypts the stored PAT
and calls GitHub directly via `githubClient.ts` (fetching file trees and blobs
does not need a new capability class — it is the same authenticated GitHub REST
call `getRepository`/`listBranches` already make). Node fetches each candidate
file's raw source, then POSTs `{ path, content }` to ai-service's new
`POST /parsing/parse` endpoint, which returns detected language + extracted
symbols (or a structured parse-failure reason). Node persists the result. This
mirrors `analyzeRequirementsViaAiService` etc. exactly: Node never fabricates a
parse result, and a parse failure for one file is recorded, not silently
dropped or allowed to fail the whole index.

### Alternative considered and rejected: a Node-only parser (TypeScript Compiler API + no Python parser)

`typescript` is already a devDependency of `api/`, so TS/JS parsing could be
done in-process in Node with zero new runtime dependencies. This was rejected
as the *sole* approach because it cannot cover Python — the task's own example
language list is "TypeScript, JavaScript, Python" — and running two unrelated
parser stacks (TS compiler API in Node, something else in Python) for three
languages is more moving parts than one tree-sitter installation in the process
that was already earmarked for this. Node's role stays what it already is for
every other content-producing phase: fetch input, call the worker, validate
and persist the response.

## Supported languages (Milestone 1 — explicit, not aspirational)

Exactly three, matching the task's own example list and what was prototyped
and confirmed working against real tree-sitter grammars before writing
production code:

| Language | Extensions | Grammar package |
|---|---|---|
| Python | `.py` | `tree-sitter-python` |
| TypeScript | `.ts`, `.tsx` | `tree-sitter-typescript` (`language_typescript()` / `language_tsx()`) |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | `tree-sitter-javascript` |

Any other extension is recorded as an indexed file with `parseStatus:
"unsupported"` — its bytes are counted (file discovery is honest about what
exists in the repo) but no parse is attempted and no symbols are extracted.
Nothing here claims support for a language it does not actually parse.

## Symbol extraction — prototyped node-type mapping

Prototyped directly against `tree-sitter-python` and `tree-sitter-typescript`
(see commands run during planning) before committing to a schema:

- Python: `class_definition` → `class`, `function_definition` → `function` (or
  `method` when nested directly inside a `class_definition`).
- TypeScript/JavaScript: `class_declaration` → `class`, `interface_declaration`
  → `interface`, `type_alias_declaration` → `type_alias`,
  `function_declaration` → `function`, `method_definition` → `method`, and a
  `variable_declarator` whose initializer is an `arrow_function` or
  `function_expression` → `function` (a plain non-function variable is not
  recorded as a symbol — this only extracts callable/type-bearing declarations,
  matching "extracted symbols" in the task, not a full variable index).
- Nesting: a symbol's `parentSymbol` is the nearest enclosing symbol on the walk
  (e.g. a method inside a class, a closure inside a method) — confirmed
  correct against a nested-closure fixture during prototyping.
- Every symbol records `startLine`/`endLine` (from tree-sitter's
  `start_point`/`end_point`, 0-indexed rows converted to 1-indexed lines) and,
  where available, a `signature` (the declaration's parameter list as written).

## File retrieval and filtering (Milestone 3)

Extends `githubClient.ts` with three calls, all using the same authenticated
`githubFetch` helper and the same error mapping already in place:

- `getBranchCommit(token, owner, repo, branch)` — `GET
  /repos/{owner}/{repo}/branches/{branch}` → the branch's current commit SHA
  (also 404s honestly if the branch no longer exists, reusing
  `GITHUB_REPOSITORY_NOT_FOUND`-style handling).
- `getTree(token, owner, repo, sha)` — `GET
  /repos/{owner}/{repo}/git/trees/{sha}?recursive=1` → the full file tree for
  that commit. GitHub truncates this response (`truncated: true`) for very
  large repositories; when that happens the index is still built from the
  files GitHub did return, and `CodebaseIndex.truncated: true` (see schema
  below) records the fact rather than silently indexing a partial tree as if
  it were complete.
- `getBlob(token, owner, repo, sha)` — `GET /repos/{owner}/{repo}/git/blobs/{sha}`
  → base64 file content for one blob.

Filtering before any blob is fetched:

- Skip directories: `node_modules`, `.git`, `dist`, `build`, `out`, `.next`,
  `venv`, `.venv`, `__pycache__`, `.tox`, `vendor`, `coverage` (checked as a
  path segment, so `apps/foo/dist/x.js` is skipped the same as `dist/x.js`).
- Skip anything above 300 KB (`MAX_FILE_SIZE_BYTES`) — recorded as an indexed
  file with `parseStatus: "skipped_too_large"`, not silently dropped.
- Skip GitHub tree entries that aren't blobs (`type !== "blob"`, e.g.
  submodules/symlinks reported as `commit`/`120000` mode entries).
- Cap total files considered at `MAX_INDEXED_FILES = 500`; beyond that, later
  files (by path, sorted) are recorded as `parseStatus: "skipped_index_limit"`
  rather than fetched. This keeps a single synchronous indexing request
  bounded — see "Indexing lifecycle" below for why it is synchronous.
- A binary file (detected by extension denylist — images, fonts, archives,
  compiled artifacts — plus a NUL-byte sniff on the fetched content as a
  second check) is recorded as `parseStatus: "skipped_binary"`.

Every skip reason above is a distinct, real `parseStatus` value the frontend
can render — never a generic "failed".

## Indexing lifecycle (Milestone 4)

No background job queue exists anywhere in this codebase (every prior "start
generation" endpoint is a single synchronous HTTP request that blocks until
ai-service responds). Codebase indexing follows the same shape rather than
introducing new infrastructure: `POST /projects/:id/codebase-index/start` runs
the full fetch-filter-parse-persist pipeline synchronously and returns only
once the index reaches `completed` or `failed`. This is bounded by the file
count/size caps above, and is called out explicitly as a limitation (see
below) — a genuinely large monorepo would need a background worker, which is
future work, not this phase.

One `CodebaseIndex` row per `(projectId)` — like `RepositoryConnection`, this
is replaced state, not a versioned artifact: indexing the same connection
again reuses the row (`@@unique([projectId])`), and its files/symbols are
replaced wholesale in a transaction. **Determinism / no duplicate work**: if
the resolved commit SHA for the requested branch is unchanged from the index's
current `commitSha` and its `status` is already `completed`, `start` returns
the existing index without re-fetching or re-parsing anything — this is the
"avoid unnecessary duplicate records when reindexing the same commit"
requirement. An explicit reindex (`POST .../reindex`) always re-resolves the
branch's current commit and re-runs the pipeline, even if the SHA is
unchanged, since the whole point of a manual reindex is "run it again."

Status values: `pending` (row exists, indexing not yet started — not actually
reachable in the synchronous flow, kept for schema symmetry with
`RepositoryConnectionStatus` and so a future async version is a data
migration, not a schema change), `indexing` (set at the start of the
synchronous call; if the process crashes mid-request this is the one state a
client could see "stuck," documented as a known limitation), `completed`,
`failed` (the pipeline itself errored before producing any files — e.g. GitHub
access failure, not an individual file's parse failure, which is recorded
per-file instead).

## Milestone 2 — Database

```prisma
enum CodebaseIndexStatus {
  pending
  indexing
  completed
  failed
}

enum FileParseStatus {
  parsed
  unsupported
  parse_error
  skipped_binary
  skipped_too_large
  skipped_index_limit
}

model CodebaseIndex {
  id                     String              @id @default(uuid())
  projectId              String              @unique @map("project_id")
  repositoryConnectionId String              @map("repository_connection_id")
  branch                 String
  commitSha              String?             @map("commit_sha")
  status                 CodebaseIndexStatus @default(pending)
  truncated              Boolean             @default(false)
  fileCount              Int                 @default(0) @map("file_count")
  parsedFileCount        Int                 @default(0) @map("parsed_file_count")
  failedFileCount        Int                 @default(0) @map("failed_file_count")
  startedAt              DateTime?           @map("started_at")
  completedAt            DateTime?           @map("completed_at")
  error                  String?
  createdAt              DateTime            @default(now()) @map("created_at")
  updatedAt              DateTime            @updatedAt @map("updated_at")

  project              Project              @relation(fields: [projectId], references: [id], onDelete: Cascade)
  repositoryConnection RepositoryConnection @relation(fields: [repositoryConnectionId], references: [id])
  files                IndexedFile[]

  @@map("codebase_indexes")
}

model IndexedFile {
  id          String           @id @default(uuid())
  indexId     String           @map("index_id")
  path        String
  language    String?
  sizeBytes   Int              @map("size_bytes")
  contentHash String           @map("content_hash")
  parseStatus FileParseStatus  @map("parse_status")
  parseError  String?          @map("parse_error")
  createdAt   DateTime         @default(now()) @map("created_at")

  index   CodebaseIndex @relation(fields: [indexId], references: [id], onDelete: Cascade)
  symbols Symbol[]

  @@unique([indexId, path])
  @@index([indexId])
  @@map("indexed_files")
}

model Symbol {
  id          String  @id @default(uuid())
  fileId      String  @map("file_id")
  name        String
  type        String
  startLine   Int     @map("start_line")
  endLine     Int     @map("end_line")
  parentId    String? @map("parent_id")
  signature   String?

  file   IndexedFile @relation(fields: [fileId], references: [id], onDelete: Cascade)
  parent Symbol?     @relation("SymbolParent", fields: [parentId], references: [id], onDelete: SetNull)
  children Symbol[]  @relation("SymbolParent")

  @@index([fileId])
  @@index([parentId])
  @@map("symbols")
}
```

Notes:

- `repositoryConnectionId` is a plain FK (`onDelete` not cascading from
  `RepositoryConnection` — deliberately `Restrict`-by-default in Prisma):
  disconnecting a repository does not silently delete its index history in
  the same request; the existing `disconnectRepository` flow is untouched by
  this phase (out of scope to change), so in practice a disconnect leaves an
  orphaned-but-harmless index row pointing at a connection id that no longer
  resolves via the live join — documented as a known limitation, not fixed
  here since deciding "delete the index on disconnect vs. keep it" is a
  product decision outside this phase's explicit scope.
- No full source file content is stored — only `contentHash` (SHA-256 of the
  fetched bytes, for future change-detection) per the task's "avoid storing
  full source files unless the existing architecture clearly requires it."
  The architecture does not require it: symbols carry line ranges, not text.
- `type` and `signature` are plain strings, not enums — the set of possible
  symbol kinds already spans three unrelated grammars (`class`, `interface`,
  `type_alias`, `function`, `method`) and a Prisma enum shared across
  languages would need editing every time a language is added, working
  against "prefer a modular parser interface so additional languages can be
  added later."
- No secrets are stored anywhere in this schema — it never touches the PAT;
  `repositoryConnectionId` is looked up through the existing
  `RepositoryConnection`/`githubTokenCrypto` path.

## API design (Milestone 4)

All under `requireAuth`, all ownership-enforced via the same
`requireOwnedProject` pattern already in `services/repository.ts`, all
returning the standard `{ data }` / `{ error }` envelope.

| Method | Path | Behavior |
|---|---|---|
| POST | `/projects/:projectId/codebase-index/start` | Start (or short-circuit-return, if the commit is unchanged and already completed) indexing the connected repository's selected branch. 404 if no repository is connected. 503 `GITHUB_INTEGRATION_NOT_CONFIGURED` if unconfigured (same code the repository endpoints already use). |
| GET | `/projects/:projectId/codebase-index` | Current index status/summary, or `{ index: null }` if never started. |
| GET | `/projects/:projectId/codebase-index/files` | List indexed files (path, language, parseStatus, sizeBytes) for the current index. |
| GET | `/projects/:projectId/codebase-index/files/:fileId/symbols` | List extracted symbols for one file, nested via `parentId`. |
| POST | `/projects/:projectId/codebase-index/reindex` | Always re-resolves the branch and re-runs the pipeline. |

Errors reuse existing codes where the situation is identical
(`GITHUB_INTEGRATION_NOT_CONFIGURED`, `GITHUB_INVALID_CREDENTIALS`,
`GITHUB_RATE_LIMITED`, etc. from `githubClient.ts`) and add:
`NO_REPOSITORY_CONNECTED` (400, no `RepositoryConnection` row),
`CODEBASE_INDEX_NOT_FOUND` (404, files/symbols requested before any index run),
`PARSER_SERVICE_UNREACHABLE` (502, mirrors `AI_SERVICE_UNREACHABLE` for the
ai-service call, distinctly named since this isn't an LLM call).

## Frontend (Milestone 5)

A second `Card`-based section on the existing `ProjectSettings` page (same
page `RepositoryConnectionSection` already lives on — codebase indexing is a
property of the connected repository, not a separate page), gated on a
connection existing: `CodebaseIndexSection` renders `EmptyState` ("Connect a
GitHub repository first") if `getRepositoryConnectionRequest` returned `null`,
otherwise its own state machine (`loading` → `ready` | `indexing` | `indexed`
| `error`) using the same `Button`/`Card`/`EmptyState`/`ErrorState`/
`LoadingState` components as every other section, no new design system. The
`indexing` state is exactly "the Start/Reindex button's own request is
in-flight" (`loading` prop on `Button`, matching every other action button
already in this codebase) — never a fabricated progress bar, since indexing is
synchronous and DevForge has no partial-progress signal to show. File/symbol
inspection is a simple expandable list (click a file row → fetch and show its
symbols), reusing `<select>`/list patterns already used elsewhere rather than
introducing a table component.

## Testing strategy (Milestone 6)

Same three-tier split as Phase 6: mocked-fetch unit tests for the new
`githubClient.ts` functions and the ai-service parser (deterministic fixture
source strings, no real GitHub or real repository needed), Supertest API tests
with a fake ai-service response layer, one real-HTTP `tests/` integration test
proving the honest `GITHUB_INTEGRATION_NOT_CONFIGURED` (or equivalent) path end
to end, and RTL frontend tests for every `CodebaseIndexSection` state. The
ai-service parser gets its own pytest module calling the tree-sitter-backed
parse function directly against fixture source (a Python file, a TS file, a JS
file, and an intentionally-malformed file for the parse-error path) — this is
the one new test layer this phase adds beyond what Phase 6 needed, since Phase
6 had no new ai-service code.

## Docker verification strategy (Milestone 7)

Same volume-wiped rebuild process as Phase 6, plus: confirm `pip install`
inside the rebuilt `ai-service` image actually pulled the tree-sitter wheels
(not just that the container is healthy), confirm `POST /parsing/parse`
answers correctly for one fixture per supported language through the
containerized ai-service directly, and confirm the Node API's
`codebase-index/start` endpoint reaches that containerized ai-service and
returns the same honest "no repository connected" / "GitHub not configured"
errors as local dev when no real GitHub credentials are present — never
claiming a real repository was actually indexed without one.

## Explicit limitations (documented up front)

- Indexing runs synchronously within one HTTP request, bounded by
  `MAX_INDEXED_FILES` (500) and `MAX_FILE_SIZE_BYTES` (300 KB) — a
  genuinely large repository will hit these caps rather than indexing
  everything, and a slow GitHub API round-trip makes the request itself slow.
  A background job queue is the natural fix and is out of scope here.
- Only three languages are parsed (Python, TypeScript, JavaScript). Every
  other extension is recorded as `unsupported`, never silently skipped from
  the file list.
- Symbol extraction covers class/interface/type-alias/function/method
  declarations only — not every AST node (e.g. not import statements,
  decorators as standalone symbols, or object-literal methods).
- Disconnecting a repository does not cascade-delete its codebase index (see
  the Milestone 2 notes above).
- No re-verification of GitHub access happens automatically before indexing;
  a token that was valid at last `verifyAccess` but has since been revoked
  surfaces as a real `GITHUB_INVALID_CREDENTIALS` failure from the indexing
  call itself, the same way it would from any other GitHub-calling endpoint.

## Explicit non-goals (per the user's instructions)

Embeddings, vector databases, retrieval/semantic search, codebase Q&A, code
review, automatic code generation, automatic task execution, GitHub issue/PR
creation, GitHub Actions integration, additional LLM providers. None of these
are implemented, referenced, or stubbed with fake behavior in this phase.

## Milestones

1. Planning (this document).
2. Database — `CodebaseIndex`, `IndexedFile`, `Symbol` models + migration.
3. GitHub retrieval (`githubClient.ts` additions) + ai-service parser
   (`app/parsing/`, tree-sitter-backed).
4. Indexing service + API endpoints.
5. Frontend `CodebaseIndexSection`.
6. Tests (DB, GitHub retrieval, parser, API, frontend).
7. Docker verification.
8. Documentation.
