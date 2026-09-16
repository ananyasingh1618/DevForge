# Built from the repository root (see docker-compose.yml's `context: .`) so
# pnpm can resolve the workspace correctly.
FROM node:20-slim AS base
# node:20-slim doesn't ship OpenSSL, which Prisma's query engine needs to
# detect its binary target correctly (otherwise it silently guesses and
# warns during `prisma generate`).
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY api/package.json ./api/package.json
COPY frontend/package.json ./frontend/package.json
COPY tests/package.json ./tests/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY api ./api
RUN pnpm --filter @devforge/api exec prisma generate
RUN pnpm --filter @devforge/api build

WORKDIR /repo/api
EXPOSE 4000

# Non-root runtime (Phase 17, Milestone 17.2): `node:20-slim` ships a
# built-in, unprivileged `node` user (uid 1000) for exactly this purpose —
# no need to create one. Everything under /repo is chown'd to it so the
# runtime process (reading its own built files, and `prisma migrate
# deploy` writing its own migration-history bookkeeping) has the access it
# actually needs without running as root.
RUN chown -R node:node /repo
USER node

# Container-native health signal, reusing the exact same real endpoint and
# check style docker-compose.yml's own healthcheck already uses (Node's
# built-in fetch, no curl/wget needed — neither is installed in this
# slim image). Present here too so this image is self-describing and
# healthy/unhealthy under `docker run` directly, not only under Compose.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
    CMD ["node", "-e", "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Applies any pending migrations before starting — this is the container's
# equivalent of the local-dev `prisma migrate dev` step, using the
# non-interactive `deploy` command appropriate for a running environment.
# `exec` replaces the shell with the node process so node becomes PID 1 and
# receives SIGTERM directly from `docker stop` — without it, the shell stays
# PID 1, never forwards the signal to its child, and server.ts's graceful
# shutdown (worker.stop() draining any in-flight job before exit) never
# runs, forcing Docker to hard-kill the process after its grace period
# instead. Found via a live `docker compose stop` check during Milestone
# 15.8 verification.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && exec node dist/server.js"]
