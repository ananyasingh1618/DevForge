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
- [x] 3. Add PostgreSQL and Prisma
- [x] 4. Add users, sessions and projects tables
- [x] 5. Implement register, login, logout and /auth/me
- [x] 6. Implement project creation, listing and detail retrieval
- [x] 7. Add authentication and project ownership tests
- [x] 8. Scaffold the React frontend and design tokens
- [x] 9. Wire register and login pages to the real API
- [x] 10. Wire project list, create project and project overview pages
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
- Files: `docker-compose.yml` (postgres service), `api/prisma.config.ts`,
  `api/prisma/schema.prisma` (datasource + generator only, no models yet),
  `api/src/lib/prisma.ts`, edits to `api/src/env.ts` (DATABASE_URL/SESSION_SECRET now
  required), `api/vitest.config.ts` (fake test env vars), `.env.example` and `api/.env`
  (not committed).
- Blocking technical issue hit and resolved without needing your input (not a product
  decision, a tooling fact-finding problem): the installed Prisma CLI auto-resolved to a
  `8.0.0-rc.13` pre-release; pinned both `prisma` and `@prisma/client` to the latest actual
  stable release, `7.10.0`. Prisma 7 turned out to have two breaking changes from the
  tutorials/docs most people know: (1) the datasource `url` can no longer live in
  `schema.prisma` — it moved to a `prisma.config.ts` used only by the Migrate CLI; (2)
  `PrismaClient` now refuses to construct without an explicit driver adapter at runtime, so
  `@prisma/adapter-pg` + `pg` were added and `prisma.ts` passes `new PrismaPg({ connectionString })`
  into the client constructor.
- Second issue hit and resolved: this machine already runs a native Homebrew
  `postgresql@17` service bound to `127.0.0.1:5432`/`[::1]:5432` for unrelated projects.
  Docker's Postgres container was silently shadowed by it on `localhost`. Fixed by mapping
  the container to host port **5433** instead (`docker-compose.yml`, `.env.example`,
  `api/.env`, `api/vitest.config.ts` all updated) — the native service was left completely
  untouched.
- Commands run and results:
  - `open -a Docker` + poll `docker info` → Docker Desktop came up in ~10s.
  - `docker compose up -d postgres` → image pulled, container started.
  - `docker inspect --format='{{.State.Health.Status}}' devforge-postgres-1` → `healthy`.
  - `PGPASSWORD=devforge psql -h localhost -p 5433 -U devforge -d devforge -c "SELECT current_user, current_database();"` →
    returned `devforge | devforge` (after the port fix; the pre-fix attempt on 5432 failed
    with `role "devforge" does not exist`, which was the native-Postgres-shadowing symptom).
  - `pnpm exec prisma validate` → `The schema at prisma/schema.prisma is valid`.
  - `pnpm exec prisma generate` → generated into
    `node_modules/.pnpm/@prisma+client@7.10.0.../node_modules/@prisma/client` (resolves via
    the normal `@prisma/client` import).
  - A throwaway `tsx` script importing the real `src/lib/prisma.ts` and running
    `prisma.$queryRawUnsafe("SELECT 1 as ok")` → `CONNECTION_OK [{"ok":1}]`.
  - `pnpm exec prisma migrate dev --name init` → `Already in sync, no schema change or
    pending migration was found` (expected — no models exist yet; migration history creation
    is exercised for real in Milestone 4).
  - `pnpm --filter @devforge/api typecheck` → clean.
  - `pnpm --filter @devforge/api lint` → clean.
  - `pnpm --filter @devforge/api test` → `2 passed (2)`.
  - Manual: `pnpm dev` in background, `curl -i http://localhost:4000/health` → `200
    {"data":{"status":"ok"}}` (confirms the server still boots now that DATABASE_URL/
    SESSION_SECRET are required env vars); server stopped afterward.
- Commit: `bb2cdc2` — "feat(api): wire up PostgreSQL and Prisma".

### 4. Add users, sessions and projects tables
- Files: `api/prisma/schema.prisma` (User, Session, Project models + ProjectStatus enum),
  `api/prisma/migrations/20260911204644_init_users_sessions_projects/migration.sql`,
  `api/prisma/migrations/migration_lock.toml`.
