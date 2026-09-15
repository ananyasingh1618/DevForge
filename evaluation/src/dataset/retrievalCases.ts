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
];
