# DevForge

AI Software Engineering & Codebase Intelligence Platform.

> **Current status: Foundation phase + Phase 2 (Requirements Analysis) + Phase 3 (PRD
> Generation) + Phase 4 (Architecture Generation) + Phase 5 (Epics & Tasks Generation) +
> Phase 6 (GitHub Integration) + Phase 7 (AST Parsing & Codebase Indexing) + Phase 8
> (Retrieval & Semantic Search) + Phase 9 (Codebase Q&A) + Phase 10 (AI Code Review)
> complete.** This repository implements authentication, a project workspace, AI-assisted
> requirements analysis, AI-assisted PRD generation, AI-assisted architecture generation,
> AI-assisted epic/task generation, a secure GitHub repository connection, tree-sitter-backed
> AST parsing and codebase indexing, semantic code search (chunking the indexed codebase along
> symbol boundaries, embedding it via Voyage AI, and ranking results by cosine similarity), a
> grounded, **read-only** codebase Q&A layer over that retrieval, and a grounded, **read-only**
> AI code review layer over that same retrieval, end to end, with tests and a working Docker
> Compose stack. Both Codebase Q&A and AI Code Review are strictly read-only — neither modifies
> code, opens pull requests, creates GitHub issues, or runs GitHub Actions — see "Known
> limitations" below. See [docs/FOUNDATION_PROGRESS.md](docs/FOUNDATION_PROGRESS.md),
> [docs/REQUIREMENTS_PHASE_PROGRESS.md](docs/REQUIREMENTS_PHASE_PROGRESS.md),
> [docs/PRD_PHASE_PROGRESS.md](docs/PRD_PHASE_PROGRESS.md),
> [docs/ARCHITECTURE_PHASE_PROGRESS.md](docs/ARCHITECTURE_PHASE_PROGRESS.md),
> [docs/EPICS_TASKS_PHASE_PROGRESS.md](docs/EPICS_TASKS_PHASE_PROGRESS.md),
> [docs/GITHUB_INTEGRATION_PHASE_PROGRESS.md](docs/GITHUB_INTEGRATION_PHASE_PROGRESS.md),
> [docs/CODEBASE_INDEX_PHASE_PROGRESS.md](docs/CODEBASE_INDEX_PHASE_PROGRESS.md),
> [docs/RETRIEVAL_PHASE_PROGRESS.md](docs/RETRIEVAL_PHASE_PROGRESS.md),
> [docs/QA_PHASE_PROGRESS.md](docs/QA_PHASE_PROGRESS.md), and
> [docs/CODE_REVIEW_PHASE_PROGRESS.md](docs/CODE_REVIEW_PHASE_PROGRESS.md) for the detailed,
> verified log of every milestone that built each phase.

## Overview

DevForge is an AI-assisted software engineering workspace: turn an idea into structured
requirements, a PRD, a technical architecture, and actionable epics/tasks, connect a GitHub
repository, and get grounded, cited answers and AI-assisted code review against that real
codebase. The Foundation phase built what everything else attaches to (auth, project
ownership); Phase 2 added the first real AI capability — turning a free-text idea into
structured, versioned requirements; Phase 3 added the second — turning a project's active
requirements version into a structured, versioned PRD; Phase 4 added the third — turning a
project's active PRD version into a structured, versioned technical architecture; Phase 5
added the fourth and fifth — turning a project's active architecture version into a versioned
set of epics, and its active epic version into a versioned set of tasks; Phase 6 added the
first non-AI capability — securely connecting a GitHub repository to a project; Phase 7 built
on that connection — fetching the repository's source, parsing supported files into an AST,
and extracting symbols into a persisted, browsable index; Phase 8 built on that index —
chunking it along symbol boundaries, embedding the chunks, and ranking them by similarity
against a natural-language query; Phase 9 built on that retrieval — grounding a Claude-written
answer in only the retrieved evidence, with real, Node-verified citations, never the model's
own free-text claim of a file/line; Phase 10 builds on the same retrieval and the same
citation-safety mechanism a second time — reporting a set of severity/category-tagged findings
with recommendations, each grounded in and citing only real, retrieved evidence, never
inventing a file, symbol, or line number, and never applying a fix itself.

## What works today

- Register, log in, log out, and check the current session (`/auth/*`).
- Create, list, and view projects, scoped to the authenticated owner — a project that
  doesn't exist and a project owned by someone else are both a 404, never a 403 or leaked
  data.
- **Requirements analysis**: describe a project idea and DevForge analyzes it (via Anthropic's
  Claude, `claude-opus-5`) into structured, versioned requirements — a project summary,
  users, functional and non-functional requirements (each with priority, acceptance
  criteria, and an explicit **stated vs. inferred** source tag), constraints, assumptions,
  and open questions. Versions can be listed, viewed, edited, and made active; two versions
  can be compared. If no `ANTHROPIC_API_KEY` is configured, analysis fails with a clear,
  honest error — never a fabricated result.
- **PRD generation**: generate a structured Product Requirements Document (overview, problem
  statement, goals, personas, functional and non-functional requirements, user workflows,
  edge cases, success criteria, constraints, assumptions, and open questions) from a project's
  currently **active** requirements version. A project with no active requirements version
  shows a clear dependency message instead of an enabled control that would fail on click.
  Versions can be listed, viewed, edited, and made active; two versions can be compared. Same
  honesty guarantee as requirements analysis: no `ANTHROPIC_API_KEY` configured means a clear
  503, never a fabricated PRD.
- **Architecture generation**: generate a structured technical architecture (overview, system
  architecture, technology stack, components, data model, API design, data flows, security,
  scalability, deployment, tradeoffs, assumptions, and open questions) from a project's
  currently **active** PRD version. A project with no active PRD version shows a clear
  dependency message instead of an enabled control that would fail on click. Versions can be
  listed, viewed, edited, and made active; two versions can be compared. Same honesty
  guarantee as requirements analysis and PRD generation: no `ANTHROPIC_API_KEY` configured
  means a clear 503, never a fabricated architecture.
- **Epic generation**: break a project's currently **active** architecture version into a
  versioned set of epics (title, description, objective, business value, scope, acceptance
  criteria, dependencies, and related architecture components). A project with no active
  architecture version shows a clear dependency message instead of an enabled control.
  Versions can be listed, viewed, edited (per epic), and made active; two versions can be
  compared. Same honesty guarantee: no `ANTHROPIC_API_KEY` configured means a clear 503, never
  fabricated epics.
- **Task generation**: break a project's currently **active** epic version into a versioned
  set of tasks (title, description, type, priority, acceptance criteria, dependencies, the
  epic it belongs to, a related architecture component, estimated complexity, and a suggested
  implementation order). A project with no active epic version shows a clear dependency
  message instead of an enabled control. Versions can be listed, viewed, edited (per task),
  and made active; two versions can be compared. Same honesty guarantee: no
  `ANTHROPIC_API_KEY` configured means a clear 503, never fabricated tasks.
