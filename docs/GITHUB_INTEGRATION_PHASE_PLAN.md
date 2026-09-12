# DevForge Phase 6 (GitHub Integration) — Implementation Plan

## Scope

Let a project owner connect a GitHub repository to their DevForge project, verify DevForge can
actually access it, pick a branch, and disconnect — laying the connection groundwork later
phases (repository ingestion, AST parsing, retrieval, codebase Q&A, code review) will build on.
This phase does **not** touch any of that later work; it only proves the connection itself is
real, secure, and ownership-enforced.

This is the first phase that is not another link in the
Requirements → PRD → Architecture → Epics → Tasks generation chain. It has no upstream
artifact dependency and does not call the `ai-service` at all — the reusable patterns carried
forward from Phases 2–5 are **auth, ownership, validation, and error-envelope conventions**,
not the generate/version/activate/compare shape those phases share with each other.

## Authentication approach — decision

The three options and why each was or wasn't chosen:

- **GitHub OAuth App**: requires a registered OAuth App (Client ID + Secret) and a reachable
  public callback URL. Neither exists in this environment, and standing one up is
  infrastructure this phase has no way to provision or verify. Rejected for this phase.
- **GitHub App installation**: requires an even heavier setup — a registered GitHub App
  manifest, an installation flow, a private key for JWT-based installation-token exchange, and
  a webhook endpoint. None of that exists here either, and it's disproportionate to "connect
  one repository and verify access." Rejected for this phase.
- **Personal Access Token (PAT), supplied by the user**: requires **zero** app-level
  registration. The user generates their own token on github.com (classic or fine-grained,
  scoped to `repo` read access) and pastes it into DevForge. DevForge never invents, requests,
  or assumes a token exists — the user must explicitly provide one, matching "Do not invent a
  GitHub token or assume a GitHub account is already connected" directly. **Chosen.**

This is "the smallest secure approach that fits the existing DevForge architecture": no new
external app registration, no callback infrastructure, and it reuses the exact pattern already
established for the one other external credential this codebase handles —
`ANTHROPIC_API_KEY`, read at call time and gated behind an honest "not configured" error when
absent, never fabricated.

**Unconfigured behavior**: storing a PAT requires encrypting it at rest (see Milestone 2).
Encryption requires a server-side key. This environment has no such key configured
(`GITHUB_TOKEN_ENCRYPTION_KEY` is unset, confirmed via `env | grep -i github` → empty,
mirroring how `ANTHROPIC_API_KEY` was confirmed unset at the start of every prior phase). So
connecting a repository in this environment genuinely returns a real, honest
`503 GITHUB_INTEGRATION_NOT_CONFIGURED` — the same shape as every prior phase's
`PROVIDER_NOT_CONFIGURED`, checked **before any GitHub API call**, not a fabricated success.

**What can be verified for real despite no real user PAT existing**: this environment does
have real outbound network access to `api.github.com` (confirmed: `curl
https://api.github.com/` returns a genuine GitHub 403 rate-limit response, not a network
timeout). That means the GitHub client can be pointed at the real GitHub REST API and tested
against real, honest failure responses — invalid-token 401, repository-not-found 404,
rate-limited 403 — the same "never fabricate success, always exercise the real error path"
discipline every prior phase applied to `ANTHROPIC_API_KEY`. No test in this phase claims a
real repository was successfully connected, because no real, valid, user-supplied PAT exists
in this environment — consistent with every prior phase's rule for `ANTHROPIC_API_KEY`.

## Data model — decision: one connection row per project, not a versioned artifact

Every AI-generated phase (Requirements → Tasks) modeled its data as an append-only, versioned
list with an `isActive` invariant, because each generation run produces a new artifact worth
keeping alongside its history. A GitHub connection is different in kind: it's **configuration/
state**, not generated content — a project has at most one active connection at a time, and
reconnecting or changing the branch **replaces** that state rather than adding a new version
to compare against old ones. So `RepositoryConnection` is a single row per project
(`@@unique([projectId])`), upserted on connect/reverify, updated in place on branch change, and
hard-deleted on disconnect — structurally closer to `Project` itself than to
`RequirementsVersion`. This is the explicit "decide and document" call the task asks for.

```prisma
enum RepositoryConnectionStatus {
  pending
  verified
  error
}

model RepositoryConnection {
  id                  String   @id @default(uuid())
  projectId           String   @unique @map("project_id")
  githubOwner         String   @map("github_owner")
  githubRepo          String   @map("github_repo")
  githubRepoId        String?  @map("github_repo_id")
  githubAccountLogin  String?  @map("github_account_login")
  repositoryUrl       String   @map("repository_url")
  defaultBranch       String?  @map("default_branch")
  selectedBranch      String?  @map("selected_branch")
  status              RepositoryConnectionStatus @default(pending)
  lastVerifiedAt      DateTime? @map("last_verified_at")
  lastError           String?  @map("last_error")
  encryptedToken       String   @map("encrypted_token")
  tokenLast4          String   @map("token_last_4")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@map("repository_connections")
}
```

