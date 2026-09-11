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

# Applies any pending migrations before starting — this is the container's
# equivalent of the local-dev `prisma migrate dev` step, using the
# non-interactive `deploy` command appropriate for a running environment.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/server.js"]
