/**
 * Retrieval evaluation cases — see docs/EVALUATION_PHASE_PLAN.md for the
 * retrieval metrics computed from these. `expectedChunkIds` are the chunks a
 * correct retrieval MUST surface for the case to count as a hit;
 * `acceptableAlternativeChunkIds` are chunks that would also be a reasonable
 * answer and must not be penalized as false positives if returned instead of
 * (or alongside) an expected chunk, but do not themselves count toward
 * recall.
 *
 * Phase 13 (docs/BENCHMARK_EXPANSION_PHASE_PLAN.md, Milestone 13.3) adds
 * graded relevance on top of this binary-ish model, entirely via optional
 * fields with safe defaults — every Phase 11/12 case above works unchanged
 * with zero edits:
 *   - `directSourceChunkIds` (relevance grade 2, "directly answers the
 *     query") defaults to `expectedChunkIds`.
 *   - `supportingSourceChunkIds` (grade 1, "useful context, not itself the
 *     answer") defaults to `acceptableAlternativeChunkIds`.
 *   - `irrelevantExampleChunkIds` (grade 0, explicit known-irrelevant
 *     examples) defaults to `[]`.
 *   - `category`/`language`/`difficulty`/`answerable`/
 *     `requiresCrossFileContext`/`expectedMinEvidence`/
 *     `expectedMaxUsefulContext` are reporting/audit metadata with safe
 *     defaults (see retrievalEvaluator.ts's `gradedCase()` for the exact
 *     defaulting logic) — omitting them on a legacy case never changes its
 *     pass/fail outcome, only what it's grouped under in a per-category/
 *     per-language/per-difficulty breakdown.
 */

export type RetrievalCategory =
  | "exact-function-name"
  | "exact-class-name"
  | "exact-variable-name"
  | "exact-api-route"
  | "natural-language-behavior"
  | "cross-file-dependency"
  | "imported-function"
  | "database-access"
  | "error-handling"
  | "auth-authz"
  | "configuration"
  | "tests"
  | "utility-function"
  | "similar-symbol-names"
  | "same-symbol-different-file"
  | "misleading-filename"
  | "no-exact-identifier"
  | "vague-wording"
  | "requires-supporting-context"
  | "insufficient-evidence"
  | "single-relevant-result"
  | "multiple-relevant-results"
  | "parent-symbol"
  | "neighboring-symbol"
  | "data-flow";

export type RetrievalCase = {
  id: string;
  query: string;
  expectedChunkIds: string[];
  acceptableAlternativeChunkIds: string[];
  notes: string;
  /** Grade-2 sources ("directly answers"). Defaults to expectedChunkIds. */
  directSourceChunkIds?: string[];
  /** Grade-1 sources ("useful supporting context"). Defaults to
   * acceptableAlternativeChunkIds. */
  supportingSourceChunkIds?: string[];
  /** Grade-0 sources explicitly asserted irrelevant. Defaults to []. */
  irrelevantExampleChunkIds?: string[];
  category?: RetrievalCategory;
  language?: "typescript" | "javascript" | "python" | "mixed";
  difficulty?: "easy" | "medium" | "hard";
  /** False for a case with no real answer in the fixture (an insufficient-
   * evidence case) — defaults to true. */
  answerable?: boolean;
  requiresCrossFileContext?: boolean;
  /** Minimum number of grade-2/1 sources a correct retrieval should surface
   * — defaults to expectedChunkIds.length || 0. */
  expectedMinEvidence?: number;
  /** Above this many results, additional context is not considered useful
   * for this query — defaults to 5 (TOP_K). */
  expectedMaxUsefulContext?: number;
};

