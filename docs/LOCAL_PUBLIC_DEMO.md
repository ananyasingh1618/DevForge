# Free local public demo (Docker + Caddy + Cloudflare Quick Tunnel)

Runs the whole stack on your own machine and makes it reachable through a
temporary public URL. No paid hosting, no account, no credit card.

```
Internet -> Cloudflare Quick Tunnel -> 127.0.0.1:8090 -> web (Caddy)
                                                          |- static SPA
                                                          '- /api/* -> api -> postgres
                                                                       '-> ai-service
```

Only `web` publishes a port, and only on loopback. `postgres`, `ai-service`
and `api` are reachable solely from inside the Docker network. Caddy proxies
an **allowlist** of API prefixes (`/api/auth`, `/api/projects`,
`/api/evaluations`, `/api/health`); everything else under `/api` — notably the
API's unauthenticated `/metrics`, `/metrics.json`, `/ready` — is a 404.

## Commands

```bash
scripts/start-prod.sh      # build + start (first run creates .env.production; ~10 min cold build)
scripts/start-tunnel.sh    # print a public https://*.trycloudflare.com URL
scripts/status-prod.sh     # containers, memory, local + public URL
python3 scripts/smoke_test.py http://127.0.0.1:8090        # local smoke + exposure test
python3 scripts/smoke_test.py "$(cat .run/tunnel.url)"     # same test through the public URL
scripts/stop-tunnel.sh     # take it offline (only this project's cloudflared)
scripts/stop-prod.sh       # stop tunnel + containers (database volume is kept)
```

Local URL: http://127.0.0.1:8090 · Public URL: printed by `start-tunnel.sh`
(also `.run/tunnel.url`); it is random and changes on every tunnel start.

## Secrets

`.env.production` (gitignored, mode 600) is generated on first start with
random `POSTGRES_PASSWORD`, `SESSION_SECRET` and `GITHUB_TOKEN_ENCRYPTION_KEY`.
`GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `VOYAGE_API_KEY` are copied from the
repo's root `.env` if set there, otherwise edit `.env.production` and run
`scripts/start-prod.sh` again. Without an AI key those features return an
honest 503 "not configured". Never commit `.env.production`.
Do not delete `GITHUB_TOKEN_ENCRYPTION_KEY` afterwards: stored GitHub tokens
would become unreadable.

## Behavior and limits

- Data lives in the `devforge-prod_devforge_prod_pgdata` volume; it survives
  restarts and `stop-prod.sh`. It is separate from the dev `docker-compose.yml`
  database. Never use `docker compose down -v` on it unless you mean to wipe it.
- The tunnel URL is temporary and public: anyone with it can register an
  account. Stop the tunnel when you are not demoing.
- Cloudflare ends a request after ~100 s; a very slow AI call can return 524
  even if the API would have finished.
- The background job worker runs inside the `api` container (no separate
  worker). Quick Tunnels are for demos, not for production traffic.
- `Secure` session cookies work on `http://localhost` in Chrome/Firefox; use the
  public https URL (or a Chromium/Firefox browser) for the local demo.
