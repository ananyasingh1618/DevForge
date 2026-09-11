# DevForge Foundation — Progress Checklist

This tracks the 12 foundation milestones approved in the Foundation Implementation Plan.
Scope: this is Phase 1 (Foundation) of the full DevForge specification only — auth + project
workspace. Requirements/PRD/architecture generation, GitHub integration, AST parsing,
retrieval, codebase Q&A and code review are explicitly out of scope for this phase and are
NOT implemented, scaffolded with fake behavior, or claimed as working anywhere in this repo.

Status legend: [ ] not started · [~] in progress · [x] done and verified

## Milestones

- [ ] 1. Initialize Git and scaffold the repository
- [ ] 2. Create the API and implement GET /health
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
(pending)

### 2. Create the API and implement GET /health
(pending)

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
