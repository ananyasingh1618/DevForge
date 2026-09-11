# DevForge

AI Software Engineering & Codebase Intelligence Platform.

> **Current status: Foundation phase complete.** This repository implements authentication
> and a project workspace, end to end, with tests and a working Docker Compose stack.
> Requirements analysis, PRD generation, architecture generation, GitHub integration,
> AST-aware indexing, hybrid retrieval, codebase Q&A, and AI code review are part of the full
> product specification but are **not yet implemented** — nothing in this repository
> simulates or fakes those capabilities. See [docs/FOUNDATION_PROGRESS.md](docs/FOUNDATION_PROGRESS.md)
> for the detailed, verified log of every milestone that built this phase.

## Overview

DevForge is planned as an AI-assisted software engineering workspace: turn an idea into
structured requirements and architecture, connect a GitHub repository, and get grounded,
cited answers and AI-assisted code review against that real codebase. This phase builds the
foundation everything else attaches to: a user can register, log in, and manage a project
workspace, with server-side ownership enforced on every request.

## What works today

- Register, log in, log out, and check the current session (`/auth/*`).
- Create, list, and view projects, scoped to the authenticated owner — a project that
  doesn't exist and a project owned by someone else are both a 404, never a 403 or leaked
  data.
- A project overview page that shows real project data and honestly labels every planned
  capability (Requirements, PRD, Architecture, Tasks, Repository, Codebase Q&A, Reviews) as
  **Not yet implemented** rather than presenting a stub as working.
- Opaque, server-side sessions: a random token lives only in an httpOnly cookie; only its
  SHA-256 hash is ever persisted.
- The full stack (Postgres, API, frontend, and an inert AI-service stub) runs via a single
  `docker compose up` from a clean checkout, migrations included.

## Architecture

```
React + TypeScript (Vite)                 Python/FastAPI AI service
        |                                    (inert stub — /health only,
        | fetch, credentials: include         no requirements/PRD/retrieval/
        v                                     review logic yet; not called
Node/Express API  ------------------------->   by the API yet)
        |
        | Prisma (driver adapter: @prisma/adapter-pg)
        v
   PostgreSQL
```

The Node API and the Python AI service are already separate processes/containers — the
architecture principle from the full spec ("keep application CRUD/orchestration separate
from AI-heavy processing") is established now, before there's AI logic to separate.

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
| Validation | Zod | Request bodies, route params, and environment variables all validated the same way |
| Testing | Vitest, Supertest, React Testing Library, Playwright (ad hoc manual verification, not yet a committed suite) | One test runner style across the TS packages |
| AI service | Python/FastAPI | Established as its own process now; inert until a real AI phase begins |
| Local/dev orchestration | Docker Compose | Postgres, API, frontend, ai-service, each with a healthcheck |

## Repository structure

```
devforge/
  frontend/       React + TypeScript client
  api/             Node/Express application API + Prisma schema/migrations
  ai-service/      Python/FastAPI AI service (inert stub — see "What works today")
  tests/           Cross-cutting integration tests (real HTTP, not in-process)
  evaluation/       Retrieval/review evaluation — empty until those phases exist
  docs/            FOUNDATION_PROGRESS.md — the verified milestone-by-milestone log
  scripts/         Local dev/setup scripts — empty for now
  docker-compose.yml
```

## Setup

### Prerequisites

- Node.js >= 20, [pnpm](https://pnpm.io) 10.16.1 (pinned via `packageManager` in
  `package.json` — `corepack enable` picks it up automatically)
- Docker (for Postgres locally, or the full stack)
- Python 3.12 (only if running `ai-service` outside Docker)

### Environment variables

Copy `.env.example` to `api/.env` and `frontend/.env` (see the file for which lines go
where) and fill in real values. Never commit a real `.env` file.

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | `api/.env` | Postgres connection string |
| `SESSION_SECRET` | `api/.env` | Session-token hashing / general server secret (32+ chars) |
| `PORT` | `api/.env` | API port (default 4000) |
| `FRONTEND_ORIGIN` | `api/.env` | Allowed CORS origin for credentialed requests |
| `VITE_API_URL` | `frontend/.env` | API base URL the browser calls (baked in at build time) |

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
```

### Full stack via Docker Compose (clean-environment verification)

```bash
docker compose up -d --build
```

This builds and runs all four services — Postgres, the API (which runs `prisma migrate
deploy` automatically on container start), the frontend (built and served as a static
production bundle), and the ai-service stub — each gated by a healthcheck so dependents wait
for their dependencies to actually be ready, not just started. Verified end to end from a
volume-wiped clean start (`docker compose down -v && docker compose up -d --build`):

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
pnpm test              # api + frontend unit/component tests (Vitest)
pnpm test:integration  # tests/ — real HTTP against a running API (start it first)
pnpm typecheck
pnpm lint
```

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

## Database schema (Foundation phase)

`users` (id, email, password_hash, name, timestamps) — `sessions` (id, user_id → users,
token_hash, expires_at) — `projects` (id, owner_id → users, name, description, status,
timestamps). See `api/prisma/schema.prisma` for the exact fields, and its header comment for
how later entities (`prd_versions`, `architecture_versions`, `epics`, `tasks`,
`repositories`, `code_chunks`, `conversations`, `reviews`, `review_findings`, `feedback`)
will attach once those phases start.

## Known limitations

- No requirements/PRD/architecture generation, GitHub integration, code indexing/retrieval,
  codebase Q&A, or code review — see "What works today" above. This is the Foundation phase
  only.
- The frontend's dark/light theming follows OS preference (`prefers-color-scheme`); there's
  no in-app toggle yet.
- No CI pipeline is configured yet — tests are run locally as documented above.
- `ai-service` performs no AI work; it exists only to establish the process boundary.

## Future work

Everything above "Known limitations" — requirements/PRD/architecture generation, GitHub
OAuth and repository ingestion, Tree-sitter AST indexing, hybrid (BM25 + vector + RRF +
reranking) retrieval, cited codebase Q&A, and the bug/security/performance/quality review
pipeline — per the full product specification. See
[docs/FOUNDATION_PROGRESS.md](docs/FOUNDATION_PROGRESS.md) for what's been verified so far
and how it was verified.

## License

Not yet decided for this repository.
