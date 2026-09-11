# Built from the repository root (see docker-compose.yml's `context: .`) so
# pnpm can resolve the workspace correctly.
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY api/package.json ./api/package.json
COPY frontend/package.json ./frontend/package.json
COPY tests/package.json ./tests/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY frontend ./frontend
# Vite inlines VITE_* env vars at build time, and this is what the browser
# (running on the host, not inside the Docker network) will call — so it
# must be the host-mapped API URL, not the Docker-internal service name.
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @devforge/frontend build

WORKDIR /repo/frontend
EXPOSE 4173

CMD ["pnpm", "exec", "vite", "preview", "--host", "0.0.0.0", "--port", "4173"]
