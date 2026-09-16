# CI/CD

`.github/workflows/ci.yml` runs on every push and pull request to `main`. Every job below runs real commands against this repository's actual scripts and services — nothing here is a placeholder step, and every job's commands were run locally against the real stack before being committed (see each job's description for what was verified how).

## Jobs

| Job | What it does | Local equivalent |
|---|---|---|
| `node` | Installs the pnpm workspace, creates a fresh `devforge_test` Postgres database and applies migrations (via `scripts/setup-test-db.sh`, against a real `postgres:16-alpine` service container), then runs typecheck, lint, build, the full unit-test suite (api + frontend + evaluation), integration tests, and the `env.ts` production-guardrail tests specifically. | `pnpm install && bash scripts/setup-test-db.sh && pnpm typecheck && pnpm lint && pnpm build && pnpm test && pnpm test:integration` |
| `ai-service` | Installs ai-service's Python dependencies and runs its pytest suite. | `cd ai-service && pip install -r requirements.txt -r requirements-dev.txt && pytest -q` |
| `retrieval-regression` | Runs the full retrieval/grounding evaluation gate (`pnpm eval`, `evaluation/src/runEval.ts`) against a real Postgres service container with migrations applied. This script already exits non-zero on any benchmark target miss — this job simply makes that a required CI gate, so a future change cannot silently regress retrieval quality below the 17 accepted targets. | `pnpm eval` |
| `docker` | Builds all four Docker images from a fresh context (`docker compose build`), starts the full stack, waits for every service to report `healthy`, then runs real smoke tests: liveness/readiness/metrics endpoints, a real register→session-cookie→authenticated-route round trip, an unauthenticated-request-is-rejected isolation check, and confirms all three application containers run as their intended non-root user. Dumps logs on failure. | `docker compose build && docker compose up -d` then the curl/whoami commands in the job's own steps |
| `security-regression` | Runs the subset of the api test suite specifically covering authentication, authorization, cross-user isolation, and input validation (currently 13 files / 162 tests, selected by content, not a hand-maintained list that can silently go stale) as its own named, individually-reportable gate — in addition to being included in the full suite in the `node` job. | `grep -rlE "cross-user\|isolation\|another user\|unauthorized\|unauthenticated" api/src --include="*.test.ts" -i \| xargs npx vitest run` (from `api/`) |

## Design notes

- **Real Postgres, not mocks**: every job that touches the database runs a real `postgres:16-alpine` GitHub Actions service container with a health check gate, matching local development exactly (same image, same startup script).
- **Docker job is the closest thing to a full production-deployment rehearsal available in CI**: it builds every image from scratch, exercises the actual container startup sequence (migrations-then-serve for `api`, dependency-health ordering for all four services), and asserts on real HTTP responses from the running containers — not just "the build succeeded."
- **`security-regression` selects files by content pattern, not by a hardcoded list**: this means a new test file that mentions cross-user isolation or unauthorized access automatically joins this gate without a workflow edit — a hardcoded list would silently stop growing the moment someone forgot to update it.
- **`retrieval-regression` is its own job (not folded into `node`)** so a retrieval regression is reported as its own clearly-labeled failure, distinct from "some unit test somewhere failed," matching this project's own established practice of treating retrieval/grounding quality as a first-class gate (Phase 16's closure work).

## Reproducing a CI failure locally

Every job's steps are plain shell commands against this repo's own scripts — there is no CI-only tooling. Copy the failing job's `run:` block out of `.github/workflows/ci.yml` and run it locally from the repository root (or the `working-directory` the step specifies). For the `docker` job specifically, `docker compose logs` after `docker compose up -d` shows exactly what CI would have dumped on failure.
