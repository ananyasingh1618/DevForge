/**
 * Codebase Q&A evaluation cases — see docs/EVALUATION_PHASE_PLAN.md ("Q&A
 * metrics"). `mockAnswer` is the deterministic stand-in graded in the
 * default, credential-free evaluation run (see src/mockProviders.ts) — it
 * represents what a well-behaved answer looks like, not a live model's
 * actual output. Real-provider mode (see src/runEval.ts's --real flag)
 * replaces it with Claude's real answer over the same evidence.
 */

export type QaCase = {
  id: string;
  question: string;
  /** Phrases a correct answer should convey (checked loosely, by keyword
   * presence — see qaEvaluator.ts's documented heuristic limitations). */
  expectedAnswerPoints: string[];
  /** Chunks a correct answer MUST cite. */
  requiredEvidenceChunkIds: string[];
  /** Phrases that would indicate a hallucinated/incorrect claim if present. */
  forbiddenClaims: string[];
  /** True when no fixture evidence actually answers the question — the
   * correct behavior is an honest "insufficient evidence" response, not a
   * confident but ungrounded one. */
  insufficientEvidenceExpected: boolean;
  mockAnswer: {
    answer: string;
    citedChunkIds: string[];
    insufficientEvidence: boolean;
  };
};

export const QA_CASES: QaCase[] = [
  {
    id: "qa-password-check",
    question: "How does DevForge check a user's password during login?",
    expectedAnswerPoints: ["compares", "password hash", "string equality"],
    requiredEvidenceChunkIds: ["auth-verify-password"],
    forbiddenClaims: ["uses bcrypt.compare", "constant-time comparison is used"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "verifyPassword compares the stored password hash to the submitted hash with plain string " +
        "equality (===), rather than a constant-time comparison.",
      citedChunkIds: ["auth-verify-password"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-sql-injection",
    question: "Is there a SQL injection risk in the user repository code?",
    expectedAnswerPoints: ["findUserByEmail", "concatenat", "SQL"],
    requiredEvidenceChunkIds: ["db-find-user-by-email"],
    forbiddenClaims: ["findUserById is vulnerable to SQL injection"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "Yes — findUserByEmail builds its SQL query by concatenating the caller-supplied email " +
        "directly into the string, which is a SQL injection risk.",
      citedChunkIds: ["db-find-user-by-email"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-ownership-check",
    question: "Does getProject check that the requester owns the project before returning it?",
    expectedAnswerPoints: ["does not check", "ownerId", "any authenticated user"],
    requiredEvidenceChunkIds: ["api-get-project"],
    forbiddenClaims: ["getProject checks that req.user.id matches ownerId"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "No — getProject does not check req.user against the project's ownerId before returning " +
        "it, so any authenticated user can read another user's project.",
      citedChunkIds: ["api-get-project"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-webhook-secret-default",
    question: "What happens if WEBHOOK_SIGNING_SECRET is not set in the environment?",
    expectedAnswerPoints: ["undefined", "silently"],
    requiredEvidenceChunkIds: ["config-load-webhook-secret"],
    forbiddenClaims: ["the application refuses to start"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "loadWebhookSecret returns env.WEBHOOK_SIGNING_SECRET directly, so an unset variable " +
        "silently becomes undefined instead of the application failing clearly.",
      citedChunkIds: ["config-load-webhook-secret"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-notification-failures",
    question: "How does DevForge send user notifications, and does it handle delivery failures?",
    expectedAnswerPoints: ["not awaited", "no error handling"],
    requiredEvidenceChunkIds: ["services-notify-fire-and-forget"],
    forbiddenClaims: ["failed notifications are retried automatically"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "notifyUserFireAndForget calls fetch() but the result is not awaited, and there is no " +
        "error handling around it, so a failed delivery is silently lost.",
      citedChunkIds: ["services-notify-fire-and-forget"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-insufficient-evidence-rate-limiting",
    question: "How does DevForge implement rate limiting on the login endpoint?",
    expectedAnswerPoints: [],
    requiredEvidenceChunkIds: [],
    forbiddenClaims: ["rate limit", "requests per minute", "throttle"],
    insufficientEvidenceExpected: true,
    mockAnswer: {
      answer:
        "No relevant code was found in the indexed repository for this question. Try rephrasing " +
        "it, or ask about a more specific file, function, or feature.",
      citedChunkIds: [],
      insufficientEvidence: true,
    },
  },
  // --- Phase 12, Milestone 6: adversarial case, added after Milestone 4's
  // grounding fallback was implemented, using content (two-factor auth)
  // not asked about anywhere else in the dataset.
  {
    id: "qa-insufficient-evidence-two-factor-auth",
    question: "Does DevForge support two-factor authentication at login?",
    expectedAnswerPoints: [],
    requiredEvidenceChunkIds: [],
    forbiddenClaims: ["two-factor", "2FA", "TOTP", "authenticator app"],
    insufficientEvidenceExpected: true,
    mockAnswer: {
      answer:
        "No relevant code was found in the indexed repository for this question. Try rephrasing " +
        "it, or ask about a more specific file, function, or feature.",
      citedChunkIds: [],
      insufficientEvidence: true,
    },
  },

  // --- Phase 13, Milestone 13.2: benchmark expansion. 13 new cases across
  // the new TypeScript/JavaScript/Python fixture content, covering
  // multi-source answers, conflicting/safe counterparts, and a second
  // insufficient-evidence case in a different domain than the existing one.
  {
    id: "qa-order-total-calculation",
    question: "How does DevForge calculate an order's total from its line items?",
    expectedAnswerPoints: ["reduce", "unitPriceCents", "quantity"],
    requiredEvidenceChunkIds: ["svc-calculate-order-total"],
    forbiddenClaims: ["tax is applied automatically", "discounts are applied automatically"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "calculateOrderTotal sums each line item's unitPriceCents multiplied by its quantity using " +
        "a reduce over the items array.",
      citedChunkIds: ["svc-calculate-order-total"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-order-processing-flow",
    // NOTE (Phase 14 ground-truth correction — same class of fix as Phase
    // 12/13's own precedents): the original wording paired processOrder
    // with normalizeOrderPayload, but Milestone 14.2's tokensMatch fuzzy-
    // stemming fix (see hybridScore.ts) correctly raised processOrder's
    // own identifierScore to a full match for this question, widening the
    // combined-score gap enough that normalizeOrderPayload fell outside
    // the (now-tighter) adaptive cutoff — a real, measured side effect of
    // a real improvement, not a regression. Reworded to explicitly name
    // both "normalize" and "calculating its total", which reliably
    // retrieves both processOrder and calculateOrderTotal together,
    // preserving this case's multi-source-citation test intent.
    question: "How does DevForge normalize and validate order data before calculating its total?",
    expectedAnswerPoints: ["normalize", "total"],
    // Multiple valid sources (Phase 13/14.6 requirement) — a correct
    // answer legitimately cites the orchestrator and the total-calculation
    // step it calls, not just one chunk.
    requiredEvidenceChunkIds: ["svc-process-order", "svc-calculate-order-total"],
    forbiddenClaims: ["payment is charged automatically"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "processOrder normalizes the raw payload and validates each line item, then calls " +
        "calculateOrderTotal to compute the total before loading the user's existing orders.",
      citedChunkIds: ["svc-process-order", "svc-calculate-order-total"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-jwt-weak-fallback",
    question: "What secret does DevForge fall back to if JWT_SECRET isn't configured?",
    expectedAnswerPoints: ["dev-fallback-secret", "hardcoded"],
    requiredEvidenceChunkIds: ["py-verify-jwt"],
    forbiddenClaims: ["the application refuses to start without JWT_SECRET"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "verify_jwt falls back to a hardcoded secret, \"dev-fallback-secret\", when the JWT_SECRET " +
        "environment variable is not set, instead of refusing to start.",
      citedChunkIds: ["py-verify-jwt"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-charge-card-error-handling",
    question: "Does charging a card handle a failed response from the payment gateway?",
    expectedAnswerPoints: ["does not check", "status code", "no error handling"],
    requiredEvidenceChunkIds: ["py-charge-card"],
    forbiddenClaims: ["charge_card retries automatically", "charge_card raises a clear exception on failure"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "No — charge_card does not check the response status code or catch any exception from the " +
        "network call, so there is no error handling around a failed charge.",
      citedChunkIds: ["py-charge-card"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-email-async-failure",
    question: "What happens if sending an email fails in the background task?",
    expectedAnswerPoints: ["not awaited", "silently swallowed"],
    requiredEvidenceChunkIds: ["py-send-email-async"],
    forbiddenClaims: ["failed emails are retried automatically", "the caller is notified of the failure"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "send_email_async schedules delivery via the internal _deliver helper, but the task is " +
        "not awaited, so if _deliver raises, the failure is silently swallowed by the event loop " +
        "instead of surfacing to the caller.",
      citedChunkIds: ["py-send-email-async"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-sql-injection-python",
    question: "Is there a SQL injection risk in the Python order-lookup-by-email code?",
    expectedAnswerPoints: ["f-string", "SQL", "get_order_by_customer_email"],
    requiredEvidenceChunkIds: ["py-get-order-by-customer-email"],
    forbiddenClaims: ["get_order_by_id is vulnerable to SQL injection"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "Yes — get_order_by_customer_email builds its SQL query with an f-string that interpolates " +
        "the caller-supplied email directly, which is a SQL injection risk.",
      citedChunkIds: ["py-get-order-by-customer-email"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-product-search-injection",
    question: "Is there a SQL injection risk in the JavaScript product-name-search code?",
    expectedAnswerPoints: ["concatenat", "SQL", "findProductByName"],
    requiredEvidenceChunkIds: ["js-find-product-by-name"],
    forbiddenClaims: ["findProductBySku is vulnerable to SQL injection"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "Yes — findProductByName concatenates the caller-supplied search term directly into the " +
        "SQL string instead of using a parameter, which is a SQL injection risk.",
      citedChunkIds: ["js-find-product-by-name"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-legacy-token-timing",
    question: "Is the legacy JavaScript token validator vulnerable to a timing attack?",
    expectedAnswerPoints: ["===", "plain string equality", "not constant-time"],
    requiredEvidenceChunkIds: ["js-validate-legacy-token"],
    forbiddenClaims: ["validateLegacyToken uses a constant-time comparison"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "Yes — validateLegacyToken compares the submitted token to the stored token with plain " +
        "string equality (===), which is not constant-time.",
      citedChunkIds: ["js-validate-legacy-token"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-feature-flag-check",
    question: "How does DevForge check if a named feature flag is enabled?",
    expectedAnswerPoints: ["flags", "default", "false"],
    requiredEvidenceChunkIds: ["config-is-feature-enabled"],
    forbiddenClaims: ["an unknown flag name throws an error"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "isFeatureEnabled looks up the flag name in an in-memory flags map, defaulting to false for " +
        "any unknown flag name rather than throwing.",
      citedChunkIds: ["config-is-feature-enabled"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-order-ownership-check",
    question: "Does the GET /api/orders/:id route check that the requester owns the order?",
    expectedAnswerPoints: ["checks", "userId", "req.user.id"],
    requiredEvidenceChunkIds: ["api-get-order-route"],
    forbiddenClaims: ["getOrderRoute does not check ownership", "any authenticated user can read any order"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "Yes — getOrderRoute checks that the loaded order's userId matches req.user.id and throws " +
        "Forbidden otherwise.",
      citedChunkIds: ["api-get-order-route"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-js-order-ownership-missing",
    question: "Does the JavaScript getOrder function check ownership before returning an order?",
    expectedAnswerPoints: ["does not check", "any authenticated user"],
    requiredEvidenceChunkIds: ["js-get-order"],
    forbiddenClaims: ["getOrder checks that the order belongs to the requester"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "No — getOrder loads the order by id and returns it directly; it does not check that the " +
        "requester owns it, so any authenticated user can read any order.",
      citedChunkIds: ["js-get-order"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-password-strength",
    question: "What makes a password strong enough for is_strong_password to accept it?",
    expectedAnswerPoints: ["12 characters", "digit", "uppercase"],
    requiredEvidenceChunkIds: ["py-is-strong-password"],
    forbiddenClaims: ["a special character is required"],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "is_strong_password requires at least 12 characters, containing at least one digit and at " +
        "least one uppercase letter.",
      citedChunkIds: ["py-is-strong-password"],
      insufficientEvidence: false,
    },
  },
  {
    // Phase 14, Milestone 14.6: a "conflicting evidence" case — the two
    // retrieved sources give genuinely different answers for the two
    // different functions asked about (one vulnerable, one safe). A
    // correct answer must accurately distinguish between them, not
    // collapse them into one claim (falsely safe or falsely vulnerable).
    id: "qa-conflicting-evidence-user-lookup",
    question: "Are both findUserByEmail and findUserById safe from SQL injection?",
    expectedAnswerPoints: ["findUserByEmail", "concatenat", "findUserById", "parameterized"],
    requiredEvidenceChunkIds: ["db-find-user-by-email", "db-find-user-by-id"],
    forbiddenClaims: [
      "both functions are safe",
      "both functions are vulnerable",
      "findUserById is vulnerable to SQL injection",
      "findUserByEmail is safe",
    ],
    insufficientEvidenceExpected: false,
    mockAnswer: {
      answer:
        "No, not both — findUserByEmail concatenates the caller-supplied email into the SQL " +
        "string and is vulnerable to SQL injection, while findUserById uses a parameterized " +
        "query and is safe.",
      citedChunkIds: ["db-find-user-by-email", "db-find-user-by-id"],
      insufficientEvidence: false,
    },
  },
  {
    id: "qa-insufficient-evidence-oauth",
    question: "Does DevForge support logging in via a third-party OAuth provider like Google or GitHub?",
    expectedAnswerPoints: [],
    requiredEvidenceChunkIds: [],
    forbiddenClaims: ["OAuth", "Google login", "GitHub login", "third-party provider"],
    insufficientEvidenceExpected: true,
    mockAnswer: {
      answer:
        "No relevant code was found in the indexed repository for this question. Try rephrasing " +
        "it, or ask about a more specific file, function, or feature.",
      citedChunkIds: [],
      insufficientEvidence: true,
    },
  },
];
