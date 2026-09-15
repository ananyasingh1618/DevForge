/**
 * Retrieval evaluation cases — see docs/EVALUATION_PHASE_PLAN.md for the
 * retrieval metrics computed from these. `expectedChunkIds` are the chunks a
 * correct retrieval MUST surface for the case to count as a hit;
 * `acceptableAlternativeChunkIds` are chunks that would also be a reasonable
 * answer and must not be penalized as false positives if returned instead of
 * (or alongside) an expected chunk, but do not themselves count toward
 * recall.
 */

export type RetrievalCase = {
  id: string;
  query: string;
  expectedChunkIds: string[];
  acceptableAlternativeChunkIds: string[];
  notes: string;
};

export const RETRIEVAL_CASES: RetrievalCase[] = [
  {
    id: "retrieval-password-check",
    query: "Where is the user's password checked during login?",
    expectedChunkIds: ["auth-verify-password"],
    acceptableAlternativeChunkIds: ["auth-require-auth"],
    notes: "Primary match is the password comparison itself, not the session guard around it.",
  },
  {
    id: "retrieval-find-user-by-email",
    query: "How does DevForge look up a user by their email address in the database?",
    expectedChunkIds: ["db-find-user-by-email"],
    acceptableAlternativeChunkIds: ["db-find-user-by-id"],
    notes: "",
  },
  {
    id: "retrieval-sql-injection",
    query: "Where might a SQL injection vulnerability exist in the database access code?",
    expectedChunkIds: ["db-find-user-by-email"],
    acceptableAlternativeChunkIds: [],
    notes: "The email lookup builds SQL via string concatenation; the id lookup is parameterized and should not be the top match.",
  },
  {
    id: "retrieval-missing-ownership-check",
    query: "Which function returns a project without checking that the requester owns it?",
    expectedChunkIds: ["api-get-project"],
    acceptableAlternativeChunkIds: ["api-get-owned-project"],
    notes: "getOwnedProject is the safe counterpart and a reasonable alternative match, not the primary target.",
  },
  {
    id: "retrieval-webhook-parse-errors",
    query: "How are errors handled when parsing a webhook payload?",
    expectedChunkIds: ["errors-parse-webhook-payload"],
    acceptableAlternativeChunkIds: ["errors-parse-webhook-payload-strict"],
    notes: "",
  },
  {
    id: "retrieval-webhook-secret-config",
    query: "Where is the webhook signing secret loaded from an environment variable?",
    expectedChunkIds: ["config-load-webhook-secret"],
    acceptableAlternativeChunkIds: [],
    notes: "",
  },
  {
    id: "retrieval-github-default-branch",
    query: "Where does the GitHub client fetch a repository's default branch?",
    expectedChunkIds: ["github-get-default-branch", "github-get-default-branch-safe"],
    acceptableAlternativeChunkIds: [],
    notes: "Both implementations answer this query equally well; either counts as a hit.",
  },
  {
    id: "retrieval-fire-and-forget-notifications",
    query: "How does DevForge send a user notification without waiting for the response?",
    expectedChunkIds: ["services-notify-fire-and-forget"],
    acceptableAlternativeChunkIds: ["services-notify-user"],
    notes: "",
  },
  {
    id: "retrieval-round-decimal-places",
    query: "Where are numbers rounded to a fixed number of decimal places?",
    expectedChunkIds: ["utils-math-helpers-file"],
    acceptableAlternativeChunkIds: [],
    notes: "Exercises retrieval over the dataset's one clean, no-findings file.",
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
  },
  {
    id: "retrieval-misleading-filename",
    query: "Where is a date formatted as an ISO date string?",
    expectedChunkIds: ["utils-security-helpers-format-iso-date"],
    acceptableAlternativeChunkIds: [],
    notes:
      "Adversarial: the file is named securityHelpers.ts despite having nothing to do with " +
      "security — tests that retrieval follows actual content, not a suggestive filename.",
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
  },
  {
    id: "retrieval-exact-identifier-query",
    query: "checkLegacyPassword",
    expectedChunkIds: ["auth-legacy-check-password"],
    acceptableAlternativeChunkIds: [],
    notes: "Adversarial: the query is nothing but a raw identifier — directly exercises exactIdentifierBoost.",
  },
];
