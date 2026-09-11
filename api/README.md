# DevForge API

Node/Express + TypeScript (strict), Prisma 7 (PostgreSQL via `@prisma/adapter-pg`), Zod
validation, opaque server-side sessions (bcrypt password hashing, SHA-256 session token
hashing), Vitest + Supertest.

Full setup/architecture/API docs are in the root [README.md](../README.md).

```bash
pnpm dev          # http://localhost:4000
pnpm test
pnpm lint
pnpm typecheck
pnpm exec prisma migrate dev   # after changing prisma/schema.prisma
```