- Commands run and results:
  - `pnpm exec prisma migrate dev --name init_users_sessions_projects` → migration created
    and applied, "Your database is now in sync with your schema."
  - `psql \dt` → `users`, `sessions`, `projects`, `_prisma_migrations` all present.
  - `psql \d users` / `\d sessions` / `\d projects` → columns, primary keys, the
    `users_email_key` and `sessions_token_hash_key` unique indexes, the `sessions_user_id_idx`
    and `projects_owner_id_idx` indexes, and both `ON DELETE CASCADE` foreign keys all match
    the design.
  - `pnpm exec prisma generate` → client regenerated with the new models.
  - A throwaway `tsx` script (`_model_check.ts`, deleted after running) created a user, a
    session, and a project via the typed Prisma Client, listed the user's projects (1), then
    deleted the user and confirmed both the session and project were cascade-deleted (0
    remaining each).
  - `pnpm --filter @devforge/api typecheck` → clean.
  - `pnpm --filter @devforge/api lint` → clean.
  - `pnpm --filter @devforge/api test` → `2 passed (2)`.
- Commit: `24081f9` — "feat(api): add users, sessions and projects tables".

### 5. Implement register, login, logout and /auth/me
- Files: `api/src/lib/password.ts` (bcrypt cost 12), `api/src/lib/sessionToken.ts` (random
  32-byte token + SHA-256 hashing), `api/src/lib/cookies.ts` (httpOnly/SameSite=Lax cookie,
  Secure in production only), `api/src/lib/validate.ts` (Zod parse helper → structured 400),
  `api/src/schemas/auth.ts`, `api/src/services/auth.ts`, `api/src/middleware/requireAuth.ts`,
  `api/src/types/express.d.ts` (Request.user augmentation), `api/src/controllers/auth.ts`,
  `api/src/routes/auth.ts`, `api/src/routes/auth.test.ts`; wired `cookie-parser` and `cors`
  (credentialed, locked to FRONTEND_ORIGIN) plus the auth router into `api/src/app.ts`.
- Dependencies installed: `bcrypt`, `cookie-parser`, `cors` (runtime); `@types/bcrypt`,
  `@types/cookie-parser`, `@types/cors` (dev).
- Also created the dedicated `devforge_test` Postgres database and applied the Milestone 4
  migration to it (`prisma migrate deploy` with `DATABASE_URL` pointed at it), since the
  auth tests exercise the real database rather than mocks.
- Bug caught by the tests, not written intentionally: login failures were first coded to
  reuse `AppError.unauthenticated()`, which returns code `UNAUTHENTICATED` — the same code
  `requireAuth` uses for "no/invalid session". The "wrong password" and "unknown email" test
  cases failed, expecting a distinct `INVALID_CREDENTIALS` code. Fixed in
  `services/auth.ts` by constructing that error directly with its own code, re-ran, confirmed
  green.
- Commands run and results:
  - `pnpm --filter @devforge/api typecheck` → clean (after also fixing a strict-mode
    `string[] | undefined` typing issue in the test file's cookie handling).
  - `pnpm --filter @devforge/api lint` → clean.
  - `pnpm --filter @devforge/api test` → `12 passed (12)` across register (success, 409
    duplicate email, 400 short password), login (success, 401 wrong password, 401 unknown
    email — same code as wrong password), `/auth/me` (401 no cookie, 200 valid cookie), and
    logout (clears session so a later `/auth/me` is 401; 401 if called with no session).
  - Manual: ran the dev server and drove the real HTTP flow with `curl` — register (201, cookie
    set with `HttpOnly; SameSite=Lax`, no `Secure` in dev), `/auth/me` (200), logout (204,
    cookie cleared), `/auth/me` again (401 `UNAUTHENTICATED`), login with wrong password (401
    `INVALID_CREDENTIALS`).
  - `psql`: confirmed `sessions.token_hash` holds only a hex SHA-256 hash (never the raw
    cookie token) and `users.password_hash` holds a `$2b$12$...` bcrypt hash (never
    plaintext); manual test user deleted afterward to keep the dev DB clean.
- Commit: `83f99b0` — "feat(api): implement register, login, logout and /auth/me".

### 6. Implement project creation, listing and detail retrieval
- Files: `api/src/schemas/projects.ts`, `api/src/services/projects.ts`,
  `api/src/controllers/projects.ts`, `api/src/routes/projects.ts` (wired into `app.ts`),
  `api/src/routes/projects.test.ts`; `api/vitest.config.ts` gained `fileParallelism: false`.
- Bug caught by the tests, not written intentionally: adding a second test file exposed that
  Vitest runs test files in parallel by default. Both `auth.test.ts` and `projects.test.ts`
  share one real Postgres test database and each does its own `beforeEach` cleanup
  (`deleteMany` on sessions/projects/users) — running concurrently, one file's cleanup was
  deleting rows the other file's in-flight request depended on, surfacing as a foreign-key
  violation in `auth.test.ts` and unexpected 401s in `projects.test.ts`. Fixed by setting
  `fileParallelism: false`; all 22 tests passed immediately after, so this was the only cause.
- Commands run and results:
  - `pnpm --filter @devforge/api typecheck` → clean.
  - `pnpm --filter @devforge/api lint` → clean.
  - `pnpm --filter @devforge/api test` → `22 passed (22)` (10 auth + 12 project tests, across
    2 files, after the parallelism fix — before the fix, 3 failed intermittently).
  - Manual: dev server + `curl` — registered user A, created a project (201), listed it back
    (1 item), fetched it by id (200); registered a separate user B and confirmed
    `GET /projects/:id` for A's project returns 404 `NOT_FOUND` for B (not 403, not the
    project data), and B's own `GET /projects` stays `[]`. Test users deleted afterward.
