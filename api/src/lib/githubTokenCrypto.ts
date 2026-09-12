import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.js";
import { AppError } from "./errors.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

/**
 * Reads GITHUB_TOKEN_ENCRYPTION_KEY at call time, not import time — the same
 * lazy-read pattern ai-service's get_anthropic_api_key uses — so the API
 * process still starts and serves every other route with this unset. Its
 * absence is this environment's real, confirmed state (see
 * docs/GITHUB_INTEGRATION_PHASE_PLAN.md), and is surfaced as an honest 503
 * before any GitHub API call is ever made, never a fabricated connection.
 */
function getEncryptionKey(): Buffer {
  if (!env.GITHUB_TOKEN_ENCRYPTION_KEY) {
    throw new AppError(
      503,
      "GITHUB_INTEGRATION_NOT_CONFIGURED",
      "GitHub integration is not configured. Set GITHUB_TOKEN_ENCRYPTION_KEY in the API " +
        "environment to enable connecting a repository.",
    );
  }
  return Buffer.from(env.GITHUB_TOKEN_ENCRYPTION_KEY, "base64");
}

/** True only if the server is actually able to store a token right now —
 * lets callers check the dependency before doing any GitHub API work,
 * mirroring every prior phase's "check the upstream dependency before
 * calling out" ordering. */
export function isGithubIntegrationConfigured(): boolean {
  return Boolean(env.GITHUB_TOKEN_ENCRYPTION_KEY);
}

/** Encrypts a plaintext GitHub PAT for storage. Format: `iv:authTag:ciphertext`,
 * each hex-encoded, so the stored column is self-contained and human-inspectable
 * as "clearly not a token" without decoding — never the plaintext value. */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptToken(stored: string): string {
  const key = getEncryptionKey();
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new AppError(500, "INTERNAL_ERROR", "Stored GitHub token is malformed.");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function lastFourOf(token: string): string {
  return token.slice(-4);
}
