import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * The evaluation dataset's synthetic "indexed codebase" — a small set of
 * real, on-disk TypeScript files under src/dataset/fixtures/, each
 * deliberately written for this dataset (never copied from a real project,
 * never containing a credential, and never touching VoxMind). Chunk
 * boundaries here are hand-authored ground truth, not produced by Phase 7's
 * tree-sitter parser or Phase 8's chunkFile() — see docs/EVALUATION_PHASE_PLAN.md
 * ("Evaluation dataset" section) for why: this dataset needs to be a stable,
 * human-verified ground truth independent of the production chunker's own
 * behavior, so a future change to chunkFile() doesn't silently invalidate it.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export type FixtureChunk = {
  /** Stable id — never reused, never renumbered. Referenced by every case. */
  chunkId: string;
  /** Path relative to src/dataset/fixtures/. */
  filePath: string;
  symbolName: string | null;
  symbolType: "function" | "type" | null;
  startLine: number;
  endLine: number;
  language: "typescript";
};

export const FIXTURE_CHUNKS: FixtureChunk[] = [
  { chunkId: "auth-verify-password", filePath: "auth/session.ts", symbolName: "verifyPassword", symbolType: "function", startLine: 17, endLine: 19, language: "typescript" },
  { chunkId: "auth-require-auth", filePath: "auth/session.ts", symbolName: "requireAuth", symbolType: "function", startLine: 25, endLine: 34, language: "typescript" },
  { chunkId: "db-find-user-by-email", filePath: "db/userRepository.ts", symbolName: "findUserByEmail", symbolType: "function", startLine: 14, endLine: 18, language: "typescript" },
  { chunkId: "db-find-user-by-id", filePath: "db/userRepository.ts", symbolName: "findUserById", symbolType: "function", startLine: 26, endLine: 29, language: "typescript" },
  { chunkId: "api-get-project", filePath: "api/projectsController.ts", symbolName: "getProject", symbolType: "function", startLine: 16, endLine: 23, language: "typescript" },
  { chunkId: "api-get-owned-project", filePath: "api/projectsController.ts", symbolName: "getOwnedProject", symbolType: "function", startLine: 30, endLine: 37, language: "typescript" },
  { chunkId: "errors-parse-webhook-payload", filePath: "errors/errorHandler.ts", symbolName: "parseWebhookPayload", symbolType: "function", startLine: 12, endLine: 18, language: "typescript" },
  { chunkId: "errors-parse-webhook-payload-strict", filePath: "errors/errorHandler.ts", symbolName: "parseWebhookPayloadStrict", symbolType: "function", startLine: 25, endLine: 31, language: "typescript" },
  { chunkId: "config-load-webhook-secret", filePath: "config/config.ts", symbolName: "loadWebhookSecret", symbolType: "function", startLine: 13, endLine: 15, language: "typescript" },
  { chunkId: "config-load-request-timeout-ms", filePath: "config/config.ts", symbolName: "loadRequestTimeoutMs", symbolType: "function", startLine: 22, endLine: 30, language: "typescript" },
  { chunkId: "github-get-default-branch", filePath: "github/githubClient.ts", symbolName: "getDefaultBranch", symbolType: "function", startLine: 12, endLine: 21, language: "typescript" },
  { chunkId: "github-get-default-branch-safe", filePath: "github/githubClient.ts", symbolName: "getDefaultBranchSafe", symbolType: "function", startLine: 28, endLine: 37, language: "typescript" },
  { chunkId: "services-notify-fire-and-forget", filePath: "services/notificationService.ts", symbolName: "notifyUserFireAndForget", symbolType: "function", startLine: 14, endLine: 20, language: "typescript" },
  { chunkId: "services-notify-user", filePath: "services/notificationService.ts", symbolName: "notifyUser", symbolType: "function", startLine: 27, endLine: 38, language: "typescript" },
  // Phase 12, Milestone 6: adversarial chunks added after the ranking
  // improvements in Milestone 3 were designed and tuned, specifically to
  // catch overfitting — see docs/RETRIEVAL_QUALITY_PHASE_PLAN.md.
  { chunkId: "auth-legacy-check-password", filePath: "auth/legacyAuth.ts", symbolName: "checkLegacyPassword", symbolType: "function", startLine: 15, endLine: 17, language: "typescript" },
  { chunkId: "auth-legacy-find-user-by-email", filePath: "auth/legacyAuth.ts", symbolName: "findUserByEmail", symbolType: "function", startLine: 27, endLine: 29, language: "typescript" },
  { chunkId: "utils-security-helpers-format-iso-date", filePath: "utils/securityHelpers.ts", symbolName: "formatIsoDate", symbolType: "function", startLine: 12, endLine: 14, language: "typescript" },
  { chunkId: "services-rate-limiter-allow-request", filePath: "services/rateLimiter.ts", symbolName: "allowRequest", symbolType: "function", startLine: 23, endLine: 38, language: "typescript" },
  // startLine 7/10 (not 1) on these two whole-file chunks deliberately excludes each
  // file's shared dataset-boilerplate header comment (identical prose across every
  // fixture file) — consistent with how the other 14 chunks already start well past
  // their own file's header; including that boilerplate as chunk content was found to
  // dominate lexical-similarity ranking for unrelated queries (see
  // docs/EVALUATION_PHASE_PLAN.md's dataset-authoring notes).
  { chunkId: "utils-math-helpers-file", filePath: "utils/mathHelpers.ts", symbolName: null, symbolType: null, startLine: 7, endLine: 34, language: "typescript" },
  { chunkId: "utils-report-formatter-file", filePath: "utils/reportFormatter.ts", symbolName: "formatReportLine", symbolType: "function", startLine: 10, endLine: 16, language: "typescript" },
];

const contentCache = new Map<string, string[]>();

function fileLines(filePath: string): string[] {
  let lines = contentCache.get(filePath);
  if (!lines) {
    const raw = readFileSync(path.join(FIXTURES_DIR, filePath), "utf-8");
    lines = raw.split("\n");
    contentCache.set(filePath, lines);
  }
  return lines;
}

/** Resolves a chunk's real, on-disk text — read fresh (cached per file) so a
 * hand-edit to a fixture file is always reflected without also having to
 * hand-edit a duplicated content string. */
export function chunkContent(chunk: FixtureChunk): string {
  const lines = fileLines(chunk.filePath);
  return lines.slice(chunk.startLine - 1, chunk.endLine).join("\n");
}

export function getChunk(chunkId: string): FixtureChunk {
  const chunk = FIXTURE_CHUNKS.find((c) => c.chunkId === chunkId);
  if (!chunk) {
    throw new Error(`Unknown fixture chunk id: ${chunkId}`);
  }
  return chunk;
}

export const REPOSITORY_LABEL = "devforge-eval/fixture-repo";
export const BRANCH_LABEL = "main";
export const COMMIT_LABEL = "eval-fixture-0000000000000000000000000000000000000000";
