import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "./errors.js";

// env.js's `env` export is a plain object read at call time (not destructured
// at import) by githubTokenCrypto.ts, so mutating env.GITHUB_TOKEN_ENCRYPTION_KEY
// directly between tests is a safe, isolated way to flip "configured" vs
// "unconfigured" without touching real env vars or needing vi.mock.
describe("githubTokenCrypto", () => {
  beforeEach(async () => {
    const { env } = await import("../env.js");
    env.GITHUB_TOKEN_ENCRYPTION_KEY = undefined;
  });

  afterEach(async () => {
    const { env } = await import("../env.js");
    env.GITHUB_TOKEN_ENCRYPTION_KEY = undefined;
  });

  it("isGithubIntegrationConfigured is false when the key is unset (this environment's real state)", async () => {
    const { isGithubIntegrationConfigured } = await import("./githubTokenCrypto.js");
    expect(isGithubIntegrationConfigured()).toBe(false);
  });

  it("encryptToken throws GITHUB_INTEGRATION_NOT_CONFIGURED when the key is unset", async () => {
    const { encryptToken } = await import("./githubTokenCrypto.js");
    try {
      encryptToken("ghp_whatever");
      throw new Error("expected encryptToken to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(503);
      expect((err as AppError).code).toBe("GITHUB_INTEGRATION_NOT_CONFIGURED");
    }
  });

  describe("with a key configured", () => {
    beforeEach(async () => {
      const { env } = await import("../env.js");
      env.GITHUB_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    });

    it("isGithubIntegrationConfigured is true", async () => {
      const { isGithubIntegrationConfigured } = await import("./githubTokenCrypto.js");
      expect(isGithubIntegrationConfigured()).toBe(true);
    });

    it("round-trips a token exactly", async () => {
      const { encryptToken, decryptToken } = await import("./githubTokenCrypto.js");
      const plaintext = "ghp_fakeButRealisticallyShapedToken1234567890";
      const encrypted = encryptToken(plaintext);
      expect(decryptToken(encrypted)).toBe(plaintext);
    });

    it("never stores the plaintext token inside the ciphertext string", async () => {
      const { encryptToken } = await import("./githubTokenCrypto.js");
      const plaintext = "ghp_fakeButRealisticallyShapedToken1234567890";
      const encrypted = encryptToken(plaintext);
      expect(encrypted.includes(plaintext)).toBe(false);
    });

    it("produces a different ciphertext for the same plaintext each time (random IV)", async () => {
      const { encryptToken } = await import("./githubTokenCrypto.js");
      const plaintext = "ghp_sameTokenEncryptedTwice";
      expect(encryptToken(plaintext)).not.toBe(encryptToken(plaintext));
    });

    it("rejects a tampered ciphertext (GCM auth tag)", async () => {
      const { encryptToken, decryptToken } = await import("./githubTokenCrypto.js");
      const encrypted = encryptToken("ghp_someToken");
      const parts = encrypted.split(":");
      const tampered = `${parts[0]}:${parts[1]}:${(parts[2] as string).slice(0, -2)}00`;
      expect(() => decryptToken(tampered)).toThrow();
    });

    it("lastFourOf returns the real last four characters", async () => {
      const { lastFourOf } = await import("./githubTokenCrypto.js");
      expect(lastFourOf("ghp_abcdWXYZ")).toBe("WXYZ");
    });
  });
});
