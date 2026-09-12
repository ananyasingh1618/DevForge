# DevForge

AI Software Engineering & Codebase Intelligence Platform.

> **Current status: Foundation phase + Phase 2 (Requirements Analysis) + Phase 3 (PRD
> Generation) + Phase 4 (Architecture Generation) complete.** This repository implements
> authentication, a project workspace, AI-assisted requirements analysis, AI-assisted PRD
> generation, and AI-assisted architecture generation, end to end, with tests and a working
> Docker Compose stack. GitHub integration, AST-aware indexing, hybrid retrieval, codebase
> Q&A, and AI code review are part of the full product specification but are **not yet
> implemented** — nothing in this repository simulates or fakes those capabilities. See
> [docs/FOUNDATION_PROGRESS.md](docs/FOUNDATION_PROGRESS.md),
> [docs/REQUIREMENTS_PHASE_PROGRESS.md](docs/REQUIREMENTS_PHASE_PROGRESS.md),
> [docs/PRD_PHASE_PROGRESS.md](docs/PRD_PHASE_PROGRESS.md), and
> [docs/ARCHITECTURE_PHASE_PROGRESS.md](docs/ARCHITECTURE_PHASE_PROGRESS.md) for the detailed,
> verified log of every milestone that built each phase.

## Overview

DevForge is planned as an AI-assisted software engineering workspace: turn an idea into
structured requirements, a PRD, and a technical architecture, connect a GitHub repository, and
get grounded, cited answers and AI-assisted code review against that real codebase. The
Foundation phase built what everything else attaches to (auth, project ownership); Phase 2
added the first real AI capability — turning a free-text idea into structured, versioned
requirements; Phase 3 added the second — turning a project's active requirements version into
a structured, versioned PRD; Phase 4 adds the third — turning a project's active PRD version
into a structured, versioned technical architecture.

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
- A project overview page that shows real project data and honestly labels every remaining
  planned capability (Tasks, Repository, Codebase Q&A, Reviews) as **Not yet implemented**
  rather than presenting a stub as working.
- Opaque, server-side sessions: a random token lives only in an httpOnly cookie; only its
  SHA-256 hash is ever persisted.
- The full stack (Postgres, API, frontend, and the AI service) runs via a single
  `docker compose up` from a clean checkout, migrations included.

## Architecture

```
React + TypeScript (Vite)                 Python/FastAPI AI service
        |                                    requirements analysis + PRD generation +
        | fetch, credentials: include         architecture generation (Anthropic Claude,
        v                                     claude-opus-5); retrieval/review not implemented
Node/Express API  ------------------------->
        |            fetch (AI_SERVICE_URL)
        | Prisma (driver adapter: @prisma/adapter-pg)
        v
   PostgreSQL
```