- **GitHub repository connection**: connect a GitHub repository to a project from its Settings
  page using a personal access token you generate yourself — DevForge never invents or assumes
  one exists, and never uses OAuth or a GitHub App (see "Known limitations" for why). The
  connection is verified against the real GitHub API before being saved; the token is
  encrypted at rest (AES-256-GCM) and never returned by any API response — only its last four
  characters are. View connection status, the authenticated GitHub account, and the last
  verification result; list and select a branch (validated against the repository's real
  branches); reverify access or disconnect at any time. If `GITHUB_TOKEN_ENCRYPTION_KEY` isn't
  configured, connecting fails with a clear, honest error — never a fabricated connection.
- **AST parsing & codebase indexing**: from a project's Settings page, index the connected
  repository's selected branch — resolves the branch's current commit, fetches its file tree
  from the real GitHub API, parses supported files (Python, TypeScript, JavaScript) with
  tree-sitter, and extracts symbols (classes, interfaces, type aliases, functions, methods,
  with correct parent/child nesting). View the index's status, file/parsed/failed counts, and
  last error; browse indexed files (including *why* an unsupported/binary/oversized file was
  skipped, never silently dropped from the list) and a file's extracted symbols; reindex at
  any time. Indexing the same branch at the same commit again is a no-op — it reuses the
  existing completed index rather than redoing the work; an explicit reindex always re-runs.
  Same honesty guarantee as GitHub repository connection: no connected repository, no
  `GITHUB_TOKEN_ENCRYPTION_KEY` configured, or a real GitHub/parser failure each produce a
  clear, real error — never a fabricated index.
- **Semantic code search**: from a project's own Code Search page, search a fully indexed
  codebase with a natural-language query. Code is chunked along its Phase 7 symbol boundaries
  (one chunk per class/interface/function/method, oversized symbols split with overlap, a
  whole-file fallback for symbol-less files), embedded via Voyage AI (`voyage-code-3`), and
  ranked by cosine similarity against the query's own embedding. Chunking and embedding happen
  lazily on first search and are reused on every later search against the same indexed commit
  — an explicit reindex is required to search a different commit. Results show the file path,
  symbol name, a source snippet, exact line range, language, branch/commit, and similarity
  score; a genuinely empty result set is shown honestly, never as an error. Requesting a
  branch/commit other than the one currently indexed is a clear, real error, not a silent
  mismatch. Same honesty guarantee as every other AI capability: no completed index, no
  `GITHUB_TOKEN_ENCRYPTION_KEY`, or no `VOYAGE_API_KEY` each produce a clear, real error —
  never fabricated results.
- **Codebase Q&A**: from a project's Codebase Q&A page, ask a natural-language question about
  a fully indexed repository and get a grounded answer — read-only, never modifying code,
  opening a pull request, filing a GitHub issue, or running a GitHub Action. DevForge retrieves
  relevant code via Phase 8 search (never the whole repository), deduplicates overlapping
  evidence, sends the question plus up to 8 numbered source excerpts to Claude, and returns the
  answer with citations. The model's structured output can only *select*, by number, which of
  those already-real sources it drew from — it never outputs a file path, symbol name, or line
  number itself, so a citation can never be invented. Retrieved code is treated as untrusted
  data: the system prompt instructs Claude to ignore any instruction-like text found inside it
  and never repeat a secret/credential value even if one appears in a source. A genuinely empty
  evidence set skips the Claude call entirely and returns a real, local "insufficient evidence"
  answer. Every question and its evidence are saved and listable per project — not a chat
  thread, a simple history of independently-answered questions. Same honesty guarantee as
  every other AI capability: no completed index, no `GITHUB_TOKEN_ENCRYPTION_KEY`, no
  `VOYAGE_API_KEY`, or no `ANTHROPIC_API_KEY` each produce a clear, real error — never a
  fabricated answer.
- **AI code review**: from a project's Code Review page, describe what to review (or leave it
  blank for a general review) and get a set of findings — read-only, never modifying code,
  running a command, creating a commit, opening a pull request, filing a GitHub issue, or
  running a GitHub Action. DevForge retrieves relevant code via the same Phase 8 search Q&A
  uses (never the whole repository), deduplicates overlapping evidence, sends the scope plus up
  to 8 numbered source excerpts to Claude, and returns a summary plus a list of findings — each
  with a title, description, controlled severity (`critical`/`high`/`medium`/`low`/`info`) and
  category (`bug`/`security`/`reliability`/`performance`/`maintainability`/`validation`/
  `error_handling`/`testing`/`architecture`/`other`), a confidence level, a recommendation, and
  trusted source citations resolved entirely from Node's own retrieval records. Exactly like
  Q&A, the model's structured output can only *select*, by number, which already-real sources a
  finding draws from — it never outputs a file path, symbol name, or line number itself, and a
  finding left with zero valid citations after filtering is dropped entirely, never persisted.
  The system prompt instructs Claude to prefer "potential issue" language over asserted
  certainty when evidence is incomplete, never report a generic style preference as a defect,
  and return an empty findings list rather than manufacture one to look useful. A genuinely
  empty evidence set skips the Claude call entirely and returns a real, local "no relevant code
  found" review. Every review and its findings/evidence are saved and listable per project, with
  simple client-side filtering by severity/category/confidence. Same honesty guarantee as every
  other AI capability: no completed index, no `GITHUB_TOKEN_ENCRYPTION_KEY`, no
  `VOYAGE_API_KEY`, or no `ANTHROPIC_API_KEY` each produce a clear, real error — never a
  fabricated review; a genuine provider failure after evidence has been gathered leaves a real,
  durable "failed" review row rather than an orphaned or silently dropped one.
- A project overview page that shows real project data — every planned capability from the
  original spec (requirements through code review) is now implemented, so there is no longer a
  "Not yet implemented" section on this page.
- Opaque, server-side sessions: a random token lives only in an httpOnly cookie; only its
  SHA-256 hash is ever persisted.
- The full stack (Postgres, API, frontend, and the AI service) runs via a single
  `docker compose up` from a clean checkout, migrations included.

## Architecture

```
React + TypeScript (Vite)                 Python/FastAPI AI service
        |                                    requirements analysis + PRD generation +
        | fetch, credentials: include         architecture generation + epic/task generation +
        v                                     codebase Q&A + AI code review
Node/Express API  ------------------------->   (Anthropic Claude, claude-opus-5);
        |            fetch (AI_SERVICE_URL)    + tree-sitter source parsing (no LLM call);
        |                                       + Voyage AI embedding generation (no LLM call)
        |----------------------------------> GitHub REST API (api.github.com)
        |            fetch, encrypted PAT      repository metadata, branches, access
        |                                      verification, file tree + blob content
        | Prisma (driver adapter: @prisma/adapter-pg)
        v
   PostgreSQL (code chunk text + Float[] embedding vectors — no pgvector)
```

