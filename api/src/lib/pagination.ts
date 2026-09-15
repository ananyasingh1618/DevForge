/**
 * Phase 16, Milestone 16.5 — a shared bound for "list everything for this
 * project/user" queries that previously had no `take` limit at all
 * (`listReviews`, `listArchitectureVersions`, `listEpicVersions`,
 * `listPrdVersions`, `listRequirementsVersions`, `listTaskVersions`,
 * `listProjectsForOwner`, `listQuestions`). None of these are expected to
 * realistically exceed this in normal use (each row is the result of an
 * explicit, individually-costly action — an LLM generation call, a
 * completed review, a completed Q&A turn — not bulk-insertable data), but
 * an unbounded query is still a real, unnecessary risk (a single very
 * heavy project turning one list call into an unbounded-size response and
 * an unbounded-cost DB scan). `jobs.ts` and `evaluations.ts` already had
 * their own bounds before this milestone; this constant brings every other
 * list query up to the same standard rather than inventing a different
 * number per resource.
 */
export const MAX_LIST_RESULTS = 200;