The Node API and the Python AI service are separate processes/containers — the architecture
principle from the full spec ("keep application CRUD/orchestration separate from AI-heavy
processing") holds: the Node API validates, persists, and enforces ownership; the AI service
only ever does the LLM call and returns structured, schema-validated content.

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
| AI service | Python/FastAPI | Its own process/container; requirements analysis, PRD generation, and architecture generation are implemented |
| Local/dev orchestration | Docker Compose | Postgres, API, frontend, ai-service, each with a healthcheck |

## Repository structure

```
devforge/
  frontend/       React + TypeScript client
  api/             Node/Express application API + Prisma schema/migrations
  ai-service/      Python/FastAPI AI service (requirements analysis + PRD generation +
                    architecture generation)
  tests/           Cross-cutting integration tests (real HTTP, not in-process)
  evaluation/       Retrieval/review evaluation — empty until those phases exist
  docs/            FOUNDATION_PROGRESS.md, REQUIREMENTS_PHASE_PLAN.md,
                    REQUIREMENTS_PHASE_PROGRESS.md, PRD_PHASE_PLAN.md, PRD_PHASE_PROGRESS.md,
                    ARCHITECTURE_PHASE_PLAN.md, ARCHITECTURE_PHASE_PROGRESS.md — the verified
                    milestone-by-milestone log for each phase
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
  generation, and architecture generation actually return content instead of a clear "not
  configured" error. Get one at [console.anthropic.com](https://console.anthropic.com).

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
| `ANTHROPIC_API_KEY` | `ai-service` environment (shell env, or Docker Compose's own env — not a committed file) | Enables real requirements analysis, PRD generation, and architecture generation. Unset → every analyze/generate request returns a clear 503, never fake content |

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
# optional: pass a real key through to the ai-service container
ANTHROPIC_API_KEY=sk-ant-... docker compose up -d --build
```

This builds and runs all four services — Postgres, ai-service, the API (which runs `prisma
migrate deploy` automatically on container start and depends on both Postgres and ai-service
being healthy), and the frontend (built and served as a static production bundle) — each
gated by a healthcheck so dependents wait for their dependencies to actually be ready, not
just started. Verified end to end from a volume-wiped clean start (`docker compose down -v
&& docker compose up -d --build`), including the api-container → ai-service-container network
call over the Docker-internal hostname for requirements analysis, PRD generation, and
architecture generation:

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
`ANTHROPIC_API_KEY` was actually used for that run — see
[docs/REQUIREMENTS_PHASE_PROGRESS.md](docs/REQUIREMENTS_PHASE_PROGRESS.md),
[docs/PRD_PHASE_PROGRESS.md](docs/PRD_PHASE_PROGRESS.md), and
[docs/ARCHITECTURE_PHASE_PROGRESS.md](docs/ARCHITECTURE_PHASE_PROGRESS.md) for exactly which
tests use a test double for the AI provider and which exercise the real "not configured" path.

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

`ai-service` also exposes `POST /requirements/analyze`, `POST /prd/generate`, and
`POST /architecture/generate` directly (called by the Node API, not the browser) and
`GET /health`.

## Database schema

`users` (id, email, password_hash, name, timestamps) — `sessions` (id, user_id → users,
token_hash, expires_at) — `projects` (id, owner_id → users, name, description, status,
timestamps) — `requirements_versions` (id, project_id → projects, version, idea_text, content
`jsonb`, is_active, timestamps; unique on `(project_id, version)`) — `prd_versions` (id,
project_id → projects `ON DELETE CASCADE`, version, source_requirements_version_id →
requirements_versions `ON DELETE RESTRICT`, content `jsonb`, is_active, timestamps; unique on
`(project_id, version)`) — `architecture_versions` (id, project_id → projects `ON DELETE
CASCADE`, version, source_prd_version_id → prd_versions `ON DELETE RESTRICT`, content `jsonb`,
is_active, timestamps; unique on `(project_id, version)`). See `api/prisma/schema.prisma` for
the exact fields, and its header comment for how later entities (`epics`, `tasks`,
`repositories`, `code_chunks`, `conversations`, `reviews`, `review_findings`, `feedback`) will
attach once those phases start.

## Known limitations

- No GitHub integration, code indexing/retrieval, codebase Q&A, or code review yet — see
  "What works today" above.
- Requirements analysis, PRD generation, and architecture generation each support one LLM
  provider (Anthropic). Each has its own provider abstraction
  (`ai-service/app/agents/requirements/provider.py`, `ai-service/app/agents/prd/provider.py`,
  `ai-service/app/agents/architecture/provider.py`), sharing only the genuinely identical piece
  — the `ANTHROPIC_API_KEY` read and `ProviderNotConfiguredError` raise, in
  `ai-service/app/lib/provider_config.py` — so a second provider could be added without
  touching any router, but no second provider is implemented.
- Editing a requirements version's functional/non-functional requirement items (individual
  fields within each requirement) isn't exposed in the UI — only the top-level summary and
  the plain string lists (users/constraints/assumptions/open questions) are editable. The API
  itself accepts a full content replace via PATCH, so this is a frontend scope choice, not an
  API limitation. (PRD and architecture content have no such gap — every field is a plain
  string or string list, and all of them are editable in the UI.)
- All three compare endpoints return a deliberately simple structural diff (added/removed/
  changed for requirements; added/removed for PRD's and architecture's plain string-list
  fields, plus a changed flag for each's prose fields), not a semantic one.
- The frontend's dark/light theming follows OS preference (`prefers-color-scheme`); there's
  no in-app toggle yet.
- No CI pipeline is configured yet — tests are run locally as documented above.

## Future work

Epics/tasks, GitHub OAuth and repository ingestion, Tree-sitter AST indexing, hybrid (BM25 +
vector + RRF + reranking) retrieval, cited codebase Q&A, and the bug/security/performance/
quality review pipeline — per the full product specification. See
[docs/FOUNDATION_PROGRESS.md](docs/FOUNDATION_PROGRESS.md),
[docs/REQUIREMENTS_PHASE_PROGRESS.md](docs/REQUIREMENTS_PHASE_PROGRESS.md),
[docs/PRD_PHASE_PROGRESS.md](docs/PRD_PHASE_PROGRESS.md), and
[docs/ARCHITECTURE_PHASE_PROGRESS.md](docs/ARCHITECTURE_PHASE_PROGRESS.md) for what's been
verified so far and how it was verified.

## License

Not yet decided for this repository.