The Node API and the Python AI service are separate processes/containers — the architecture
principle from the full spec ("keep application CRUD/orchestration separate from AI-heavy
processing") holds: the Node API validates, persists, and enforces ownership; the AI service
does the LLM calls (requirements/PRD/architecture/epic/task generation, codebase Q&A, and now
AI code review) and returns structured, schema-validated content, and also does tree-sitter-
backed source parsing (Phase 7) and Voyage-AI-backed embedding generation (Phase 8) — neither
an LLM call, but both specialized-library/external-API concerns kept out of the Node process.
GitHub connectivity and file retrieval are Node API concerns only (there's no AI involved in
verifying repository access or fetching a file tree), so the Node API calls the GitHub REST
API directly rather than routing through `ai-service`; it sends each fetched file's content to
`ai-service`'s parser to extract symbols, chunks the parsed result itself (pure string-slicing,
no AI needed), sends the chunk text to `ai-service`'s embedding endpoint, ranks the returned
vectors by cosine similarity computed in the Node process itself (not in Postgres, and not via
pgvector — see "Database schema" below), and for both Q&A and code review sends the question/
scope plus a fixed, numbered list of the top-ranked chunks to `ai-service`'s Q&A or review
endpoint — Claude only ever selects among that list by number, never emitting a path or line
itself, in either agent.

## Tech stack

| Area | Choice | Why |
|---|---|---|
| Frontend | React 19 + TypeScript (strict) + Vite | Fast dev loop, first-class TS support |
| Styling | Tailwind CSS v4 + CSS-variable design tokens | Fast, consistent "mature developer tool" look; tokens in `frontend/src/index.css` |
| Routing | React Router v7 | Standard client-side routing |
| API | Node/Express 5 | Matches the target architecture's app/orchestration layer |
| ORM | Prisma 7 (with the `@prisma/adapter-pg` driver adapter it now requires) | Typed queries, migration history, matches TS strict mode |
| Database | PostgreSQL 16 | Relational data with real foreign-key/cascade guarantees |
| Auth | Opaque server-side session tokens (httpOnly, Secure-in-prod, SameSite=Lax cookie); only a SHA-256 token hash is stored | Real logout/revocation without JWT's blocklist problem |
| Password hashing | bcrypt, cost factor 12 | Industry standard |
| Validation | Zod (Node), Pydantic (ai-service) | Request bodies, route params, and environment variables validated the same way in each language |
| AI provider | Anthropic Claude (`claude-opus-5`), via `client.messages.parse()` structured outputs | No provider was configured before Phase 2; documented choice in `docs/REQUIREMENTS_PHASE_PLAN.md` — first-party SDK, strict structured-output support |
| Testing | Vitest, Supertest, pytest, React Testing Library, Playwright (ad hoc manual verification) | One test runner style per language |
| AI service | Python/FastAPI | Its own process/container; requirements analysis, PRD generation, architecture generation, epic/task generation, codebase Q&A, AI code review, tree-sitter source parsing, and Voyage AI embedding generation are implemented |
| GitHub integration | Personal access token (user-supplied), native `fetch` against the GitHub REST API, AES-256-GCM token encryption via Node's built-in `crypto` | Smallest secure option — no OAuth App/GitHub App registration or callback infrastructure needed; no new dependency for a thin HTTP boundary. Documented choice in `docs/GITHUB_INTEGRATION_PHASE_PLAN.md` |
| AST parsing | tree-sitter (`tree-sitter`, `tree-sitter-python`, `tree-sitter-javascript`, `tree-sitter-typescript`), inside `ai-service` | Genuinely multi-language from one API, ships prebuilt `manylinux` wheels (confirmed for the existing `python:3.12-slim` image before adopting it — no compiler needed), and belongs next to the other "worker for the Node API" concern rather than a second parser stack in Node. Documented choice in `docs/CODEBASE_INDEX_PHASE_PLAN.md` |
| Embeddings | Voyage AI (`voyage-code-3`, a code-retrieval-specific model), called directly over `httpx` from `ai-service` | Anthropic has no embeddings API and recommends Voyage as its embeddings partner — confirmed the real endpoint (a fake key gets a genuine 401, not a network failure) before adopting it. Gated by an optional `VOYAGE_API_KEY`, mirroring `ANTHROPIC_API_KEY` exactly. Documented choice in `docs/RETRIEVAL_PHASE_PLAN.md` |
| Vector storage & ranking | Plain PostgreSQL `Float[]` columns; cosine similarity computed in the Node API | No new datastore, no pgvector extension/image change, no raw SQL — this project's per-project chunk-count scale doesn't need ANN indexing. Documented choice (and the pgvector/external-vector-DB/local-index alternatives it was weighed against) in `docs/RETRIEVAL_PHASE_PLAN.md` |
| Codebase Q&A | Anthropic Claude (`claude-opus-5`) structured output, gated by the same `ANTHROPIC_API_KEY` as every other generation agent — reused, not duplicated | The structured answer schema has no field for a model-supplied file path, symbol, or line number — only a numeric selection from the fixed, real source list Node already built from Phase 8 retrieval, making citation hallucination structurally impossible rather than merely prompt-discouraged. Documented in `docs/QA_PHASE_PLAN.md` |
| AI code review | Anthropic Claude (`claude-opus-5`) structured output, gated by the same `ANTHROPIC_API_KEY`, reusing Phase 8 retrieval and Phase 9's `selectSources()` evidence cap unchanged | Same citation-safety schema as Q&A applied to a list of findings instead of one answer — each finding can only cite numbered sources by number, never a path/symbol/line, and a finding left with zero valid citations is dropped entirely. Documented in `docs/CODE_REVIEW_PHASE_PLAN.md` |
| Local/dev orchestration | Docker Compose | Postgres, API, frontend, ai-service, each with a healthcheck |

## Repository structure

```
devforge/
  frontend/       React + TypeScript client
  api/             Node/Express application API + Prisma schema/migrations
  ai-service/      Python/FastAPI AI service (requirements analysis + PRD generation +
                    architecture generation + epic/task generation + codebase Q&A — see
                    ai-service/app/agents/qa/ — + AI code review — see
                    ai-service/app/agents/review/ — + tree-sitter source parsing — see
                    ai-service/app/parsing/ — + Voyage AI embedding generation — see
                    ai-service/app/agents/embeddings/)
  tests/           Cross-cutting integration tests (real HTTP, not in-process)
  evaluation/       Review evaluation — empty; no automated eval harness exists yet for
                    AI code review's finding quality, only the deterministic/mocked test
                    coverage described under "Tests" below
  docs/            FOUNDATION_PROGRESS.md, REQUIREMENTS_PHASE_PLAN.md,
                    REQUIREMENTS_PHASE_PROGRESS.md, PRD_PHASE_PLAN.md, PRD_PHASE_PROGRESS.md,
                    ARCHITECTURE_PHASE_PLAN.md, ARCHITECTURE_PHASE_PROGRESS.md,
                    EPICS_TASKS_PHASE_PLAN.md, EPICS_TASKS_PHASE_PROGRESS.md,
                    GITHUB_INTEGRATION_PHASE_PLAN.md, GITHUB_INTEGRATION_PHASE_PROGRESS.md,
                    CODEBASE_INDEX_PHASE_PLAN.md, CODEBASE_INDEX_PHASE_PROGRESS.md,
                    RETRIEVAL_PHASE_PLAN.md, RETRIEVAL_PHASE_PROGRESS.md, QA_PHASE_PLAN.md,
                    QA_PHASE_PROGRESS.md, CODE_REVIEW_PHASE_PLAN.md,
                    CODE_REVIEW_PHASE_PROGRESS.md — the verified milestone-by-milestone log
                    for each phase
  scripts/         Local dev/setup scripts (test-database bootstrap)
  docker-compose.yml
```

