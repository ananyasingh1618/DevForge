import { z } from "zod";

/**
 * Validated at process startup so a missing/malformed env var fails fast with
 * a clear message instead of surfacing as a confusing runtime error later
 * (Phase 17, Milestone 17.1 — docs/OPERATIONS.md's "Configuration"
 * section). Every field here is documented in `.env.example` and
 * `docs/CONFIGURATION.md`; the two must be kept in sync.
 */
const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  AI_SERVICE_URL: z.string().url().default("http://localhost:8001"),
  // Optional (not required) so the API still starts and serves every other
  // route with this unset — mirrors ANTHROPIC_API_KEY's read-at-call-time,
  // "gate the one feature, never crash the process" pattern. Must decode to
  // exactly 32 bytes (AES-256-GCM key length); see lib/githubTokenCrypto.ts.
  GITHUB_TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, {
      message: "GITHUB_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    })
    .optional(),
  // Structured-log verbosity (Phase 17, Milestone 17.5 — lib/logger.ts).
  // "warn"/"error" are the sensible production defaults so routine request
  // logs don't drown out real problems; "info" is useful in development.
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Postgres connection-pool sizing (Milestone 17.3 — lib/prisma.ts).
  // Conservative defaults sized for this project's own actual traffic
  // shape (a handful of concurrent requests plus one in-process job
  // worker per API instance), not a guessed-large production number.
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

/** Well-known, obviously-copy-pasted-from-an-example placeholder values
 * that must never reach a real deployment — every value this project's own
 * `.env.example`/test config has ever suggested as a "replace me" default.
 * Catches the single most common production-misconfiguration mistake
 * (copying `.env.example` verbatim into a real deployment's environment)
 * with a clear startup failure instead of a silently insecure server.
 *
 * Deliberately a precise, exact-match blocklist of specific known strings
 * — not a broader heuristic like "rejects anything mentioning localhost"
 * — because this project's own supported local production-like deployment
 * (docker-compose.yml, `docs/DEPLOYMENT.md`) legitimately runs with
 * `NODE_ENV=production` on localhost, using its own dedicated compose-only
 * secret (not copied from anywhere else). A heuristic broad enough to
 * catch "forgot to change the example" would also incorrectly reject that
 * entirely legitimate, intentional local deployment — an exact-match
 * blocklist catches the real mistake (copy-paste) without that false
 * positive. */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "replace-with-a-random-64-char-hex-string",
  "test-only-session-secret-not-for-production-000000",
]);

// Exported (not just used internally by loadEnv()) so env.test.ts can call
// `envSchema.safeParse(...)` directly against arbitrary input objects —
// verifying the production guardrails below without touching the real
// `process.env` or triggering loadEnv()'s own `process.exit(1)`.
export const envSchema = baseEnvSchema.superRefine((data, ctx) => {
  if (data.NODE_ENV !== "production") return;

  // Production-only guardrails (Milestone 17.1): a real deployment must
  // never accidentally run with a development placeholder secret or point
  // at a database whose own name marks it as a test/throwaway instance.
  if (KNOWN_PLACEHOLDER_SECRETS.has(data.SESSION_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SESSION_SECRET"],
      message:
        "SESSION_SECRET is a known development/example placeholder. Generate a real secret " +
        "for production with: openssl rand -hex 32",
    });
  }
  if (/\/devforge_test(\?|$)/.test(data.DATABASE_URL)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DATABASE_URL"],
      message:
        "DATABASE_URL points at devforge_test (the dedicated unit-test database) while " +
        "NODE_ENV=production. Refusing to start against a test database in production.",
    });
  }
});

export type Env = z.infer<typeof baseEnvSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === "production";