- Commit: `bb0b869` — "feat(api): implement project creation, listing and detail retrieval".

### 7. Add authentication and project ownership tests
- Files: `api/src/routes/projects.ownership.test.ts`.
- This milestone added dedicated automated coverage for two things that Milestones 5-6 had
  only exercised manually or partially: true two-user cross-ownership (not just "no session
  at all"), and session-token expiry.
- Commands run and results:
  - `pnpm --filter @devforge/api typecheck` → clean.
  - `pnpm --filter @devforge/api lint` → clean.
  - `pnpm --filter @devforge/api test` → `26 passed (26)` across 4 files, including: user B
    gets 404 (not 403, no `data` key) for user A's project; `GET /projects` never mixes two
    users' projects even when both have some; a well-formed-but-nonexistent id is 404 for any
    authenticated user; a session whose `expiresAt` is forced into the past via Prisma is
    rejected by `requireAuth` (401) even though its token hash still matches a row.
  - Manual: ran the dev server, registered a user, confirmed `/auth/me` is 200, then used
    `psql` to `UPDATE sessions SET expires_at = now() - interval '1 hour'` for that user and
    confirmed `/auth/me` became 401 `UNAUTHENTICATED` — the expiry check holds outside the
    test harness too. Test user deleted afterward.
- Commit: `e5ee64f` — "test(api): add dedicated ownership and session-expiry tests".

### 8. Scaffold the React frontend and design tokens
- Files: full Vite+React+TS scaffold under `frontend/` (see commit `1882f6d`) — key ones:
  `frontend/src/index.css` (design tokens), `frontend/src/components/{Button,Input,Card,
  StateViews}.tsx`, `frontend/src/App.tsx`, `frontend/src/main.tsx`, `frontend/eslint.config.js`,
  `frontend/vitest.config.ts`.
- Blocking technical issues hit and resolved without needing input: (1) `create-vite`'s
  current template defaults to oxlint and TypeScript ~6.0.2 — swapped to ESLint +
  typescript-eslint and pinned TypeScript to 5.9.3 to stay consistent with `api/` and avoid
  the same peer-dependency mismatch hit in Milestone 3; (2) after adding frontend's
  React-related deps, pnpm's dependency graph shifted and `@prisma/client`'s resolved path
  changed, breaking the api tests with `Cannot find module '.prisma/client/default'` — fixed
  by re-running `prisma generate`, not a real regression, just a stale generated-client path.
- No `chromium-cli` was available in this environment for the visual check the `run` skill's
  playwright pattern recommends; used the machine's cached Playwright + Chromium (via npx's
  package cache) directly instead — noted here in case a `/run-skill-generator` pass is
  wanted later to capture that as a reusable project skill.
- Commands run and results:
  - `pnpm --filter @devforge/frontend typecheck` → clean.
  - `pnpm --filter @devforge/frontend lint` → clean.
  - `pnpm --filter @devforge/frontend build` → succeeded (`vite build`, ~262KB JS / 13KB CSS
    before gzip).
  - `pnpm --filter @devforge/frontend test` → `2 passed (2)` (a Button smoke test: click
    handling, disabled+`aria-busy` loading state).
  - Manual: started the dev server, drove it with a throwaway Playwright script — screenshots
    taken in light mode (default), forced dark mode, a keyboard-focus state (Tab lands a
    visible accent ring on the Primary button), and a 375px mobile viewport; zero browser
    console errors in any case. Screenshots sent to the user in-session, not stored in the repo.
- Commit: `1882f6d` — "feat(frontend): scaffold React/TypeScript app with design tokens".

### 9. Wire register and login pages to the real API
- Files: `frontend/src/services/apiClient.ts`, `frontend/src/services/authApi.ts`,
  `frontend/src/types/user.ts`, `frontend/src/hooks/useAuth.tsx`,
  `frontend/src/components/RequireAuth.tsx`, `frontend/src/pages/{Register,Login,
  ProjectsPlaceholder}.tsx` + their `.test.tsx` files, `frontend/src/vite-env.d.ts`,
  `frontend/src/App.tsx` (routes + AuthProvider), `frontend/.env` (not committed).
