# Cross-cutting integration tests

Integration tests that exercise a genuinely running API process over real HTTP — distinct
from the unit/API tests under `api/src/**/*.test.ts`, which drive the Express app object
in-process via Supertest and never touch a real socket.

## Running

Requires the API reachable (default `http://localhost:4000`) backed by a real, migrated
Postgres database:

```bash
docker compose up -d postgres   # from the repo root
cd api && pnpm exec prisma migrate deploy && pnpm dev   # in one terminal
cd tests && pnpm test                                    # in another
```

Override the target with `API_URL` / `DATABASE_URL` env vars if the API or database aren't
on the defaults (e.g. to point at the Docker Compose stack once Milestone 12 wires it up).

## What's here

- `register-login-project.test.ts` — register → login → create project → list project,
  followed by a direct-database check that only a bcrypt password hash and a SHA-256 session
  token hash are ever persisted (never the plaintext password or raw session token).
