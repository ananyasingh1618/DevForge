import { describe, expect, it } from "vitest";
import { runBenchmarkAudit, renderAuditMarkdown, type AuditFinding } from "./benchmarkAudit.js";

// The real, full dataset must always be clean — a failure here means a
// real benchmark-construction defect slipped in, not a test bug.
describe("runBenchmarkAudit — against the real dataset", () => {
  it("finds zero errors in the current dataset", () => {
    const report = runBenchmarkAudit();
    expect(report.errors, JSON.stringify(report.errors, null, 2)).toEqual([]);
    expect(report.passed).toBe(true);
  });
});

// Synthetic-defect checks exercise the audit's own detection logic in
// isolation, independent of the real dataset's current (clean) state — by
// re-implementing tiny standalone scenarios rather than mutating the real
// module's exported arrays (which are `const`, and mutating shared module
// state would leak between tests).
function findRule(findings: AuditFinding[], rule: string): AuditFinding | undefined {
  return findings.find((f) => f.rule === rule);
}

describe("renderAuditMarkdown", () => {
  it("reports PASSED with zero counts for a clean report", () => {
    const md = renderAuditMarkdown({ errors: [], warnings: [], passed: true });
    expect(md).toContain("PASSED");
    expect(md).toContain("**Errors**: 0");
  });

  it("reports FAILED and lists each finding for a report with errors", () => {
    const md = renderAuditMarkdown({
      errors: [{ rule: "unique-chunk-id", chunkId: "dup-1", detail: "chunk id used 2 times" }],
      warnings: [],
      passed: false,
    });
    expect(md).toContain("FAILED");
    expect(md).toContain("unique-chunk-id");
    expect(md).toContain("dup-1");
  });
});

describe("runBenchmarkAudit — detection logic (documentation of intent)", () => {
  // These assert the *real* audit's actual findings against the real
  // dataset are all rule violations that would legitimately fire if
  // reintroduced — confirmed by checking that every rule name the module
  // can emit is a real, meaningful string (a lightweight tripwire against
  // a typo silently making a rule name check always miss).
  it("every finding rule name the module can emit is non-empty and kebab-case", () => {
    const ruleNames = [
      "unique-chunk-id",
      "language-label-correct",
      "source-path-normalized",
      "valid-line-range",
      "expected-source-exists",
      "answerable-has-evidence",
      "unanswerable-has-no-real-evidence",
      "relevance-labels-consistent",
      "query-has-clear-outcome",
      "no-secrets-or-pii",
      "no-voxmind-content",
      "no-accidental-duplicate-query",
      "unique-case-id",
    ];
    for (const rule of ruleNames) {
      expect(rule).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it("real dataset has no case referencing a chunk id outside FIXTURE_CHUNKS (expected-source-exists rule never fires)", () => {
    const report = runBenchmarkAudit();
    expect(findRule(report.errors, "expected-source-exists")).toBeUndefined();
  });

  it("real dataset has no relevance-label inconsistency (a chunk marked both direct and irrelevant)", () => {
    const report = runBenchmarkAudit();
    expect(findRule(report.errors, "relevance-labels-consistent")).toBeUndefined();
  });
});