- `ProjectsPlaceholder.tsx` is a deliberate, clearly-labeled stand-in for the real Projects
  page (Milestone 10) — just enough ("signed in as X, workspace built next" + logout) that
  this milestone's register/login flow has somewhere real to land and is testable end-to-end
  on its own, not a claim that project management works yet.
- Bug caught and fixed before running anything: `apiRequest()` called `res.json()`
  unconditionally; logout returns 204 with an empty body, which throws on `.json()` and would
  have made every logout surface as a false `UNKNOWN_ERROR`. Added an explicit 204
  short-circuit before the JSON parse.
- Commands run and results:
  - `pnpm exec tsc -b` (frontend) → clean.
  - `pnpm exec eslint .` (frontend) → 1 warning (react-refresh, for exporting both
    `AuthProvider` and `useAuth` from one file — the standard pattern for this kind of hook,
    not a defect), 0 errors.
  - `pnpm exec vitest run` (frontend) → `8 passed (8)` across Button/Register/Login tests:
    client-side validation blocks the API call; valid submission calls register/login with
    the right payload; server error messages (EMAIL_TAKEN, INVALID_CREDENTIALS) render;
    submit button disables while the request is pending.
  - Manual: started both the api and frontend dev servers, drove the real browser with a
    throwaway Playwright script — registered a new user through the actual `/register` UI,
    confirmed redirect to `/projects` showing the real registered email, clicked Log out,
    confirmed redirect to `/login`, logged back in with the same credentials, confirmed
    redirect to `/projects` again. Verified via `psql` that the user really exists in
    Postgres, then deleted the test row. Zero uncaught page errors (`pageerror` listener);
    the two console entries were expected network-level 401 logs from the initial "am I
    logged in" check on page load, not exceptions.
- Commit: `b5ecf37` — "feat(frontend): wire register and login pages to the real API".

### 10. Wire project list, create project and project overview pages
- Files: `frontend/src/components/AppShell.tsx`, `frontend/src/services/projectsApi.ts`,
  `frontend/src/types/project.ts`, `frontend/src/pages/{Projects,ProjectNew,
  ProjectOverview}.tsx` + their `.test.tsx` files, `frontend/src/App.tsx` (real routes);
  removed `frontend/src/pages/ProjectsPlaceholder.tsx` (superseded by the real `Projects`
  page).
- Bug caught and fixed by lint (not by running anything): `eslint-plugin-react-hooks`'s
  `set-state-in-effect` rule flagged both `Projects` and `ProjectOverview` for calling
  `setState({status:"loading"})` synchronously as the first statement inside their mount
  effects. Restructured both into a `fetch*` function whose only `setState` calls live inside
  `.then`/`.catch`, plus a separate `retry()` click handler (not constrained by the rule) that
  resets to loading before re-fetching.
- Commands run and results:
  - `pnpm exec tsc -b` (frontend) → clean.
  - `pnpm exec eslint .` (frontend) → 1 pre-existing warning (same as Milestone 9, unrelated),
    0 errors.
  - `pnpm exec vitest run` (frontend) → `16 passed (16)` across all pages: list
    loading/empty/populated/error states; create-form required-name validation and
    server-error surfacing; overview rendering the real project plus 7 "Not yet implemented"
    labels, and a 404 "Project not found" message for a missing/foreign project.
  - Manual: ran both dev servers, drove the complete flow with Playwright — register → empty
    list → create a project via the real form → land on its overview (real name/description/
    status, every planned capability explicitly marked "Not yet implemented") → back to the
    list, now showing the project as a card.
  - Investigated what first looked like a broken "back to Projects" navigation across ~6
    diagnostic script runs: confirmed via instrumented timing (URL vs. DOM content at 0/200/
    500/1000/2000ms) that this was a ~200ms client-side-routing render race in the *test
    script's* wait condition (it matched "DevForge Foundation" text present on both the old
    and new page), not an application defect — `history.pushState` updates the URL before
    React finishes unmounting the old route and mounting the new one, which is normal SPA
    behavior. Fixed the script to wait on the list page's own `<h1>` and re-verified clean;
    documented in detail so this doesn't get mistaken for a real bug later.
  - Test users deleted from the database (`DELETE FROM users WHERE email LIKE 'e2e-%'` →
    13 rows) after all manual/diagnostic runs.
- Commit: `a1cc85c` — "feat(frontend): wire project list, create and overview pages".

### 11. Add the integration test for register → login → create project → list project
(pending)

### 12. Add Docker Compose verification and update the README
(pending)
