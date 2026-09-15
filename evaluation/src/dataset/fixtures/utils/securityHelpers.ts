// Fixture file for DevForge's evaluation dataset (Phase 12, Milestone 6) — a
// new adversarial fixture added to stress-test retrieval, not present when
// the ranking improvements in Milestone 3 were designed. Small, synthetic,
// non-sensitive sample code written for this dataset — not copied from any
// real project.
//
// Deliberately misleading filename: despite living in a file named
// "securityHelpers.ts", this function has nothing to do with security — it
// is ordinary date formatting. Tests that retrieval relies on actual
// content, not a suggestive filename, when the two disagree.

export function formatIsoDate(date: Date): string {
  return date.toISOString().split("T")[0] ?? "";
}
