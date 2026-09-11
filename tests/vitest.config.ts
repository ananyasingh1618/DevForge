import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // These tests hit a real running server (not an in-process app instance)
    // and can involve several sequential HTTP round-trips plus a first-run
    // server warm-up, so give them more room than the fast unit-test suites.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
