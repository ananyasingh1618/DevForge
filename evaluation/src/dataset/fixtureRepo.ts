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
  /** Phase 13 added "variable" for a module-level exported constant (e.g.
   * MAX_RETRY_ATTEMPTS) — still not a full symbol-kind taxonomy, matching
   * ai-service/app/parsing/parser.py's own real, documented coverage
   * (class/interface/type_alias/function/method; plain variables aren't
   * extracted as symbols there either — see that file's own module
   * docstring). */
  symbolType: "function" | "type" | "variable" | null;
  startLine: number;
  endLine: number;
  /** Phase 13 added "javascript" and "python" — ai-service's real parser
   * already supports all three (see docs/BENCHMARK_EXPANSION_PHASE_PLAN.md). */
  language: "typescript" | "javascript" | "python";
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

  // --- Phase 13, Milestone 13.2: benchmark expansion. New TypeScript
  // chunks exercising parent/neighboring-symbol, data-flow, exact-API-route,
  // exact-variable-name, configuration, and "tests that mention but don't
  // implement a symbol" retrieval categories. See
  // docs/BENCHMARK_EXPANSION_PHASE_PLAN.md.
  { chunkId: "svc-validate-order-items", filePath: "services/orderProcessor.ts", symbolName: "validateOrderItems", symbolType: "function", startLine: 20, endLine: 29, language: "typescript" },
  { chunkId: "svc-calculate-order-total", filePath: "services/orderProcessor.ts", symbolName: "calculateOrderTotal", symbolType: "function", startLine: 35, endLine: 37, language: "typescript" },
  { chunkId: "svc-process-order", filePath: "services/orderProcessor.ts", symbolName: "processOrder", symbolType: "function", startLine: 47, endLine: 53, language: "typescript" },
  { chunkId: "db-find-orders-by-user-id", filePath: "db/orderRepository.ts", symbolName: "findOrdersByUserId", symbolType: "function", startLine: 20, endLine: 22, language: "typescript" },
  { chunkId: "db-find-orders-by-status", filePath: "db/orderRepository.ts", symbolName: "findOrdersByStatus", symbolType: "function", startLine: 28, endLine: 30, language: "typescript" },
  { chunkId: "api-get-order-route", filePath: "api/ordersController.ts", symbolName: "getOrderRoute", symbolType: "function", startLine: 20, endLine: 30, language: "typescript" },
  { chunkId: "api-list-my-orders-route", filePath: "api/ordersController.ts", symbolName: "listMyOrdersRoute", symbolType: "function", startLine: 36, endLine: 38, language: "typescript" },
  { chunkId: "config-max-retry-attempts", filePath: "config/featureFlags.ts", symbolName: "MAX_RETRY_ATTEMPTS", symbolType: "variable", startLine: 6, endLine: 9, language: "typescript" },
  { chunkId: "config-is-feature-enabled", filePath: "config/featureFlags.ts", symbolName: "isFeatureEnabled", symbolType: "function", startLine: 20, endLine: 22, language: "typescript" },
  { chunkId: "utils-normalize-order-payload", filePath: "utils/dataTransform.ts", symbolName: "normalizeOrderPayload", symbolType: "function", startLine: 16, endLine: 29, language: "typescript" },
  { chunkId: "test-verify-password-suite", filePath: "tests/authService.test.ts", symbolName: null, symbolType: null, startLine: 11, endLine: 21, language: "typescript" },
  { chunkId: "test-require-auth-suite", filePath: "tests/authService.test.ts", symbolName: null, symbolType: null, startLine: 23, endLine: 27, language: "typescript" },

  // New JavaScript chunks (plain JS, not TypeScript) — multi-language
  // coverage, mirroring several of the same patterns above and in the
  // original TS fixture set.
  { chunkId: "js-cart-add-item", filePath: "javascript/cart/cartService.js", symbolName: "addItem", symbolType: "function", startLine: 10, endLine: 18, language: "javascript" },
  { chunkId: "js-cart-remove-item", filePath: "javascript/cart/cartService.js", symbolName: "removeItem", symbolType: "function", startLine: 23, endLine: 25, language: "javascript" },
  { chunkId: "js-cart-add-to-cart", filePath: "javascript/cart/index.js", symbolName: "addToCart", symbolType: "function", startLine: 13, endLine: 15, language: "javascript" },
  { chunkId: "js-cart-remove-from-cart", filePath: "javascript/cart/index.js", symbolName: "removeFromCart", symbolType: "function", startLine: 21, endLine: 23, language: "javascript" },
  { chunkId: "js-get-order", filePath: "javascript/orders/orderController.js", symbolName: "getOrder", symbolType: "function", startLine: 11, endLine: 14, language: "javascript" },
  { chunkId: "js-get-owned-order", filePath: "javascript/orders/orderController.js", symbolName: "getOwnedOrder", symbolType: "function", startLine: 20, endLine: 26, language: "javascript" },
  { chunkId: "js-format-price", filePath: "javascript/utils/priceHelpers.js", symbolName: "formatPrice", symbolType: "function", startLine: 8, endLine: 10, language: "javascript" },
  { chunkId: "js-apply-tax", filePath: "javascript/utils/priceHelpers.js", symbolName: "applyTax", symbolType: "function", startLine: 16, endLine: 18, language: "javascript" },
  { chunkId: "js-validate-legacy-token", filePath: "javascript/auth/legacyToken.js", symbolName: "validateLegacyToken", symbolType: "function", startLine: 12, endLine: 14, language: "javascript" },
  { chunkId: "js-log-event", filePath: "javascript/services/logger.js", symbolName: "logEvent", symbolType: "function", startLine: 10, endLine: 14, language: "javascript" },
  { chunkId: "js-find-product-by-sku", filePath: "javascript/db/productRepository.js", symbolName: "findProductBySku", symbolType: "function", startLine: 10, endLine: 13, language: "javascript" },
  { chunkId: "js-find-product-by-name", filePath: "javascript/db/productRepository.js", symbolName: "findProductByName", symbolType: "function", startLine: 20, endLine: 23, language: "javascript" },
  { chunkId: "js-default-timeout-ms", filePath: "javascript/config/env.js", symbolName: "DEFAULT_TIMEOUT_MS", symbolType: "variable", startLine: 6, endLine: 8, language: "javascript" },
  { chunkId: "js-get-feature-flag", filePath: "javascript/config/env.js", symbolName: "getFeatureFlag", symbolType: "function", startLine: 14, endLine: 16, language: "javascript" },

  // New Python chunks.
  { chunkId: "py-calculate-total", filePath: "python/billing/invoices.py", symbolName: "calculate_total", symbolType: "function", startLine: 6, endLine: 8, language: "python" },
  { chunkId: "py-apply-discount", filePath: "python/billing/invoices.py", symbolName: "apply_discount", symbolType: "function", startLine: 11, endLine: 15, language: "python" },
  { chunkId: "py-charge-card", filePath: "python/billing/payments.py", symbolName: "charge_card", symbolType: "function", startLine: 10, endLine: 19, language: "python" },
  { chunkId: "py-refund-payment", filePath: "python/billing/payments.py", symbolName: "refund_payment", symbolType: "function", startLine: 22, endLine: 33, language: "python" },
  { chunkId: "py-generate-jwt", filePath: "python/auth/tokens.py", symbolName: "generate_jwt", symbolType: "function", startLine: 11, endLine: 15, language: "python" },
  { chunkId: "py-verify-jwt", filePath: "python/auth/tokens.py", symbolName: "verify_jwt", symbolType: "function", startLine: 18, endLine: 25, language: "python" },
  { chunkId: "py-get-order-by-id", filePath: "python/db/repository.py", symbolName: "get_order_by_id", symbolType: "function", startLine: 8, endLine: 11, language: "python" },
  { chunkId: "py-get-order-by-customer-email", filePath: "python/db/repository.py", symbolName: "get_order_by_customer_email", symbolType: "function", startLine: 14, endLine: 19, language: "python" },
  { chunkId: "py-validate-email", filePath: "python/utils/validators.py", symbolName: "validate_email", symbolType: "function", startLine: 10, endLine: 13, language: "python" },
  { chunkId: "py-is-strong-password", filePath: "python/utils/validators.py", symbolName: "is_strong_password", symbolType: "function", startLine: 16, endLine: 21, language: "python" },
  { chunkId: "py-deliver-internal", filePath: "python/services/email_service.py", symbolName: "_deliver", symbolType: "function", startLine: 10, endLine: 14, language: "python" },
  { chunkId: "py-send-email-async", filePath: "python/services/email_service.py", symbolName: "send_email_async", symbolType: "function", startLine: 17, endLine: 21, language: "python" },
  { chunkId: "py-test-calculate-total", filePath: "python/tests/test_invoices.py", symbolName: "test_calculate_total_sums_line_items", symbolType: "function", startLine: 10, endLine: 12, language: "python" },
  { chunkId: "py-test-apply-discount", filePath: "python/tests/test_invoices.py", symbolName: "test_apply_discount_reduces_total", symbolType: "function", startLine: 15, endLine: 16, language: "python" },
  { chunkId: "py-max-upload-size-mb", filePath: "python/config/settings.py", symbolName: "MAX_UPLOAD_SIZE_MB", symbolType: "variable", startLine: 10, endLine: 10, language: "python" },
  { chunkId: "py-load-api-key", filePath: "python/config/settings.py", symbolName: "load_api_key", symbolType: "function", startLine: 13, endLine: 18, language: "python" },
  { chunkId: "py-format-currency", filePath: "python/helpers/network_utils.py", symbolName: "format_currency", symbolType: "function", startLine: 9, endLine: 13, language: "python" },
  { chunkId: "py-legacy-get-order-by-id", filePath: "python/legacy/legacy_repository.py", symbolName: "get_order_by_id", symbolType: "function", startLine: 12, endLine: 17, language: "python" },
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
