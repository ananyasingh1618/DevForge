# DevForge Foundation — Progress Checklist

This tracks the 12 foundation milestones approved in the Foundation Implementation Plan.
Scope: this is Phase 1 (Foundation) of the full DevForge specification only — auth + project
workspace. Requirements/PRD/architecture generation, GitHub integration, AST parsing,
retrieval, codebase Q&A and code review are explicitly out of scope for this phase and are
NOT implemented, scaffolded with fake behavior, or claimed as working anywhere in this repo.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [x] 1. Initialize Git and scaffold the repository
- [x] 2. Create the API and implement GET /health
- [ ] 3. Add PostgreSQL and Prisma
- [ ] 4. Add users, sessions and projects tables
- [ ] 5. Implement register, login, logout and /auth/me
- [ ] 6. Implement project creation, listing and detail retrieval
- [ ] 7. Add authentication and project ownership tests
- [ ] 8. Scaffold the React frontend and design tokens
- [ ] 9. Wire register and login pages to the real API
- [ ] 10. Wire project list, create project and project overview pages
- [ ] 11. Add the integration test for register → login → create project → list project
- [ ] 12. Add Docker Compose verification and update the README

## Approved technology decisions (locked for this phase)

- Monorepo: pnpm workspaces (frontend + api)
- Styling: Tailwind CSS + CSS-variable design tokens + Radix primitives where useful
- ORM/migrations: Prisma + PostgreSQL
- Auth: opaque server-side session tokens, httpOnly + Secure + SameSite=Lax cookie
- Session storage: only a SHA-256 hash of the token is stored in Postgres, never the raw token
- Password hashing: bcrypt, cost factor 12
- Validation: Zod for request bodies, route params, and environment variables
- Testing: Vitest, Supertest, React Testing Library
- Local/dev verification: Docker Compose (Postgres, api, frontend, ai-service stub)
- No JWT anywhere in this phase
- AI service (`ai-service/`) is a truthful, inert FastAPI scaffold with only `GET /health` —
  no requirements/PRD/retrieval/review logic, no fake responses

## Per-milestone log

Each entry below is filled in as the milestone completes: files touched, commands run and
their actual results, manual verification performed, and the commit hash.

### 1. Initialize Git and scaffold the repository
- Files: `.gitignore`, `.env.example`, `README.md`, `package.json`, `pnpm-workspace.yaml`,
  `docs/FOUNDATION_PROGRESS.md`, `evaluation/README.md`, `scripts/README.md`,
  `tests/README.md`, empty `frontend/`, `api/`, `ai-service/` directories.
- Commands run: `git init`; `git add ...`; `git commit ...`.
- Result: root commit `6eedbee` — "chore: scaffold DevForge repository structure".
- Manual verification: `git log --oneline` shows the single root commit; `git status` clean
  aside from the not-yet-populated `frontend/`, `api/`, `ai-service/` dirs (git doesn't track
  empty directories, so they'll appear in their own milestone commits).

### 2. Create the API and implement GET /health
- Files: `api/package.json`, `api/tsconfig.json`, `api/tsconfig.build.json`,
  `api/eslint.config.js`, `api/vitest.config.ts`, `api/src/env.ts`, `api/src/lib/errors.ts`,
  `api/src/app.ts`, `api/src/server.ts`, `api/src/routes/health.ts`,
  `api/src/routes/health.test.ts`.
- Dependencies installed: `express`, `dotenv`, `zod` (runtime); `typescript@5.9.3` (pinned
  down from an auto-resolved 7.0.2 to stay compatible with typescript-eslint), `tsx`,
  `@types/express`, `@types/node`, `vitest`, `supertest`, `@types/supertest`, `eslint`,
  `typescript-eslint`, `@eslint/js` (dev).
- Commands run and results:
  - `pnpm --filter @devforge/api typecheck` → passed, no output (clean).
  - `pnpm --filter @devforge/api lint` → passed, no output (clean).
  - `pnpm --filter @devforge/api test` → `2 passed (2)`.
  - Manual: started `pnpm dev` in the background, `curl -i http://localhost:4000/health` →
    `200 {"data":{"status":"ok"}}`; `curl -i http://localhost:4000/nope` →
    `404 {"error":{"code":"NOT_FOUND","message":"Route not found"}}`; server then stopped.
- Commit: `16769b0` — "feat(api): scaffold Express app with GET /health".

### 3. Add PostgreSQL and Prisma
(pending)

### 4. Add users, sessions and projects tables
(pending)

### 5. Implement register, login, logout and /auth/me
(pending)

### 6. Implement project creation, listing and detail retrieval
(pending)

### 7. Add authentication and project ownership tests
(pending)

### 8. Scaffold the React frontend and design tokens
(pending)

### 9. Wire register and login pages to the real API
(pending)

### 10. Wire project list, create project and project overview pages
(pending)

### 11. Add the integration test for register → login → create project → list project
(pending)

### 12. Add Docker Compose verification and update the README
(pending)
