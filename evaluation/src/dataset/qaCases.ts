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
        "No — getProject looks up the project by id and returns it without checking req.user " +
        "against the project's ownerId, so any authenticated user can read another user's project.",
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
        "notifyUserFireAndForget calls fetch() without awaiting it or handling a failure, so a " +
        "failed delivery is silently lost.",
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
];
