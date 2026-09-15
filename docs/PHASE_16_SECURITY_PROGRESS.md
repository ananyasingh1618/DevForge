# DevForge Phase 16 (Security, Permissions, and Multi-User Isolation) — Progress Log

## Milestone 16.1 — Security architecture

Inspected the current authentication and authorization model end to end (auth middleware, every
project-scoped service's ownership checks, error behavior, GitHub token handling, rate limiting,
CORS/CSRF, existing cross-user tests) before writing any design. Full findings and the resulting
design decisions are in `docs/PHASE_16_SECURITY_PLAN.md`.

**Headline finding**: authentication does not imply authorization in this codebase, and it already
doesn't — every project-scoped service independently re-checks resource ownership rather than
trusting `requireAuth` alone, consistently returns 404 (never 403) on an ownership failure, and this
is backed by existing cross-user tests on nearly every resource type. This meant Milestone 16.1's
job was to find the *real* remaining gaps rather than assume the worst — inflating already-sound
areas with unnecessary rework would violate this phase's own "do not introduce unnecessary
infrastructure" instruction (Phase 15's own framing, carried forward here).

**Real gaps found** (see the plan doc's full list): no rate limiting anywhere, no CSRF token layer,
`EvaluationRun` has no ownership model (by original design, needs an explicit documented decision
rather than silence), ownership-check logic duplicated per service file rather than centralized, no
independent route-level authorization layer (only service-level), no repository-content/path-
traversal/archive-abuse audit yet, no dedicated secret-pattern test suite, no audit logging.

Commit: `<pending>`