export const RETRIEVAL_CASES: RetrievalCase[] = [
  {
    id: "retrieval-password-check",
    query: "Where is the user's password checked during login?",
    expectedChunkIds: ["auth-verify-password"],
    acceptableAlternativeChunkIds: ["auth-require-auth"],
    notes: "Primary match is the password comparison itself, not the session guard around it.",
    category: "auth-authz",
    language: "typescript",
    difficulty: "easy",
  },
  {
    id: "retrieval-find-user-by-email",
    query: "How does DevForge look up a user by their email address in the database?",
    expectedChunkIds: ["db-find-user-by-email"],
    acceptableAlternativeChunkIds: ["db-find-user-by-id"],
    notes: "",
    category: "database-access",
    language: "typescript",
    difficulty: "easy",
  },
  {
    id: "retrieval-sql-injection",
    // NOTE (Phase 13 ground-truth correction — see
    // docs/BENCHMARK_EXPANSION_PHASE_PLAN.md's "Anti-overfitting controls"
    // and the identical precedent set for retrieval-vague-wording in Phase
    // 12): this query named no language, and originally had exactly one
    // possible SQL-injection example in the whole dataset. Milestone 13.2
    // added equivalent, equally-real SQL-injection examples in Python and
    // JavaScript, which made the query genuinely ambiguous across three
    // correct answers — broadened to match, exactly as retrieval-vague-
    // wording was broadened in Phase 12 for the same reason. This is a
    // ground-truth correction reflecting the benchmark's own growth, not an
    // evaluator weakening: the case still fails if retrieval surfaces none
    // of the three genuine SQL-injection examples.
    query: "Where might a SQL injection vulnerability exist in the database access code?",
    expectedChunkIds: ["db-find-user-by-email", "py-get-order-by-customer-email", "js-find-product-by-name"],
    acceptableAlternativeChunkIds: [],
    notes: "The email lookup builds SQL via string concatenation; the id lookup is parameterized and should not be the top match.",
    category: "database-access",
    language: "mixed",
    difficulty: "medium",
  },
  {
    id: "retrieval-missing-ownership-check",
    query: "Which function returns a project without checking that the requester owns it?",
    expectedChunkIds: ["api-get-project"],
    acceptableAlternativeChunkIds: ["api-get-owned-project"],
    notes: "getOwnedProject is the safe counterpart and a reasonable alternative match, not the primary target.",
    category: "auth-authz",
    language: "typescript",
    difficulty: "medium",
  },
  {
    id: "retrieval-webhook-parse-errors",
    query: "How are errors handled when parsing a webhook payload?",
    expectedChunkIds: ["errors-parse-webhook-payload"],
    acceptableAlternativeChunkIds: ["errors-parse-webhook-payload-strict"],
    notes: "",
    category: "error-handling",
    language: "typescript",
    difficulty: "easy",
  },
  {
    id: "retrieval-webhook-secret-config",
    query: "Where is the webhook signing secret loaded from an environment variable?",
    expectedChunkIds: ["config-load-webhook-secret"],
    acceptableAlternativeChunkIds: [],
    notes: "",
    category: "configuration",
    language: "typescript",
    difficulty: "easy",
  },
  {
    id: "retrieval-github-default-branch",
    query: "Where does the GitHub client fetch a repository's default branch?",
    expectedChunkIds: ["github-get-default-branch", "github-get-default-branch-safe"],
    acceptableAlternativeChunkIds: [],
    notes: "Both implementations answer this query equally well; either counts as a hit.",
    category: "multiple-relevant-results",
    language: "typescript",
    difficulty: "easy",
  },
  {
    id: "retrieval-fire-and-forget-notifications",
    query: "How does DevForge send a user notification without waiting for the response?",
    expectedChunkIds: ["services-notify-fire-and-forget"],
    acceptableAlternativeChunkIds: ["services-notify-user"],
    notes: "",
    category: "error-handling",
    language: "typescript",
    difficulty: "hard",
  },
  {
    id: "retrieval-round-decimal-places",
    query: "Where are numbers rounded to a fixed number of decimal places?",
    expectedChunkIds: ["utils-math-helpers-file"],
    acceptableAlternativeChunkIds: [],
    notes: "Exercises retrieval over the dataset's one clean, no-findings file.",
    category: "utility-function",
    language: "typescript",
    difficulty: "easy",
  },
  // --- Phase 12, Milestone 6: adversarial cases, added after Milestone 3's
  // ranking improvements were implemented and tuned, to catch overfitting.
  // See docs/RETRIEVAL_QUALITY_PHASE_PLAN.md ("Anti-overfitting strategy").
  {
    id: "retrieval-similar-symbol-disambiguation",
    query: "Where is the legacy password check function used for old session records?",
    expectedChunkIds: ["auth-legacy-check-password"],
    acceptableAlternativeChunkIds: [],
    notes:
      "Adversarial: auth-verify-password is a similarly-named, similarly-purposed function in " +
      "a different file — the query's own wording ('legacy', 'old session records') is the only " +
      "thing that should disambiguate which one is meant.",
    category: "similar-symbol-names",
    language: "typescript",
    difficulty: "hard",
  },
  {
    id: "retrieval-same-identifier-different-file",
    query: "How does the legacy admin panel look up a user by email?",
    expectedChunkIds: ["auth-legacy-find-user-by-email"],
    acceptableAlternativeChunkIds: [],
    notes:
      "Adversarial: db-find-user-by-email is a function with the exact same name in a different " +
      "file, for an unrelated purpose — the query's own wording ('admin panel') is the only " +
      "thing that should disambiguate which same-named function is meant.",
    category: "same-symbol-different-file",
    language: "typescript",
    difficulty: "hard",
  },
  {
    id: "retrieval-misleading-filename",
    query: "Where is a date formatted as an ISO date string?",
    expectedChunkIds: ["utils-security-helpers-format-iso-date"],
    acceptableAlternativeChunkIds: [],
    notes:
      "Adversarial: the file is named securityHelpers.ts despite having nothing to do with " +
      "security — tests that retrieval follows actual content, not a suggestive filename.",
    category: "misleading-filename",
    language: "typescript",
    difficulty: "medium",
  },
  {
    id: "retrieval-vague-wording",
    query: "something about checking if two things match",
    // Deliberately vague on purpose — any of these three genuinely
    // plausible candidates counts as a reasonable hit; unlike every other
    // case in this dataset, there is no single sharp right answer to force.
    expectedChunkIds: ["auth-verify-password", "auth-legacy-check-password", "auth-require-auth"],
    acceptableAlternativeChunkIds: [],
    notes: "Adversarial: deliberately vague, underspecified query — recall is satisfied by any one of several genuinely plausible candidates.",
    category: "vague-wording",
    language: "typescript",
    difficulty: "hard",
  },
  {
    id: "retrieval-exact-identifier-query",
    query: "checkLegacyPassword",
    expectedChunkIds: ["auth-legacy-check-password"],
    acceptableAlternativeChunkIds: [],
    notes: "Adversarial: the query is nothing but a raw identifier — directly exercises exactIdentifierBoost.",
    category: "exact-function-name",
    language: "typescript",
    difficulty: "easy",
  },

  // --- Phase 13, Milestone 13.2: benchmark expansion. New cases covering
  // every category in docs/BENCHMARK_EXPANSION_PHASE_PLAN.md, drawn across
  // TypeScript, JavaScript, and Python. See fixtureRepo.ts for the chunks
  // referenced below.
  {
    id: "retrieval-exact-class-name-session-user",
    query: "SessionUser",
    expectedChunkIds: ["auth-verify-password"],
    acceptableAlternativeChunkIds: ["auth-require-auth"],
    notes: "The query is the exact name of the SessionUser type both functions operate on; either function in session.ts is a reasonable top match.",
    category: "exact-class-name",
    language: "typescript",
    difficulty: "medium",
  },
  {
    id: "retrieval-exact-variable-name-max-retry",
    query: "MAX_RETRY_ATTEMPTS",
    expectedChunkIds: ["config-max-retry-attempts"],
    acceptableAlternativeChunkIds: [],
    notes: "Raw exact-identifier query for a module-level constant, not a function.",
    category: "exact-variable-name",
    language: "typescript",
    difficulty: "easy",
  },
  {
    id: "retrieval-exact-variable-name-max-upload-size",
    query: "MAX_UPLOAD_SIZE_MB",
    expectedChunkIds: ["py-max-upload-size-mb"],
    acceptableAlternativeChunkIds: [],
    notes: "Same exact-variable-name category, Python file.",
    category: "exact-variable-name",
    language: "python",
    difficulty: "easy",
  },
  {
    id: "retrieval-exact-variable-name-default-timeout",
    query: "DEFAULT_TIMEOUT_MS",
    expectedChunkIds: ["js-default-timeout-ms"],
    acceptableAlternativeChunkIds: [],
    notes: "Same exact-variable-name category, JavaScript file.",
    category: "exact-variable-name",
    language: "javascript",
    difficulty: "easy",
  },
  {
    id: "retrieval-exact-api-route-get-order",
    query: "GET /api/orders/:id",
    expectedChunkIds: ["api-get-order-route"],
    acceptableAlternativeChunkIds: ["api-list-my-orders-route"],
    notes: "Query is a literal route string, exercising the exact-API-route category.",
    category: "exact-api-route",
    language: "typescript",
    difficulty: "medium",
  },
  {
    id: "retrieval-natural-language-order-total",
    query: "How does DevForge calculate the total price of an order's line items?",
    expectedChunkIds: ["svc-calculate-order-total"],
    acceptableAlternativeChunkIds: ["py-calculate-total"],
    notes: "Natural-language behavior question with a clear single best TypeScript answer.",
    category: "natural-language-behavior",
    language: "typescript",
    difficulty: "easy",
  },
  {
    id: "retrieval-natural-language-strong-password",
    query: "What makes a password considered strong enough to accept?",
    expectedChunkIds: ["py-is-strong-password"],
    acceptableAlternativeChunkIds: [],
    notes: "Natural-language behavior question, Python.",
    category: "natural-language-behavior",
    language: "python",
    difficulty: "easy",
  },
  {
    id: "retrieval-cross-file-cart-public-api",
    query: "What is the public entry point for adding an item to the shopping cart, and what does it delegate to?",
    expectedChunkIds: ["js-cart-add-to-cart"],
    acceptableAlternativeChunkIds: ["js-cart-add-item"],
    supportingSourceChunkIds: ["js-cart-add-item"],
    notes: "index.js's addToCart is a thin wrapper around cartService's addItem — a genuine cross-file dependency.",
    category: "cross-file-dependency",
    language: "javascript",
    difficulty: "medium",
    requiresCrossFileContext: true,
  },
  {
    id: "retrieval-imported-function-order-repository",
    query: "Which function does orderProcessor import to load a user's existing orders?",
    expectedChunkIds: ["db-find-orders-by-user-id"],
    acceptableAlternativeChunkIds: ["svc-process-order"],
    notes: "processOrder imports and calls findOrdersByUserId from a different file.",
    category: "imported-function",
    language: "typescript",
    difficulty: "medium",
    requiresCrossFileContext: true,
  },
  {
    id: "retrieval-database-access-orders-by-status",
    query: "How does the admin dashboard load every order in a given status?",
    expectedChunkIds: ["db-find-orders-by-status"],
    acceptableAlternativeChunkIds: ["db-find-orders-by-user-id"],
    notes: "",
    category: "database-access",
    language: "typescript",
    difficulty: "easy",
  },
  {
    id: "retrieval-database-access-python-injection",
    query: "Is there a SQL injection risk when looking up orders by customer email in the Python code?",
    expectedChunkIds: ["py-get-order-by-customer-email"],
    acceptableAlternativeChunkIds: [],
    notes: "Python counterpart to retrieval-sql-injection; get_order_by_id is parameterized and should not be the top match.",
    category: "database-access",
    language: "python",
    difficulty: "medium",
  },
  {
    id: "retrieval-error-handling-charge-card",
    query: "Does charging a card handle a failed payment gateway response?",
    expectedChunkIds: ["py-charge-card"],
    acceptableAlternativeChunkIds: ["py-refund-payment"],
    notes: "charge_card has no error handling around the external call; refund_payment does and is a reasonable alternative to compare against.",
    category: "error-handling",
    language: "python",
    difficulty: "medium",
  },
  {
    id: "retrieval-error-handling-email-delivery",
    query: "What happens if sending an email fails in the background task?",
    expectedChunkIds: ["py-send-email-async"],
    acceptableAlternativeChunkIds: ["py-deliver-internal"],
    notes: "",
    category: "error-handling",
    language: "python",
    difficulty: "medium",
  },
  {
    id: "retrieval-authz-legacy-jwt-fallback",
    query: "What secret is used to verify a JWT if the JWT_SECRET environment variable isn't set?",
    expectedChunkIds: ["py-verify-jwt"],
    acceptableAlternativeChunkIds: ["py-generate-jwt"],
    notes: "verify_jwt falls back to a hardcoded weak secret; generate_jwt does not and is the safe counterpart.",
    category: "auth-authz",
    language: "python",
    difficulty: "medium",
  },
  {
    id: "retrieval-authz-legacy-token-comparison",
    query: "How is a legacy API token validated, and is the comparison timing-safe?",
    expectedChunkIds: ["js-validate-legacy-token"],
    acceptableAlternativeChunkIds: [],
    notes: "JavaScript counterpart to the TypeScript timing-attack pattern in auth/session.ts.",
    category: "auth-authz",
    language: "javascript",
    difficulty: "medium",
  },
  {
    id: "retrieval-configuration-feature-flag",
    query: "How does DevForge check whether a named feature flag is enabled?",
    expectedChunkIds: ["config-is-feature-enabled"],
    acceptableAlternativeChunkIds: ["js-get-feature-flag"],
    notes: "TypeScript and JavaScript both implement a feature-flag check; the TS one is the primary target for this exact wording.",
    category: "configuration",
    language: "typescript",
    difficulty: "easy",
  },
  {
    id: "retrieval-configuration-api-key-load",
    query: "What happens if the third-party API key environment variable is missing?",
    expectedChunkIds: ["py-load-api-key"],
    acceptableAlternativeChunkIds: [],
    notes: "Python counterpart to retrieval-webhook-secret-config's silently-undefined pattern.",
    category: "configuration",
    language: "python",
    difficulty: "medium",
  },
  {
    id: "retrieval-tests-verify-password-suite",
    // NOTE (Phase 13 ground-truth correction, found during the case's own
    // first live evaluation run): a query naming a function and asking
    // about "test cases" is genuinely well-served by either the test suite
    // itself OR the real implementation (a user asking this would likely
    // find the implementation useful too, not just its tests) — the
    // original single-answer design was too strict for what this query
    // actually asks. Broadened rather than tuning the ranker to force a
    // preference for test-file-over-implementation that isn't actually a
    // well-justified requirement.
    query: "What test cases exist for verifyPassword's return value?",
    expectedChunkIds: ["test-verify-password-suite", "auth-verify-password"],
    acceptableAlternativeChunkIds: [],
    notes: "The test suite and the real implementation are both reasonable direct answers to this wording.",
    category: "tests",
    language: "typescript",
    difficulty: "medium",
  },
  {
    id: "retrieval-tests-mention-not-implement",
    query: "Where is calculate_total implemented in Python?",
    expectedChunkIds: ["py-calculate-total"],
    acceptableAlternativeChunkIds: [],
    irrelevantExampleChunkIds: ["py-test-calculate-total"],
    notes:
      "Adversarial: python/tests/test_invoices.py mentions and calls calculate_total but does not " +
      "implement it — the real implementation in billing/invoices.py must be the top match, not the test.",
    category: "tests",
    language: "python",
    difficulty: "hard",
  },
  {
    id: "retrieval-utility-format-price",
    query: "How is a price in cents formatted as a dollar string?",
    expectedChunkIds: ["js-format-price"],
    acceptableAlternativeChunkIds: ["py-format-currency"],
    notes: "",
    category: "utility-function",
    language: "javascript",
    difficulty: "easy",
  },
  {
    id: "retrieval-utility-apply-tax",
    query: "applyTax",
    expectedChunkIds: ["js-apply-tax"],
    acceptableAlternativeChunkIds: [],
    notes: "Raw exact-identifier query, JavaScript.",
    category: "exact-function-name",
    language: "javascript",
    difficulty: "easy",
  },
  {
    id: "retrieval-similar-symbol-get-vs-find-order",
    query: "Which function fetches a single order by its id using a parameterized query in Python?",
    expectedChunkIds: ["py-get-order-by-id"],
    acceptableAlternativeChunkIds: [],
    irrelevantExampleChunkIds: ["py-legacy-get-order-by-id"],
    notes:
      "Adversarial: python/legacy/legacy_repository.py has a same-named get_order_by_id with an " +
      "unrelated in-memory implementation — the query's own wording ('parameterized query') should " +
      "disambiguate which one is meant.",
    category: "similar-symbol-names",
    language: "python",
    difficulty: "hard",
  },
  {
    id: "retrieval-same-symbol-legacy-order-lookup",
    query: "How does the old in-memory legacy order store look up an order by id?",
    expectedChunkIds: ["py-legacy-get-order-by-id"],
    acceptableAlternativeChunkIds: [],
    irrelevantExampleChunkIds: ["py-get-order-by-id"],
    notes: "Adversarial counterpart to retrieval-similar-symbol-get-vs-find-order — same two chunks, opposite intended target.",
    category: "same-symbol-different-file",
    language: "python",
    difficulty: "hard",
  },
  {
    id: "retrieval-misleading-filename-currency",
    query: "Where is a currency amount formatted as a dollar-sign string?",
    expectedChunkIds: ["py-format-currency"],
    acceptableAlternativeChunkIds: ["js-format-price"],
    notes: "Adversarial: lives in network_utils.py despite having nothing to do with networking.",
    category: "misleading-filename",
    language: "python",
    difficulty: "medium",
  },
  {
    id: "retrieval-no-exact-identifier-cart-merge",
    query: "What happens when you add a product that's already in someone's shopping cart?",
    expectedChunkIds: ["js-cart-add-item"],
    acceptableAlternativeChunkIds: ["js-cart-add-to-cart"],
    notes: "No exact identifier named anywhere in the query.",
    category: "no-exact-identifier",
    language: "javascript",
    difficulty: "medium",
  },
  {
    id: "retrieval-no-exact-identifier-discount",
    query: "Where does a percentage get taken off an invoice total?",
    expectedChunkIds: ["py-apply-discount"],
    acceptableAlternativeChunkIds: [],
    notes: "No exact identifier named anywhere in the query.",
    category: "no-exact-identifier",
    language: "python",
    difficulty: "medium",
  },
  {
    id: "retrieval-vague-wording-validation",
    query: "something that checks if input looks right before using it",
    expectedChunkIds: ["py-validate-email", "py-is-strong-password", "svc-validate-order-items"],
    acceptableAlternativeChunkIds: [],
    notes: "Deliberately vague — any of these three genuinely plausible validation-style candidates counts as a hit.",
    category: "vague-wording",
    language: "mixed",
    difficulty: "hard",
  },
  {
    id: "retrieval-supporting-context-process-order",
    query: "Walk me through everything that happens when an order is processed, from raw payload to total.",
    expectedChunkIds: ["svc-process-order"],
    acceptableAlternativeChunkIds: ["utils-normalize-order-payload", "svc-validate-order-items", "svc-calculate-order-total"],
    supportingSourceChunkIds: ["utils-normalize-order-payload", "svc-validate-order-items", "svc-calculate-order-total"],
    notes: "The parent orchestrator is the direct answer; its three called helpers are useful supporting context, not themselves the primary target.",
    category: "requires-supporting-context",
    language: "typescript",
    difficulty: "hard",
    requiresCrossFileContext: true,
    expectedMinEvidence: 1,
  },
  {
    id: "retrieval-insufficient-evidence-two-factor",
    query: "Where is two-factor authentication verified during login?",
    expectedChunkIds: [],
    acceptableAlternativeChunkIds: [],
    notes: "No two-factor-auth code exists anywhere in the fixture dataset — a correct system returns no confident match.",
    category: "insufficient-evidence",
    language: "mixed",
    difficulty: "hard",
    answerable: false,
    expectedMinEvidence: 0,
  },
  {
    id: "retrieval-insufficient-evidence-graphql",
    query: "How does DevForge implement its GraphQL API layer?",
    expectedChunkIds: [],
    acceptableAlternativeChunkIds: [],
    notes: "No GraphQL code exists anywhere in the fixture dataset.",
    category: "insufficient-evidence",
    language: "mixed",
    difficulty: "hard",
    answerable: false,
    expectedMinEvidence: 0,
  },
  {
    id: "retrieval-single-relevant-clamp",
    query: "clamp",
    expectedChunkIds: ["utils-math-helpers-file"],
    acceptableAlternativeChunkIds: [],
    notes: "Raw exact-identifier query with exactly one truly relevant chunk in the whole dataset.",
    category: "single-relevant-result",
    language: "typescript",
    difficulty: "easy",
  },
  {
    id: "retrieval-single-relevant-refund",
    query: "refund_payment",
    expectedChunkIds: ["py-refund-payment"],
    acceptableAlternativeChunkIds: [],
    notes: "",
    category: "single-relevant-result",
    language: "python",
    difficulty: "easy",
  },
  {
    id: "retrieval-multiple-relevant-order-repository",
    query: "What database queries exist for loading a user's orders?",
    expectedChunkIds: ["db-find-orders-by-user-id", "db-find-orders-by-status"],
    acceptableAlternativeChunkIds: [],
    notes: "Both functions in orderRepository.ts are genuinely relevant to this broader query.",
    category: "multiple-relevant-results",
    language: "typescript",
    difficulty: "medium",
    expectedMinEvidence: 2,
  },
  {
    id: "retrieval-multiple-relevant-cart-service",
    query: "What operations does the cart service support?",
    expectedChunkIds: ["js-cart-add-item", "js-cart-remove-item"],
    acceptableAlternativeChunkIds: ["js-cart-add-to-cart", "js-cart-remove-from-cart"],
    notes: "Both cartService functions are genuinely relevant.",
    category: "multiple-relevant-results",
    language: "javascript",
    difficulty: "medium",
    expectedMinEvidence: 2,
  },
  {
    id: "retrieval-parent-symbol-order-processing",
    query: "What function orchestrates order processing from validation through total calculation?",
    expectedChunkIds: ["svc-process-order"],
    acceptableAlternativeChunkIds: ["svc-validate-order-items", "svc-calculate-order-total"],
    supportingSourceChunkIds: ["svc-validate-order-items", "svc-calculate-order-total"],
    notes: "processOrder is the parent orchestrator; the two functions it calls are neighboring helpers, not the primary target.",
    category: "parent-symbol",
    language: "typescript",
    difficulty: "medium",
  },
  {
    id: "retrieval-neighboring-symbol-validate-items",
    query: "How does DevForge validate order line items before processing an order?",
    expectedChunkIds: ["svc-validate-order-items"],
    acceptableAlternativeChunkIds: ["svc-process-order"],
    notes: "The specific validation step is the direct target; the parent orchestrator is reasonable supporting context.",
    category: "neighboring-symbol",
    language: "typescript",
    difficulty: "medium",
  },
  {
    id: "retrieval-neighboring-symbol-deliver-internal",
    query: "What internal helper actually opens the network connection to send an email?",
    expectedChunkIds: ["py-deliver-internal"],
    acceptableAlternativeChunkIds: ["py-send-email-async"],
    notes: "_deliver is the private neighboring helper send_email_async schedules but never awaits.",
    category: "neighboring-symbol",
    language: "python",
    difficulty: "medium",
  },
  {
    id: "retrieval-data-flow-normalize-to-process",
    query: "How does a raw, untyped order payload get normalized before its total is calculated?",
    expectedChunkIds: ["utils-normalize-order-payload"],
    acceptableAlternativeChunkIds: ["svc-process-order", "svc-calculate-order-total"],
    supportingSourceChunkIds: ["svc-process-order"],
    notes: "normalizeOrderPayload's output flows directly into processOrder's own calls to validateOrderItems/calculateOrderTotal.",
    category: "data-flow",
    language: "typescript",
    difficulty: "hard",
    requiresCrossFileContext: true,
  },
  {
    id: "retrieval-data-flow-jwt-issue-to-verify",
    query: "Once a JWT is issued for a user id, what verifies it on a later request?",
    expectedChunkIds: ["py-verify-jwt"],
    acceptableAlternativeChunkIds: ["py-generate-jwt"],
    supportingSourceChunkIds: ["py-generate-jwt"],
    notes: "generate_jwt issues the token; verify_jwt is the direct target for 'what verifies it later'.",
    category: "data-flow",
    language: "python",
    difficulty: "medium",
    requiresCrossFileContext: true,
  },
  {
    id: "retrieval-exact-function-name-find-product-sku",
    query: "findProductBySku",
    expectedChunkIds: ["js-find-product-by-sku"],
    acceptableAlternativeChunkIds: [],
    notes: "Raw exact-identifier query, JavaScript.",
    category: "exact-function-name",
    language: "javascript",
    difficulty: "easy",
  },
  {
    id: "retrieval-database-access-product-injection",
    query: "Is there a SQL injection risk when searching for products by name?",
    expectedChunkIds: ["js-find-product-by-name"],
    acceptableAlternativeChunkIds: ["js-find-product-by-sku"],
    notes: "JavaScript counterpart to retrieval-sql-injection; findProductBySku is parameterized and should not be the top match.",
    category: "database-access",
    language: "javascript",
    difficulty: "medium",
  },
  {
    id: "retrieval-authz-order-route-ownership",
    query: "Does the order-by-id API route check that the requester owns the order?",
    expectedChunkIds: ["api-get-order-route"],
    acceptableAlternativeChunkIds: [],
    notes: "Correct counterpart to retrieval-missing-ownership-check — this route does check ownership.",
    category: "auth-authz",
    language: "typescript",
    difficulty: "medium",
  },
  {
    id: "retrieval-authz-js-order-ownership",
    query: "Which JavaScript order-lookup function fails to check that the requester owns the order?",
    expectedChunkIds: ["js-get-order"],
    acceptableAlternativeChunkIds: ["js-get-owned-order"],
    notes: "JavaScript counterpart to retrieval-missing-ownership-check.",
    category: "auth-authz",
    language: "javascript",
    difficulty: "medium",
  },
  {
    id: "retrieval-utility-strong-password-python",
    query: "is_strong_password",
    expectedChunkIds: ["py-is-strong-password"],
    acceptableAlternativeChunkIds: [],
    notes: "Raw exact-identifier query, Python.",
    category: "exact-function-name",
    language: "python",
    difficulty: "easy",
  },
  {
    id: "retrieval-utility-validate-email",
    query: "How is an email address validated for correct format?",
    expectedChunkIds: ["py-validate-email"],
    acceptableAlternativeChunkIds: [],
    notes: "",
    category: "utility-function",
    language: "python",
    difficulty: "easy",
  },
  {
    id: "retrieval-imported-function-cart-remove",
    query: "Which underlying cartService function does the cart module's public removeFromCart delegate to?",
    expectedChunkIds: ["js-cart-remove-item"],
    acceptableAlternativeChunkIds: ["js-cart-remove-from-cart"],
    notes: "",
    category: "imported-function",
    language: "javascript",
    difficulty: "medium",
    requiresCrossFileContext: true,
  },
  {
    id: "retrieval-cross-file-order-total-flow",
    query: "How does the orders API list a user's own orders using the order repository?",
    expectedChunkIds: ["api-list-my-orders-route"],
    acceptableAlternativeChunkIds: ["db-find-orders-by-user-id"],
    supportingSourceChunkIds: ["db-find-orders-by-user-id"],
    notes: "listMyOrdersRoute directly calls findOrdersByUserId from a different file.",
    category: "cross-file-dependency",
    language: "typescript",
    difficulty: "medium",
    requiresCrossFileContext: true,
  },
];
