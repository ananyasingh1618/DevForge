# Configuration

DevForge's environment variables, validated at startup by [`api/src/env.ts`](../api/src/env.ts) (Zod). An invalid or missing required variable makes the process exit(1) immediately with a clear error listing exactly which variable(s) failed and why — it never starts up into a half-configured, silently-broken state. `.env.example` at the repository root (and per-package copies at `api/.env.example`, `frontend/.env.example`, `ai-service/.env.example`) mirrors this table; keep both in sync when either changes.

Copy the relevant section of `.env.example` to a real `.env` file in that package's directory (`api/.env`, `frontend/.env`, `ai-service/.env`). Never commit a real `.env` file — `.gitignore` already excludes `.env` and `.env.*` (except the `.env.example` files themselves).

## api

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development` \| `test` \| `production`. Setting this to `production` activates the extra guardrails below. |
| `PORT` | No | `4000` | Port the API listens on. |
| `DATABASE_URL` | **Yes** | — | Postgres connection string. Local (non-Docker) dev uses host port `5433` (not `5432` — see docker-compose.yml's comment on why); Docker Compose overrides this internally to the `postgres:5432` in-network hostname. |
| `SESSION_SECRET` | **Yes** | — | Used to hash session tokens (SHA-256) and as a general server secret. Must be at least 32 characters. Generate with `openssl rand -hex 32`. |
| `FRONTEND_ORIGIN` | **Yes** | — | The single origin CORS allows to send credentialed requests. |
| `AI_SERVICE_URL` | No | `http://localhost:8001` | Where the API reaches ai-service. Docker Compose overrides this to `http://ai-service:8001`. |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | No | unset | Base64-encoded 32-byte AES-256-GCM key, used to encrypt stored GitHub OAuth tokens at rest. Generate with `openssl rand -base64 32`. Unset disables GitHub repository connection/indexing — those routes return `503 GITHUB_INTEGRATION_NOT_CONFIGURED`; every other feature still works normally. |
| `LOG_LEVEL` | No | `info` | `debug` \| `info` \| `warn` \| `error`. Lines below the configured level are not emitted. Production deployments handling high request volume typically prefer `warn`. |
| `DATABASE_POOL_MAX` | No | `10` | Maximum Postgres connection-pool size (see `api/src/lib/prisma.ts`). |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | No | `30000` | How long an idle pooled connection is kept before being closed. |
| `DATABASE_CONNECT_TIMEOUT_MS` | No | `10000` | How long a new connection attempt waits before failing. |
| `TRUST_PROXY_HOPS` | No | `0` | Number of reverse proxies in front of the API whose `X-Forwarded-For` is trusted (`app.set("trust proxy", n)`). Must be set (e.g. `1`) behind a proxy such as the Caddy in `docker/`, otherwise every client shares the proxy's IP and the rate limiters throttle all users as one. |
| `SESSION_COOKIE_SAMESITE` | No | `lax` | `lax` \| `strict` \| `none`. `lax` is correct whenever frontend and API share a site (local dev, Compose, the same-origin Caddy deployment). `none` (HTTPS only) is for a frontend on a different site and gives up `lax`'s CSRF protection — explicit opt-in only. |

### Production-only guardrails

When `NODE_ENV=production`, `api/src/env.ts` additionally rejects startup if:

- `SESSION_SECRET` is one of the known example/placeholder values from `.env.example` or the test suite (`KNOWN_PLACEHOLDER_SECRETS` in `env.ts`) — this catches the single most common real-world production misconfiguration (a copy-pasted example secret deployed as-is) without using a broad heuristic that could reject a legitimate deployment.
- `DATABASE_URL` points at a database literally named `devforge_test` — this catches a deployment accidentally pointed at the test database.

These are deliberately narrow, exact-match checks rather than broad heuristics (e.g. "rejects any `localhost` origin"): this project's own supported local production-like deployment (`docker-compose.yml`, see [DEPLOYMENT.md](DEPLOYMENT.md)) legitimately runs with `NODE_ENV=production` against `localhost` origins and a dedicated (non-placeholder, non-default) secret — a broad heuristic would incorrectly reject that valid, intentional deployment shape. This exact regression happened once during Phase 17 development and is now covered by a dedicated test (`api/src/env.test.ts`, "accepts a legitimate local production-like deployment").

## frontend

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_API_URL` | No | `http://localhost:4000` | The browser-facing API URL. Must be reachable from wherever the user's browser runs (never a Docker-internal hostname) — Vite inlines this at build time into the shipped JS bundle, so it cannot be changed at container runtime without a rebuild. |

## ai-service

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | No | unset | Enables real Gemini-backed requirements/PRD/architecture/epic/task generation, codebase Q&A, and AI code review, via the official `google-genai` SDK. **Preferred provider**: used whenever it's set, even if `ANTHROPIC_API_KEY` is also set — see `app/lib/provider_config.py`'s `resolve_llm_provider()`. Get a free-tier key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — no billing setup required to start. Unset (and `ANTHROPIC_API_KEY` also unset): ai-service still starts and `/health` still reports healthy, but every route that needs a model returns a real, honest `503 PROVIDER_NOT_CONFIGURED` — never a fabricated result. |
| `ANTHROPIC_API_KEY` | No | unset | Enables the same set of features as `GEMINI_API_KEY` above, via Claude instead — fully supported as an explicit, independent alternative, not a fallback being phased out. Used only when `GEMINI_API_KEY` is unset. |
| `VOYAGE_API_KEY` | No | unset | Enables real Voyage AI embedding generation. Unrelated to which LLM text provider (`GEMINI_API_KEY`/`ANTHROPIC_API_KEY`) is selected above. Same honest-503 behavior as above when unset. |

## Secret handling

- Secrets are never logged. `api/src/lib/logger.ts` redacts any field whose name matches a secret-shaped pattern (`secret`, `token`, `password`, `key`, `authorization`, etc.) before writing a structured log line, and `api/src/lib/secretRedaction.ts` additionally shape-detects and redacts common credential formats (API keys, JWTs, connection strings) even inside otherwise-unlabeled string fields.
- Secrets are never returned in API responses — response DTOs are hand-constructed allowlists of fields, not raw database row passthrough.
- Secrets are never present in the frontend bundle — the only frontend-facing configuration value is `VITE_API_URL`, which is not a secret.
- The centralized error handler (`api/src/app.ts`) never forwards a raw internal error message or stack trace to the client; it logs the real error server-side (through the redacting logger) and returns a fixed, safe error envelope.
