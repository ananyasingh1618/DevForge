# Deployment

## What's actually running here

DevForge's supported deployment is a fully local, non-internet-facing, **production-like** stack driven by `docker-compose.yml` at the repository root: four containers (`postgres`, `api`, `frontend`, `ai-service`) built from real production Dockerfiles, wired with `NODE_ENV=production`, real health checks, real dependency ordering, and non-root runtime users. This is genuinely production-*configured* code running production-*shaped* containers — it is not a cloud deployment, and this document does not claim otherwise.

**Known limitation, stated plainly:** no cloud account, container registry, or DNS/TLS-terminating ingress is available in this environment, so there is no public URL. Everything below runs on `localhost`. The Dockerfiles and compose file have no cloud-specific assumptions baked in — deploying this same stack to a real cloud target (ECS, Cloud Run, a Kubernetes cluster, a single VM with Docker Compose) is a matter of pushing the built images to a registry and providing real production values for the environment variables in [CONFIGURATION.md](CONFIGURATION.md) (a real `SESSION_SECRET`, a real `DATABASE_URL`, a real `FRONTEND_ORIGIN`, and TLS handled by whatever ingress/load balancer sits in front) — no code changes are required to do that, but actually doing it requires credentials this environment does not have.

## Running the local production-like deployment

```bash
docker compose build
docker compose up -d
docker compose ps   # wait until all four services report "healthy"
```

- API: http://localhost:4000
- Frontend: http://localhost:4173
- ai-service: http://localhost:8001 (internal; the frontend never calls it directly)
- Postgres: exposed on host port `5433` (not `5432`, to avoid colliding with a native Postgres install — see the compose file's own comment)

Tear down (keeping data): `docker compose down`. Tear down and wipe the database volume: `docker compose down -v` — after this, `api` unit tests run against a **local** dev Postgres will need `bash scripts/setup-test-db.sh` re-run before they'll pass again (this doesn't affect the Docker deployment itself, which re-applies migrations to a fresh volume automatically on next `up`).

## What happens on startup

1. `postgres` starts; its healthcheck (`pg_isready`) must pass before anything else starts.
2. `ai-service` starts in parallel (no DB dependency); its healthcheck hits its own `/health`.
3. `api` starts only once **both** `postgres` and `ai-service` report healthy (`depends_on: condition: service_healthy` in `docker-compose.yml`). On boot, its container `CMD` runs `prisma migrate deploy` (applying any pending migrations non-interactively) and then `exec`s into `node dist/server.js` — `exec` is important: it makes the Node process PID 1, so it receives `SIGTERM` directly from `docker stop` and its graceful-shutdown path (draining any in-flight background job before exiting) actually runs, rather than being hard-killed after Docker's grace period because a wrapping shell process never forwarded the signal.
4. `frontend` starts only once `api` is healthy, and serves the Vite production build via `vite preview`.

Each service's `HEALTHCHECK` (in its own Dockerfile, reused verbatim by `docker-compose.yml`) is what "healthy" means above — see [OPERATIONS.md](OPERATIONS.md#health-checks) for what each one actually checks.

## Container hardening

All three application images (`api`, `frontend`, `ai-service`) run as a fixed non-root user rather than root:

- `api` and `frontend` (both `node:20-slim`-based) run as the image's built-in `node` user (uid 1000).
- `ai-service` (`python:3.12-slim`-based, which has no built-in unprivileged user) creates and runs as a dedicated `aiservice` user (uid/gid 1000).

Verify live: `docker compose exec api whoami` → `node`; `docker compose exec frontend whoami` → `node`; `docker compose exec ai-service whoami` → `aiservice`. This is asserted automatically in CI (see [CI_CD.md](CI_CD.md)).

## Graceful shutdown and restart

`docker compose restart api` (or a plain `docker stop`/orchestrator-issued `SIGTERM`) triggers `api/src/server.ts`'s SIGTERM/SIGINT handler: the HTTP server stops accepting new connections, the background job worker (`jobWorker.ts`) stops pulling new jobs and lets any job it's actively running finish (bounded by that job's own timeout), and only then does the process exit. A job that was mid-flight when the *container* is killed non-gracefully (e.g. `docker kill`, an OOM kill, a host crash) is recovered automatically on the next worker start by `recoverStaleJobs()` — jobs whose lease has expired are requeued (if retries remain) or marked failed (if not), never left silently stuck. See [OPERATIONS.md](OPERATIONS.md#background-jobs) for the full retry/recovery model.

## Database migrations

Migrations are Prisma migrations under `api/prisma/migrations/`, applied via `prisma migrate deploy` (non-interactive, safe to run repeatedly — it only applies migrations not yet recorded as applied). This runs automatically as part of the `api` container's startup `CMD`, so a normal `docker compose up` always leaves the schema up to date before the API starts serving traffic. There is no separate manual migration step in the supported deployment path.

## Production checklist if deploying to a real external target

Everything below is already implemented in code; what's missing in *this* environment is the external account/credential to point it at, not a code gap:

- [ ] Provide a real `DATABASE_URL` pointing at a managed/durable Postgres instance (not the bundled `postgres` container, which has no offsite backup).
- [ ] Generate a real `SESSION_SECRET` (`openssl rand -hex 32`) — startup will refuse to boot in `NODE_ENV=production` with a known placeholder value (see [CONFIGURATION.md](CONFIGURATION.md#production-only-guardrails)).
- [ ] Set `FRONTEND_ORIGIN` to the real deployed frontend origin.
- [ ] Set `GEMINI_API_KEY` (preferred — free tier) or `ANTHROPIC_API_KEY`, and `VOYAGE_API_KEY`, if AI-backed features (requirements/PRD/architecture/epics/QA/code review, embeddings) are needed in that deployment — all are honestly optional; without them those specific routes return `503 PROVIDER_NOT_CONFIGURED` and everything else still works.
- [ ] Put TLS termination and a real public hostname in front of `frontend`/`api` (a load balancer, reverse proxy, or platform ingress) — this stack does not terminate TLS itself.
- [ ] Point `/metrics` at a real scrape target if using Prometheus (see [OPERATIONS.md](OPERATIONS.md#metrics)), or otherwise restrict it from public access — it is unauthenticated by design for this project's local/self-hosted model, which is documented as a real limitation, not silently assumed safe, in `api/src/routes/health.ts`.