## Setup

### Prerequisites

- Node.js >= 20, [pnpm](https://pnpm.io) 10.16.1 (pinned via `packageManager` in
  `package.json` — `corepack enable` picks it up automatically)
- Docker (for Postgres locally, or the full stack)
- Python 3.12 (only if running `ai-service` outside Docker)
- An Anthropic API key, **optional** — only needed to make requirements analysis, PRD
  generation, architecture generation, epic/task generation, codebase Q&A, and AI code review
  actually return content instead of a clear "not configured" error. Get one at
  [console.anthropic.com](https://console.anthropic.com).
- A GitHub personal access token, **optional** — only needed if you want to actually connect a
  repository; generate one at [github.com/settings/tokens](https://github.com/settings/tokens)
  with read access to the repository you want to connect. You paste it into DevForge's UI when
  connecting — it is never read from an environment variable.
- A Voyage AI API key, **optional** — only needed to make code search (and, transitively,
  codebase Q&A and AI code review, which both retrieve through the same search) actually embed
  and rank chunks instead of returning a clear "not configured" error. Get one at
  [voyageai.com](https://www.voyageai.com).

### Environment variables

Copy `.env.example` to `api/.env` and `frontend/.env` (see the file for which lines go
where) and fill in real values. Never commit a real `.env` file.

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | `api/.env` | Postgres connection string |
| `SESSION_SECRET` | `api/.env` | Session-token hashing / general server secret (32+ chars) |
| `PORT` | `api/.env` | API port (default 4000) |
| `FRONTEND_ORIGIN` | `api/.env` | Allowed CORS origin for credentialed requests |
| `AI_SERVICE_URL` | `api/.env` | Base URL of the ai-service (default `http://localhost:8001`) |
| `VITE_API_URL` | `frontend/.env` | API base URL the browser calls (baked in at build time) |
| `ANTHROPIC_API_KEY` | `ai-service` environment (shell env, or Docker Compose's own env — not a committed file) | Enables real requirements analysis, PRD generation, architecture generation, epic/task generation, codebase Q&A, and AI code review. Unset → every analyze/generate/ask/review request returns a clear 503, never fake content |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | `api/.env` (or shell env — not a committed file) | A base64-encoded 32-byte key used to encrypt (AES-256-GCM) a connected repository's personal access token at rest. **Optional** — the API still starts and every other feature still works with this unset; only connecting a repository is gated. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Unset → connecting returns a clear 503 `GITHUB_INTEGRATION_NOT_CONFIGURED`, never a fake connection |
| `VOYAGE_API_KEY` | `ai-service` environment (shell env, or Docker Compose's own env — not a committed file) | Enables real embedding generation for code search. **Optional** — the ai-service still starts and every other feature still works with this unset; only `POST /embeddings/generate` (and, transitively, code search) is gated. Unset → a clear 503 `PROVIDER_NOT_CONFIGURED`, never a fabricated vector |

### Local development (without Docker)

```bash
pnpm install

# Postgres only, via Docker (mapped to host port 5433 — see docker-compose.yml
# for why not 5432)
docker compose up -d postgres

cd api
cp ../.env.example .env   # then edit DATABASE_URL/SESSION_SECRET as needed
pnpm exec prisma migrate dev
pnpm dev                  # http://localhost:4000

# in another terminal
cd frontend
echo "VITE_API_URL=http://localhost:4000" > .env
pnpm dev                  # http://localhost:5173

# in another terminal — ai-service
cd ai-service
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
export ANTHROPIC_API_KEY=sk-ant-...   # optional; omit to see the honest "not configured" path
.venv/bin/uvicorn main:app --port 8001
```

### Full stack via Docker Compose (clean-environment verification)

```bash
# optional: pass real keys through to the ai-service container
ANTHROPIC_API_KEY=sk-ant-... VOYAGE_API_KEY=pa-... docker compose up -d --build
```

This builds and runs all four services — Postgres, ai-service, the API (which runs `prisma
migrate deploy` automatically on container start and depends on both Postgres and ai-service
being healthy), and the frontend (built and served as a static production bundle) — each
gated by a healthcheck so dependents wait for their dependencies to actually be ready, not
just started. Verified end to end from a volume-wiped clean start (`docker compose down -v
&& docker compose up -d --build`), including the api-container → ai-service-container network
call over the Docker-internal hostname for requirements analysis, PRD generation, architecture
generation, epic/task generation, codebase Q&A, AI code review, source parsing (confirmed `pip
install` really did pull prebuilt `tree-sitter` wheels into the container — no compiler
needed), and embedding generation (confirmed `httpx` installed cleanly alongside them), and
(separately) the api-container's own outbound calls to the real GitHub REST API for repository
connections, codebase indexing, and code search — the API container starts and stays healthy
whether or not `GITHUB_TOKEN_ENCRYPTION_KEY`/`VOYAGE_API_KEY`/`ANTHROPIC_API_KEY` are set:

| Service | URL | Health |
|---|---|---|
| Frontend | http://localhost:4173 | `GET /` → 200 |
| API | http://localhost:4000 | `GET /health` → `{"data":{"status":"ok"}}` |
| AI service | http://localhost:8001 | `GET /health` → `{"status":"ok"}` |
| Postgres | localhost:5433 | `pg_isready` |

### Tests

The api unit tests use a dedicated `devforge_test` database — create it once (and again
after any `docker compose down -v`):

```bash
./scripts/setup-test-db.sh
```

Then:

```bash
pnpm test                          # api + frontend unit/component tests (Vitest)
pnpm test:integration              # tests/ — real HTTP against running api + ai-service
cd ai-service && .venv/bin/python -m pytest tests/ -v   # ai-service unit tests
pnpm typecheck
pnpm lint
```

No test in this repository claims a real LLM call succeeded unless a real, configured
`ANTHROPIC_API_KEY` was actually used for that run, no test claims a repository was actually
connected or indexed unless real, valid, user-supplied GitHub credentials were used, no test
claims a real semantic search succeeded unless a real, configured `VOYAGE_API_KEY` was
actually used, and no test claims a real codebase Q&A answer or AI code review finding was
generated by a real Claude call unless a real, configured `ANTHROPIC_API_KEY` was actually used
for that run (none of these was, anywhere in this repository's test suite) — see
[docs/REQUIREMENTS_PHASE_PROGRESS.md](docs/REQUIREMENTS_PHASE_PROGRESS.md),
[docs/PRD_PHASE_PROGRESS.md](docs/PRD_PHASE_PROGRESS.md),
[docs/ARCHITECTURE_PHASE_PROGRESS.md](docs/ARCHITECTURE_PHASE_PROGRESS.md),
[docs/EPICS_TASKS_PHASE_PROGRESS.md](docs/EPICS_TASKS_PHASE_PROGRESS.md),
[docs/GITHUB_INTEGRATION_PHASE_PROGRESS.md](docs/GITHUB_INTEGRATION_PHASE_PROGRESS.md),
[docs/CODEBASE_INDEX_PHASE_PROGRESS.md](docs/CODEBASE_INDEX_PHASE_PROGRESS.md),
[docs/RETRIEVAL_PHASE_PROGRESS.md](docs/RETRIEVAL_PHASE_PROGRESS.md),
[docs/QA_PHASE_PROGRESS.md](docs/QA_PHASE_PROGRESS.md), and
[docs/CODE_REVIEW_PHASE_PROGRESS.md](docs/CODE_REVIEW_PHASE_PROGRESS.md) for exactly which
tests use a test double and which exercise a real "not configured"/real-API failure path.

## API summary

All responses use `{ data: ... }` on success or `{ error: { code, message, details? } }` on
failure.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | — | Create an account, start a session |
| POST | `/auth/login` | — | Start a session |
| POST | `/auth/logout` | session | End the current session |
| GET | `/auth/me` | session | Current user |
| POST | `/projects` | session | Create a project (owner = caller) |
| GET | `/projects` | session | List the caller's own projects |
| GET | `/projects/:id` | session | Get a project (404 if missing or not owned) |
| POST | `/projects/:id/requirements/analyze` | session | Analyze an idea into a new, active requirements version |
| GET | `/projects/:id/requirements` | session | List requirements versions, newest first |
| GET | `/projects/:id/requirements/:versionId` | session | Get one version |
| PATCH | `/projects/:id/requirements/:versionId` | session | Update a version's content in place |
| POST | `/projects/:id/requirements/:versionId/activate` | session | Make a version the active one |
| GET | `/projects/:id/requirements/compare?a=&b=` | session | Structural diff between two versions |
| POST | `/projects/:id/prd/generate` | session | Generate a new, active PRD version from the project's active requirements version (400 `NO_ACTIVE_REQUIREMENTS` if none exists) |
| GET | `/projects/:id/prd` | session | List PRD versions, newest first |
| GET | `/projects/:id/prd/:versionId` | session | Get one PRD version |
| PATCH | `/projects/:id/prd/:versionId` | session | Update a PRD version's content in place |
| POST | `/projects/:id/prd/:versionId/activate` | session | Make a PRD version the active one |
| GET | `/projects/:id/prd/compare?a=&b=` | session | Structural diff between two PRD versions |
| POST | `/projects/:id/architecture/generate` | session | Generate a new, active architecture version from the project's active PRD version (400 `NO_ACTIVE_PRD` if none exists) |
| GET | `/projects/:id/architecture` | session | List architecture versions, newest first |
| GET | `/projects/:id/architecture/:versionId` | session | Get one architecture version |
| PATCH | `/projects/:id/architecture/:versionId` | session | Update an architecture version's content in place |
| POST | `/projects/:id/architecture/:versionId/activate` | session | Make an architecture version the active one |
| GET | `/projects/:id/architecture/compare?a=&b=` | session | Structural diff between two architecture versions |
| POST | `/projects/:id/epics/generate` | session | Generate a new, active epic version from the project's active architecture version (400 `NO_ACTIVE_ARCHITECTURE` if none exists) |
| GET | `/projects/:id/epics` | session | List epic versions, newest first |
| GET | `/projects/:id/epics/:versionId` | session | Get one epic version |
| PATCH | `/projects/:id/epics/:versionId` | session | Update an epic version's content in place |
| POST | `/projects/:id/epics/:versionId/activate` | session | Make an epic version the active one |
| GET | `/projects/:id/epics/compare?a=&b=` | session | Id-matched diff between two epic versions |
| POST | `/projects/:id/tasks/generate` | session | Generate a new, active task version from the project's active epic version (400 `NO_ACTIVE_EPICS` if none exists) |
| GET | `/projects/:id/tasks` | session | List task versions, newest first |
| GET | `/projects/:id/tasks/:versionId` | session | Get one task version |
| PATCH | `/projects/:id/tasks/:versionId` | session | Update a task version's content in place |
| POST | `/projects/:id/tasks/:versionId/activate` | session | Make a task version the active one |
| GET | `/projects/:id/tasks/compare?a=&b=` | session | Id-matched diff between two task versions |
| POST | `/projects/:id/repository/connect` | session | Connect (or reconnect) a repository — body `{ token, owner, repo }`; verified against the real GitHub API before saving (503 `GITHUB_INTEGRATION_NOT_CONFIGURED` if no encryption key is set) |
| GET | `/projects/:id/repository` | session | View the current connection (sanitized — never the token), or `{ connection: null }` if none |
| POST | `/projects/:id/repository/verify` | session | Re-verify access against the stored token; 404 if nothing connected |
| GET | `/projects/:id/repository/branches` | session | List live branches from GitHub; 404 if nothing connected |
| PATCH | `/projects/:id/repository` | session | Update the selected branch — body `{ branch }`; validated against the live branch list (400 `GITHUB_INVALID_BRANCH` if it doesn't exist) |
| DELETE | `/projects/:id/repository` | session | Disconnect; 404 if nothing connected |
| POST | `/projects/:id/codebase-index/start` | session | Start indexing the connected repository's selected branch; reuses the existing index if the commit is unchanged and already completed (400 `NO_REPOSITORY_CONNECTED` if nothing is connected, 503 `GITHUB_INTEGRATION_NOT_CONFIGURED` if unconfigured) |
| GET | `/projects/:id/codebase-index` | session | View the current index's status/summary, or `{ index: null }` if never started |
| GET | `/projects/:id/codebase-index/files` | session | List indexed files (path, language, parse status, size); 404 `CODEBASE_INDEX_NOT_FOUND` if no index exists yet |
| GET | `/projects/:id/codebase-index/files/:fileId/symbols` | session | List a file's extracted symbols, nested via `parentId` |
| POST | `/projects/:id/codebase-index/reindex` | session | Always re-runs indexing, even if the commit is unchanged |
| POST | `/projects/:id/search` | session | Semantic search — body `{ query, branch?, commit?, limit? }`; lazily chunks/embeds the current completed index on first use, reused on every later search against the same commit (400 `NO_COMPLETED_INDEX` if no repository/index, 400 `INDEX_COMMIT_MISMATCH` if `branch`/`commit` don't match the current index, 503 `GITHUB_INTEGRATION_NOT_CONFIGURED`/`EMBEDDING_PROVIDER_UNAVAILABLE` if unconfigured) |
| POST | `/projects/:id/qa` | session | Ask a question — body `{ question }` (1–2000 chars); retrieves via `/search` first (400 `NO_COMPLETED_INDEX` if no repository/completed index), then answers with Claude grounded only in the retrieved evidence (503 `AI_PROVIDER_UNAVAILABLE`/`EMBEDDING_PROVIDER_UNAVAILABLE`/`GITHUB_INTEGRATION_NOT_CONFIGURED` if unconfigured; a genuinely empty evidence set returns a real "insufficient evidence" answer with no Claude call at all) |
| GET | `/projects/:id/qa` | session | List past questions for this project, newest first, each with its answer and evidence |
| GET | `/projects/:id/qa/:questionId` | session | Get one question with its full answer and evidence; 404 if it doesn't belong to this project |
| POST | `/projects/:id/reviews` | session | Run a code review — body `{ scope? }` (optional, 1–2000 chars; a fixed default scope is used when omitted); retrieves via `/search` first (400 `NO_COMPLETED_INDEX` if no repository/completed index), then reviews with Claude grounded only in the retrieved evidence (503 `AI_PROVIDER_UNAVAILABLE`/`EMBEDDING_PROVIDER_UNAVAILABLE`/`GITHUB_INTEGRATION_NOT_CONFIGURED` if unconfigured; a genuinely empty evidence set returns a real "no relevant code found" review with zero findings and no Claude call at all; a genuine provider failure after evidence exists leaves the review row `status: "failed"`, never orphaned) |
| GET | `/projects/:id/reviews` | session | List past reviews for this project, newest first, each with its findings and evidence |
| GET | `/projects/:id/reviews/:reviewId` | session | Get one review with its full findings and evidence; 404 if it doesn't belong to this project |

`ai-service` also exposes `POST /requirements/analyze`, `POST /prd/generate`,
`POST /architecture/generate`, `POST /epics/generate`, `POST /tasks/generate`,
`POST /parsing/parse`, `POST /embeddings/generate`, `POST /qa/answer`, and
`POST /review/analyze` directly (called by the Node API, not the browser) and `GET /health`.
The repository, codebase-index, search, Q&A, and review endpoints above never call
`ai-service` for GitHub access — the Node API talks to the real GitHub REST API directly, and
separately sends each fetched file's content to `ai-service`'s parser, each resulting chunk's
text to `ai-service`'s embedding endpoint, and — for both Q&A and code review — the question or
scope plus a fixed, numbered list of the top-ranked retrieved chunks to `ai-service`'s Q&A or
review endpoint respectively.

## Database schema

`users` (id, email, password_hash, name, timestamps) — `sessions` (id, user_id → users,
token_hash, expires_at) — `projects` (id, owner_id → users, name, description, status,
timestamps) — `requirements_versions` (id, project_id → projects, version, idea_text, content
`jsonb`, is_active, timestamps; unique on `(project_id, version)`) — `prd_versions` (id,
project_id → projects `ON DELETE CASCADE`, version, source_requirements_version_id →
requirements_versions `ON DELETE RESTRICT`, content `jsonb`, is_active, timestamps; unique on
`(project_id, version)`) — `architecture_versions` (id, project_id → projects `ON DELETE
CASCADE`, version, source_prd_version_id → prd_versions `ON DELETE RESTRICT`, content `jsonb`,
is_active, timestamps; unique on `(project_id, version)`) — `epic_versions` (id, project_id →
projects `ON DELETE CASCADE`, version, source_architecture_version_id → architecture_versions
`ON DELETE RESTRICT`, content `jsonb` — `{ epics: EpicItem[] }`, is_active, timestamps; unique
on `(project_id, version)`) — `task_versions` (id, project_id → projects `ON DELETE CASCADE`,
version, source_epic_version_id → epic_versions `ON DELETE RESTRICT`, content `jsonb` —
`{ tasks: TaskItem[] }`, is_active, timestamps; unique on `(project_id, version)`) —
`repository_connections` (id, project_id → projects `ON DELETE CASCADE`, **unique on
`project_id` alone** — github_owner, github_repo, github_repo_id, github_account_login,
repository_url, default_branch, selected_branch, status (`pending`/`verified`/`error`),
last_verified_at, last_error, encrypted_token, token_last_4, timestamps). Unlike
requirements/PRD/architecture, whose `content` is one document of prose/list sections, epic
and task content is a **list of id-bearing items** (mirroring `RequirementItem[]`), diffed and
edited per-item rather than per-field. `repository_connections` is different again: a single
row per project (not a versioned artifact at all — connecting again replaces the row instead
of adding a new version), because a GitHub connection is state, not generated content worth a
history — see `docs/GITHUB_INTEGRATION_PHASE_PLAN.md` for the full reasoning.
`encrypted_token` is AES-256-GCM ciphertext, never the plaintext PAT; `token_last_4` is the
only token-derived value ever returned by the API. `codebase_indexes` (id, project_id →
projects `ON DELETE CASCADE`, **unique on `project_id` alone**, repository_connection_id →
repository_connections `ON DELETE RESTRICT`, branch, commit_sha, status
(`pending`/`indexing`/`completed`/`failed`), truncated, file_count, parsed_file_count,
failed_file_count, started_at, completed_at, error, timestamps) — same single-row-per-project
shape as `repository_connections`, not a versioned artifact: reindexing replaces the row's
files/symbols wholesale rather than adding a new version. `indexed_files` (id, index_id →
codebase_indexes `ON DELETE CASCADE`, path, language, size_bytes, content_hash, parse_status
(`parsed`/`unsupported`/`parse_error`/`skipped_binary`/`skipped_too_large`/
`skipped_index_limit`), parse_error, created_at; unique on `(index_id, path)`) — one row per
file *considered* during an index run, not just successfully parsed ones, so a skip is always a
real, visible reason rather than a silently dropped file; `content_hash` reuses the git blob
SHA GitHub's own tree API already computes rather than hashing fetched bytes again, and no
source file content is ever stored. `symbols` (id, file_id → indexed_files `ON DELETE CASCADE`,
name, type, start_line, end_line, parent_id → symbols `ON DELETE SET NULL` (self-referencing,
for nested symbols), signature) — `type`/`signature` are plain strings rather than enums since
the set of symbol kinds already spans three unrelated language grammars and is meant to grow.
`code_chunks` (id, project_id → projects `ON DELETE CASCADE`, codebase_index_id →
codebase_indexes `ON DELETE CASCADE`, file_id → indexed_files `ON DELETE CASCADE`, symbol_id →
symbols `ON DELETE CASCADE` (nullable — null for a whole-file fallback chunk), branch,
commit_sha, chunk_index, content, content_hash, language, start_line, end_line, created_at;
**unique on `(codebase_index_id, commit_sha, content_hash)`** — the real chunk-dedup key, since
a nullable `symbol_id` can't reliably be one in a Postgres unique index) — one row per code
chunk derived from a Phase 7 parsed file/symbol, produced by pure string-slicing in the Node
API (see `api/src/lib/chunking.ts`), not stored redundantly across reindexes: a Phase 7
reindex's wholesale `indexed_files` replacement cascades away any chunks tied to the
superseded commit. `embeddings` (id, chunk_id → code_chunks `ON DELETE CASCADE`, model,
dimensions, vector `Float[]`, created_at; **unique on `(chunk_id, model)`**) — one row per
(chunk, embedding model) pair; `vector` is a plain PostgreSQL array, not pgvector — similarity
ranking is computed in the Node API, not the database (see "Tech stack" above for why).
`questions` (id, project_id → projects `ON DELETE CASCADE`, codebase_index_id →
codebase_indexes `ON DELETE CASCADE`, question, branch, commit_sha, created_at) — one row per
question asked, denormalizing branch/commit like `code_chunks` already does; not a
conversation/chat thread — each question is answered independently, grounded fresh against
whatever the project's current index is at ask time. `answers` (id, question_id → questions
`ON DELETE CASCADE`, **unique on `question_id`** — one answer per question, answer,
insufficient_evidence, model, created_at) — `model` is `"none"` when `insufficient_evidence`
is true, since no Claude call happens for a genuinely empty evidence set. `answer_sources` (id,
answer_id → answers `ON DELETE CASCADE`, chunk_id → code_chunks `ON DELETE CASCADE`,
**unique on `(answer_id, chunk_id)`**, source_order, cited, score) — one row per source chunk
actually sent as evidence, not just the ones the model cited (`cited` records that separately);
references `code_chunks` directly rather than duplicating its path/lines/content, so a Phase 8
reindex's cascade deletion of superseded chunks correctly removes old Q&A evidence detail too,
while the parent answer's own text and `insufficient_evidence` flag survive (a known
limitation: old Q&A history's evidence detail doesn't survive a reindex, only its answer text
does). Never a file path, symbol name, or line number the model itself produced — see
`docs/QA_PHASE_PLAN.md` for the citation-safety design this split makes possible.
`code_reviews` (id, project_id → projects `ON DELETE CASCADE`, codebase_index_id →
codebase_indexes `ON DELETE CASCADE`, scope, branch, commit_sha, status
(`pending`/`completed`/`failed`), summary, finding_count, model, error, created_at,
completed_at) — one row per review run, same append-only "one row per request" shape as
`questions`, not a versioned artifact; unlike `questions`/`answers`, the row is persisted with
`status: "pending"` as soon as retrieved evidence exists, *before* the provider call, so a
genuine provider-side failure updates that same row to `status: "failed"` rather than leaving
an orphaned one (a deliberate improvement over the `questions`/`answers` split — see
`docs/CODE_REVIEW_PHASE_PLAN.md`). `code_review_sources` (id, review_id → code_reviews `ON
DELETE CASCADE`, chunk_id → code_chunks `ON DELETE CASCADE`, **unique on `(review_id,
chunk_id)`**, source_order, score) — the review's full shared evidence set, every source
actually sent to the provider, not just the ones a finding ends up citing; owned by the review
itself rather than by any one finding, since Phase 9's `answer_sources` (one answer, its own
private evidence) doesn't fit a review with many findings sharing one evidence set.
`code_review_findings` (id, review_id → code_reviews `ON DELETE CASCADE`, title, description,
severity (`critical`/`high`/`medium`/`low`/`info`), category (`bug`/`security`/`reliability`/
`performance`/`maintainability`/`validation`/`error_handling`/`testing`/`architecture`/
`other`), confidence (`high`/`medium`/`low`), recommendation, actionable, created_at) — never a
file path, symbol name, or line number the model itself produced, same citation-safety
guarantee as `answers`; severity/category/confidence are Postgres enums, not free strings, so
an invalid value is a structured-output parse failure in `ai-service`, never a value that
reaches this table. `code_review_finding_sources` (id, finding_id → code_review_findings `ON
DELETE CASCADE`, source_id → code_review_sources `ON DELETE CASCADE`, **unique on
`(finding_id, source_id)`**) — the many-to-many join recording which of the review's shared
sources each finding actually cites; a finding left with zero rows here after citation
filtering is never persisted at all. See `api/prisma/schema.prisma` for the exact fields.

## Known limitations

- **Codebase Q&A and AI code review are both read-only.** Neither ever modifies code, opens a
  pull request, creates a GitHub issue, runs a GitHub Action, executes a command, or takes any
  other action on the repository — code review may *recommend* a change in a finding's
  `recommendation` text, but it never applies one. Both only read already-indexed evidence and
  return a grounded result. Neither can answer or review anything outside what Phase 8
  retrieval actually finds and passes it — neither has any ability to browse the repository on
  its own, follow a reference to a file that wasn't retrieved, or run code.
- Codebase Q&A is not a conversation — each question is answered independently. Likewise, AI
  code review is not iterative — each review run is independent, with no memory of a prior
  review's findings. There is no multi-turn context in either: DevForge does not remember an
  earlier question/review when handling a later one, even within the same visible history list.
  A "follow-up question" or "run another review" is simply another independent request.
- Codebase indexing, code search, codebase Q&A, and AI code review all run synchronously within
  one HTTP request — there is no background job queue anywhere in this codebase. Indexing is
  bounded by a 500-file cap and a 300 KB per-file cap; files beyond a cap are recorded with a
  real `skipped_index_limit`/`skipped_too_large` status rather than silently dropped. Both Q&A
  and code review are bounded to at most 8 evidence sources and 16,000 combined characters of
  code context (after deduplicating overlapping evidence, via the same shared
  `qaSourceSelection.ts` cap), so a very broad question or review scope may not surface every
  relevant location — only the highest-scored, non-overlapping ones within that budget. A
  background worker is the natural fix for all of this and is future work.
- Both Q&A answers and code reviews are pinned to exactly one `(branch, commitSha)` per
  project — the same one `/search` and indexing already use — with no way to ask/review a
  different branch or commit; there is no caller-supplied override at all on `POST /qa` or
  `POST /reviews` (unlike `/search`'s validation-only `branch`/`commit` fields).
- Disconnecting a repository, or reindexing to a new commit, does not preserve old Q&A answers'
  or code reviews' detailed evidence (their underlying `code_chunks` rows are cascade-deleted,
  which cascades to `answer_sources`/`code_review_sources` and `code_review_finding_sources`) —
  the answer's own text (and "insufficient evidence" flag) or the review's own summary and each
  finding's title/description/severity/category/confidence/recommendation text remain, but the
  specific file/line citations behind them do not.
- AI code review's false-positive controls (preferring "potential issue" language under
  uncertainty, never reporting a generic style preference as a defect, returning an empty
  findings list when nothing is supported) are prompt-level instructions, not a separate
  verification pass — nothing re-checks a finding's claim against the source a second time
  before persisting it, only that its citation is real. A finding can still be a genuine
  false positive even though its evidence citation is guaranteed genuine.
- Only three languages are parsed and therefore searchable — Python, TypeScript, JavaScript.
  Every other extension is recorded as `unsupported` during indexing and never chunked.
- Symbol extraction covers class/interface/type_alias/function/method declarations only, not
  every AST node (e.g. not import statements, decorators as standalone symbols, or
  object-literal methods) — search results are bounded by the same coverage.
- Disconnecting a repository does not cascade-delete its codebase index (or its chunks/
  embeddings) — they're independent rows once created. Deciding whether a disconnect should
  also clear them is a product decision left for later, not addressed yet.
- No automatic re-verification of GitHub access happens before indexing or before a first
  search's chunk-building step; a token that was valid at last verification but has since been
  revoked surfaces as a real `GITHUB_INVALID_CREDENTIALS` failure from that call itself, the
  same way it would from any other GitHub-calling endpoint.
- Vector search is a linear scan over plain PostgreSQL `Float[]` columns (cosine similarity
  computed in the Node API), not an approximate-nearest-neighbor index — reasonable at this
  project's per-project chunk-count scale, but would not scale to a very large monorepo's full
  chunk set. pgvector (or another ANN-backed store) is the natural upgrade path and is future
  work, not this phase.
- Search covers exactly one `(branch, commitSha)` per project — the `CodebaseIndex`'s current
  state, not a searchable history of past commits; requesting a different branch/commit is a
  real, honest mismatch error, not silently ignored or silently redirected to the current one.
- The first search after an index completes (or after a reindex to a new commit) pays a real
  chunking-and-embedding cost synchronously, within that one HTTP request — the slowest search
  request a user will see; every later search against the same commit reuses the persisted
  result and is fast.
- GitHub authentication supports only a user-supplied personal access token — not OAuth and
  not a GitHub App installation. Both were evaluated and rejected for this phase: OAuth needs
  a registered OAuth App (Client ID/Secret) and a reachable public callback URL; a GitHub App
  needs an even heavier manifest/private-key/webhook setup. Neither is available in this
  environment, and a PAT is the smallest option that still lets DevForge never invent or
  assume a credential exists. Documented in `docs/GITHUB_INTEGRATION_PHASE_PLAN.md`.
- `dependencies`/`epicId`/`relatedComponent(s)` on epics/tasks aside, the repository
  connection's own cross-references are likewise unvalidated beyond what GitHub itself
  confirms: `githubRepoId`/`githubAccountLogin`/`defaultBranch` are trusted as reported by the
  GitHub API at verification time and not re-checked against any other source.
- No webhook, polling, or automatic re-verification of a connection — verification only
  happens on an explicit user action (connect, or "Reverify access").
- Requirements analysis, PRD generation, architecture generation, epic generation, task
  generation, codebase Q&A, and AI code review each support one LLM provider (Anthropic). Each
  has its own provider abstraction
  (`ai-service/app/agents/{requirements,prd,architecture,epics,tasks,qa,review}/provider.py`),
  sharing only the genuinely identical piece — the `ANTHROPIC_API_KEY` read and
  `ProviderNotConfiguredError` raise, in `ai-service/app/lib/provider_config.py` — so a second
  provider could be added without touching any router, but no second provider is implemented.
- Editing a requirements version's functional/non-functional requirement items (individual
  fields within each requirement) isn't exposed in the UI — only the top-level summary and
  the plain string lists (users/constraints/assumptions/open questions) are editable. The API
  itself accepts a full content replace via PATCH, so this is a frontend scope choice, not an
  API limitation. (PRD and architecture content have no such gap — every field is a plain
  string or string list, and all of them are editable in the UI.)
- Epic and task content is a list of items rather than a document, and the UI supports
  editing every field of every existing item, but does not support adding or removing items —
  structural changes (a new epic, a removed task) happen by regenerating a new version. The
  API itself accepts any array via PATCH, so this is also a frontend scope choice, not an API
  limitation.
- `dependencies`, `epicId`, and `relatedComponent(s)` on epics/tasks are plain strings, not
  validated against the actual ids/components that exist elsewhere in the project — the AI
  provider is prompted to stay grounded (e.g. only using an `epicId` from the epics it was
  actually given), but nothing at the schema or API layer enforces it.
- All five compare endpoints return a deliberately simple structural diff — added/removed/
  changed for requirements, epics, and tasks (id-matched); added/removed for PRD's and
  architecture's plain string-list fields, plus a changed flag for each's prose fields — not a
  semantic diff.
- A section that has already fetched its data on page load does not react to an upstream
  section's activation happening later in the same session — e.g. activating a different epic
  version while the Tasks section is already mounted leaves its "Generate tasks from Epics
  v{N}" label showing the previously-active version's number until the page is reloaded. This
  is a display-only lag, not a data-correctness issue: the server is always the true source of
  truth for which version is active, so a generate call always uses whichever version is
  actually active. It follows directly from each section's deliberate design (fetch
  independently on mount, no cross-component coupling) — see
  [docs/EPICS_TASKS_PHASE_PROGRESS.md](docs/EPICS_TASKS_PHASE_PROGRESS.md)'s Milestone 5 entry
  for how this was directly observed and verified.
- The frontend's dark/light theming follows OS preference (`prefers-color-scheme`); there's
  no in-app toggle yet.
- No CI pipeline is configured yet — tests are run locally as documented above.

## Future work

A background job queue for indexing, search, Q&A, and code review (removing the synchronous-
request size/file/evidence caps and the first-use latency), hybrid (BM25 + vector + RRF +
reranking) retrieval and an ANN-backed vector store (e.g. pgvector) in place of today's
linear-scan `Float[]` ranking, true multi-turn conversation for Codebase Q&A and iterative
context for AI code review (today each question/review is handled independently), an automated
eval harness for code-review finding quality (precision/recall against a labeled set, not just
today's deterministic/mocked test coverage), and support for a caller-supplied branch/commit
override on both Q&A and review requests — per the full product specification. See
[docs/FOUNDATION_PROGRESS.md](docs/FOUNDATION_PROGRESS.md),
[docs/REQUIREMENTS_PHASE_PROGRESS.md](docs/REQUIREMENTS_PHASE_PROGRESS.md),
[docs/PRD_PHASE_PROGRESS.md](docs/PRD_PHASE_PROGRESS.md),
[docs/ARCHITECTURE_PHASE_PROGRESS.md](docs/ARCHITECTURE_PHASE_PROGRESS.md),
[docs/EPICS_TASKS_PHASE_PROGRESS.md](docs/EPICS_TASKS_PHASE_PROGRESS.md),
[docs/GITHUB_INTEGRATION_PHASE_PROGRESS.md](docs/GITHUB_INTEGRATION_PHASE_PROGRESS.md),
[docs/CODEBASE_INDEX_PHASE_PROGRESS.md](docs/CODEBASE_INDEX_PHASE_PROGRESS.md),
[docs/RETRIEVAL_PHASE_PROGRESS.md](docs/RETRIEVAL_PHASE_PROGRESS.md),
[docs/QA_PHASE_PROGRESS.md](docs/QA_PHASE_PROGRESS.md), and
[docs/CODE_REVIEW_PHASE_PROGRESS.md](docs/CODE_REVIEW_PHASE_PROGRESS.md) for what's been
verified so far and how it was verified.

## License

Not yet decided for this repository.