- `githubRepoId` — GitHub's own numeric repo id, captured once verification succeeds; the
  prompt's "Repository ID where available" — nullable because it's only known after a
  successful verify.
- `githubAccountLogin` — the GitHub user login the PAT authenticates as (`GET /user`), the
  closest analogue to "GitHub installation or account identity" under the PAT model (there is
  no installation id, since this isn't a GitHub App).
- `encryptedToken` / `tokenLast4` — see Milestone 2 for the encryption scheme; `tokenLast4` is
  the only token-derived data ever safe to return to the client, letting the UI show "connected
  with a token ending in ••••1234" without ever re-exposing the token.
- `status`/`lastVerifiedAt`/`lastError` — the prompt's "connection status" and "last
  verification status" requirements, updated by both `connect` and `verify`.
- `onDelete: Cascade` from `Project` — same convention every other project-scoped table uses.

## GitHub client and service (Milestone 3)

`api/src/lib/githubClient.ts` — a thin wrapper over native `fetch` against
`https://api.github.com` (no new dependency; mirrors `aiServiceClient.ts`'s own choice not to
pull in an SDK for a boundary this thin), sending `Authorization: Bearer <token>` and
`X-GitHub-Api-Version: 2022-11-28`. Three operations:

- `getAuthenticatedUser(token)` → `GET /user` → `{ login, id }`, or throws a typed error
  (401 → invalid credentials).
- `getRepository(token, owner, repo)` → `GET /repos/{owner}/{repo}` → `{ id, fullName,
  htmlUrl, defaultBranch, private }`, or throws (404 → not found; 403 with
  `X-RateLimit-Remaining: 0` → rate limited; 403 otherwise → insufficient permissions;
  401 → invalid credentials).
- `listBranches(token, owner, repo)` → `GET /repos/{owner}/{repo}/branches` (paginated,
  followed to completion up to a sane cap) → `[{ name, protected }]`.

Each throws one of a small set of typed errors (`GithubInvalidCredentialsError`,
`GithubRepositoryNotFoundError`, `GithubInsufficientPermissionsError`, `GithubRateLimitedError`,
`GithubApiError` for anything else, including network failure) — the same "typed exception →
mapped AppError" shape `ai-service`'s Anthropic providers use, just implemented in Node since
this call happens directly from the API, not through `ai-service` (there is no AI involved in
GitHub connectivity, so routing it through `ai-service` would be a pointless hop).

`api/src/lib/githubTokenCrypto.ts` — `encryptToken`/`decryptToken` using Node's built-in
`crypto` module, AES-256-GCM, key from `GITHUB_TOKEN_ENCRYPTION_KEY` (32 bytes, base64-encoded)
read **at call time** (not cached at import time — mirrors `get_anthropic_api_key`'s lazy-read
so the process still starts and serves every other route with the key unset), IV generated
per-encryption and stored alongside the ciphertext and auth tag. Missing key →
`AppError(503, "GITHUB_INTEGRATION_NOT_CONFIGURED", ...)`, thrown before any GitHub API call —
the same "check the dependency before doing any work" order every prior phase's
`NO_ACTIVE_*` guard used.

`api/src/services/repository.ts` — `requireOwnedProject` (same as every prior service);
`connectRepository` (config check → verify token → fetch repo → encrypt token → upsert the one
row); `getConnection` (sanitized, no token fields); `verifyAccess` (decrypt → re-check token +
repo → update status/lastVerifiedAt/lastError); `listBranches` (decrypt → fetch); `updateBranch`
(validates the branch exists in the live branch list before saving — the prompt's "Validate the
selected branch" requirement); `disconnectRepository` (hard delete).

## API design (Milestone 4)

Singular-resource shape (not the version-list shape Phases 2–5 use), because there is one
connection, not an append-only history:

| Method | Path | Purpose |
|---|---|---|
| POST | `/projects/:projectId/repository/connect` | Connect (or reconnect/replace) a repository — body `{ token, owner, repo }` |
| GET | `/projects/:projectId/repository` | View the current connection (sanitized), or `{ connection: null }` if none |
| POST | `/projects/:projectId/repository/verify` | Re-verify access against the stored token; 404 if nothing connected |
| GET | `/projects/:projectId/repository/branches` | List branches from GitHub; 404 if nothing connected |
| PATCH | `/projects/:projectId/repository` | Update the selected branch — body `{ branch }`; 404 if nothing connected, 400 if the branch doesn't exist |
| DELETE | `/projects/:projectId/repository` | Disconnect; 404 if nothing connected |

`requireAuth` on the whole group; ownership via `requireOwnedProject` (404, no leak, same as
every prior phase). Error codes: `GITHUB_INTEGRATION_NOT_CONFIGURED` (503, before any GitHub
call), `GITHUB_INVALID_CREDENTIALS` (401), `GITHUB_REPOSITORY_NOT_FOUND` (404),
`GITHUB_INSUFFICIENT_PERMISSIONS` (403), `GITHUB_RATE_LIMITED` (429), `GITHUB_API_ERROR` (502),
`VALIDATION_ERROR` (400, Zod — malformed owner/repo/branch/token shape), `NOT_FOUND` (404, no
connection exists yet for verify/branches/update/disconnect). The connection response never
includes `encryptedToken`; only `tokenLast4` is exposed. The `connect` request body's `token`
is never echoed back or logged.

## Frontend (Milestone 5)

New page `frontend/src/pages/ProjectSettings.tsx` at route `/projects/:id/settings` (linked
from `ProjectOverview.tsx`'s header, next to the existing "← Projects" link) — a settings page
is the right home for a connection/credential concern, distinct from the content-generation
sections already on the overview page. Hosts `frontend/src/components/
RepositoryConnectionSection.tsx`:

- **Disconnected**: explains no repository is connected, a "Connect repository" form (token —
  password-masked input, owner, repo), submit → loading state → on failure shows the real
  error (including the honest "GitHub integration isn't configured" message if that's what the
  server returns) and stays disconnected; never claims success before the server confirms it.
- **Connected**: shows owner/repo/URL, status badge, `githubAccountLogin`, `tokenLast4`,
  selected branch as a `<select>` populated by a live `GET .../branches` call, "Reverify
  access" and "Disconnect" actions.

Reuses `Button`/`Card`/`EmptyState`/`ErrorState`/`LoadingState` exactly as every prior section
does — no new design system, no controls for anything out of scope (no AST/retrieval/Q&A/review
UI).

## Testing strategy (Milestone 6)

- **Database**: a throwaway script (mirroring every prior phase's Milestone 2 verification)
  confirming the unique constraint on `projectId`, cascade delete from `Project`, and that
  `encryptedToken` is never the plaintext token.
- **GitHub client/service**: unit tests against a mocked `fetch` (mirrors `aiServiceClient`'s
  own test doubles) covering every typed error path, plus one real, unmocked check that
  `https://api.github.com` genuinely rejects an invalid token with a real 401 — the same
  "prove the honest-failure path for real" discipline as `ANTHROPIC_API_KEY`.
- **API**: Supertest, mocking `fetch` for determinism (per the task's explicit instruction —
  "Use mocked GitHub API responses for deterministic tests. Do not require real GitHub
  credentials for the normal test suite") — 401/404/400, `GITHUB_INTEGRATION_NOT_CONFIGURED`
  when the encryption key is unset (this environment's real state, exercised for real, not
  mocked), connect/view/verify/branches/update/disconnect, and an explicit assertion that no
  response body ever contains the raw token.
- **Frontend**: RTL, disconnected/connecting/connected/error states, branch selection,
  disconnect.
- **tests/ (real HTTP integration)**: since this environment has no `GITHUB_TOKEN_ENCRYPTION_KEY`
  configured, the real path exercised is connecting a repository returning the real, honest
  `503 GITHUB_INTEGRATION_NOT_CONFIGURED` — mirroring every prior integration test's shape.

## Docker verification strategy (Milestone 7)

Same volume-wiped rebuild procedure as every prior phase. Confirms the new migration
auto-applies, the API starts and serves every existing route (nothing in this phase touches
`ai-service` or its containers, so Phases 2–5 stay fully functional), and that connecting a
repository through the containerized API returns the real, honest
`GITHUB_INTEGRATION_NOT_CONFIGURED` (since `GITHUB_TOKEN_ENCRYPTION_KEY` is not set in
`docker-compose.yml`, matching this environment's real state — not fabricated as configured).

## Explicit limitations (documented up front)

- OAuth/GitHub App installation are not implemented — PAT is the only supported auth method,
  a deliberate scope decision, not an oversight.
- No real repository connection can be demonstrated end-to-end in this environment, because no
  real user-supplied GitHub PAT exists here and none was invented — only the honest
  not-configured and real-API-failure paths are exercised for real.
- Branch listing/selection has no pagination UI beyond a sane cap on the number of branches
  fetched from GitHub's paginated API.
- No webhook, polling, or automatic re-verification — verification only happens on an explicit
  user action (connect or "Reverify access").
- Nothing from this phase feeds repository content into any later capability — no cloning, no
  file listing, no indexing. Only connection metadata (owner/repo/branch/status) is stored.

## Explicit non-goals (per the user's instructions)

AST parsing, repository indexing, embeddings, retrieval, codebase Q&A, code review, automatic
code generation, automatic task execution, GitHub issue/PR creation, GitHub Actions
integration, additional LLM providers, and any refactor not required for this connection
feature. No later-phase feature will be implemented, scaffolded, or stubbed with fake behavior.

## Milestones

1. Inspect and plan (this document).
2. Prisma schema and migration.
3. GitHub client and service.
4. API endpoints (Node).
5. Frontend repository settings flow.
6. Tests.
7. Docker verification.
8. Documentation.

Same per-milestone discipline as every prior phase: run relevant tests, typecheck, and lint
after each milestone; report exact commands and results; commit only runnable milestones.
