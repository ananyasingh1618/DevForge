import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["tests/**"],
    // Test files share one real Postgres database (see below) and each
    // cleans up via beforeEach/afterAll; running files in parallel lets one
    // file's cleanup race another file's assertions. Sequential is slower
    // but correct — the test count here doesn't yet justify per-file DB
    // isolation.
    fileParallelism: false,
    // Fake, non-secret values so env validation passes in unit tests without
    // needing a real .env file. Tests that need a real database (Milestone 7+)
    // point DATABASE_URL at a dedicated test database instead.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://devforge:devforge@localhost:5433/devforge_test",
      SESSION_SECRET: "test-only-session-secret-not-for-production-000000",
      FRONTEND_ORIGIN: "http://localhost:5173",
    },
  },
});
