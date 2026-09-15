/**
 * Automated benchmark-quality checks (Phase 13, Milestone 13.4 — see
 * docs/BENCHMARK_EXPANSION_PHASE_PLAN.md). Detects poor benchmark
 * construction the way a careful human reviewer would, but deterministically
 * and on every run: a broken reference, an inconsistent relevance label, a
 * mislabeled language, an accidental duplicate. This module never modifies
 * the dataset — it only reports.
 *
 * Findings are split into `errors` (the benchmark is structurally wrong —
 * these should be treated as build-breaking) and `warnings` (worth a human
 * look, but not necessarily wrong — e.g. an unanswerable case whose top
 * retrieval score happens to be high given the deterministic embedding's
 * documented noise floor, which docs/BENCHMARK_EXPANSION_PHASE_PLAN.md
 * already explains is not a reliable signal on its own).
 */

import { FIXTURE_CHUNKS, type FixtureChunk } from "./fixtureRepo.js";
import { RETRIEVAL_CASES, type RetrievalCase } from "./retrievalCases.js";
import { QA_CASES } from "./qaCases.js";
import { REVIEW_CASES } from "./reviewCases.js";

export type AuditFinding = {
  rule: string;
  caseId?: string;
  chunkId?: string;
  detail: string;
};

export type AuditReport = {
  errors: AuditFinding[];
  warnings: AuditFinding[];
  passed: boolean;
};

const SECRET_PATTERNS = [/ghp_[A-Za-z0-9]{10,}/, /sk-ant-[A-Za-z0-9-]{10,}/, /AKIA[0-9A-Z]{16}/];
// Deliberately narrow, general PII heuristics — a real email-shaped string
// or a US-SSN-shaped string. Every fixture/case in this dataset is
// synthetic by construction, so a match here would indicate an accidental
// copy-paste from real content, not a false positive on intentional test
// data (this dataset's own example emails, e.g. in query text, use
// obviously fake domains — see the check's own allowlist below).
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ALLOWED_EMAIL_DOMAINS = new Set(["example.com"]);
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;

const EXTENSION_LANGUAGE: Record<string, FixtureChunk["language"]> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".py": "python",
};

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function scanTextForSecretsAndPii(text: string, rule: string, context: Partial<AuditFinding>): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      findings.push({ rule, detail: `matched credential-shaped pattern ${pattern.source}`, ...context });
    }
  }
  const emails = text.match(EMAIL_PATTERN) ?? [];
  for (const email of emails) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain && !ALLOWED_EMAIL_DOMAINS.has(domain)) {
      findings.push({ rule, detail: `email-shaped string with a non-allowlisted domain: ${email}`, ...context });
    }
  }
  if (SSN_PATTERN.test(text)) {
    findings.push({ rule, detail: "SSN-shaped string found", ...context });
  }
  return findings;
}

function allReferencedChunkIds(c: RetrievalCase): string[] {
  return [
    ...c.expectedChunkIds,
    ...c.acceptableAlternativeChunkIds,
    ...(c.directSourceChunkIds ?? []),
    ...(c.supportingSourceChunkIds ?? []),
    ...(c.irrelevantExampleChunkIds ?? []),
  ];
}

export function runBenchmarkAudit(): AuditReport {
  const errors: AuditFinding[] = [];
  const warnings: AuditFinding[] = [];

  const realChunkIds = new Set(FIXTURE_CHUNKS.map((c) => c.chunkId));

  // --- Fixture-level checks ---
  const chunkIdCounts = new Map<string, number>();
  for (const chunk of FIXTURE_CHUNKS) {
    chunkIdCounts.set(chunk.chunkId, (chunkIdCounts.get(chunk.chunkId) ?? 0) + 1);
  }
  for (const [id, count] of chunkIdCounts) {
    if (count > 1) errors.push({ rule: "unique-chunk-id", chunkId: id, detail: `chunk id used ${count} times` });
  }

  for (const chunk of FIXTURE_CHUNKS) {
    const ext = extensionOf(chunk.filePath);
    const expectedLanguage = EXTENSION_LANGUAGE[ext];
    if (expectedLanguage && expectedLanguage !== chunk.language) {
      errors.push({
        rule: "language-label-correct",
        chunkId: chunk.chunkId,
        detail: `filePath "${chunk.filePath}" implies language "${expectedLanguage}" but chunk declares "${chunk.language}"`,
      });
    }
    if (chunk.filePath.startsWith("/") || chunk.filePath.startsWith("./") || chunk.filePath.includes("\\")) {
      errors.push({
        rule: "source-path-normalized",
        chunkId: chunk.chunkId,
        detail: `filePath "${chunk.filePath}" is not a normalized relative path`,
      });
    }
    if (chunk.startLine < 1 || chunk.endLine < chunk.startLine) {
      errors.push({
        rule: "valid-line-range",
        chunkId: chunk.chunkId,
        detail: `startLine=${chunk.startLine} endLine=${chunk.endLine} is not a valid range`,
      });
    }
  }

  // --- Retrieval case checks ---
  const retrievalIdCounts = new Map<string, number>();
  const seenQueries = new Map<string, string[]>();
  for (const c of RETRIEVAL_CASES) {
    retrievalIdCounts.set(c.id, (retrievalIdCounts.get(c.id) ?? 0) + 1);

    for (const id of allReferencedChunkIds(c)) {
      if (!realChunkIds.has(id)) {
        errors.push({ rule: "expected-source-exists", caseId: c.id, chunkId: id, detail: `references unknown chunk id "${id}"` });
      }
    }

    const answerable = c.answerable ?? true;
    if (answerable && c.expectedChunkIds.length === 0) {
      errors.push({ rule: "answerable-has-evidence", caseId: c.id, detail: "answerable case has zero expectedChunkIds" });
    }
    if (!answerable && (c.expectedChunkIds.length > 0 || c.acceptableAlternativeChunkIds.length > 0)) {
      errors.push({
        rule: "unanswerable-has-no-real-evidence",
        caseId: c.id,
        detail: "case marked answerable:false but has non-empty expectedChunkIds/acceptableAlternativeChunkIds",
      });
    }

    const direct = new Set(c.directSourceChunkIds ?? c.expectedChunkIds);
    const irrelevant = new Set(c.irrelevantExampleChunkIds ?? []);
    for (const id of irrelevant) {
      if (direct.has(id)) {
        errors.push({
          rule: "relevance-labels-consistent",
          caseId: c.id,
          chunkId: id,
          detail: "chunk is listed as both a direct source and an irrelevant example",
        });
      }
    }

    if (c.query.trim().length === 0) {
      errors.push({ rule: "query-has-clear-outcome", caseId: c.id, detail: "empty query" });
    }

    const secretFindings = scanTextForSecretsAndPii(`${c.query} ${c.notes}`, "no-secrets-or-pii", { caseId: c.id });
    errors.push(...secretFindings);

    if (`${c.id} ${c.query} ${c.notes}`.toLowerCase().includes("voxmind")) {
      errors.push({ rule: "no-voxmind-content", caseId: c.id, detail: "case text mentions VoxMind" });
    }

    const normalizedQuery = c.query.trim().toLowerCase();
    const existing = seenQueries.get(normalizedQuery) ?? [];
    if (existing.length > 0) {
      warnings.push({
        rule: "no-accidental-duplicate-query",
        caseId: c.id,
        detail: `query text duplicates case(s): ${existing.join(", ")}`,
      });
    }
    seenQueries.set(normalizedQuery, [...existing, c.id]);
  }
  for (const [id, count] of retrievalIdCounts) {
    if (count > 1) errors.push({ rule: "unique-case-id", caseId: id, detail: `retrieval case id used ${count} times` });
  }

  // --- Q&A case checks (VoxMind/secret scan + real chunk references) ---
  const qaIdCounts = new Map<string, number>();
  for (const c of QA_CASES) {
    qaIdCounts.set(c.id, (qaIdCounts.get(c.id) ?? 0) + 1);
    for (const id of [...c.requiredEvidenceChunkIds, ...c.mockAnswer.citedChunkIds]) {
      if (!realChunkIds.has(id)) {
        errors.push({ rule: "expected-source-exists", caseId: c.id, chunkId: id, detail: `references unknown chunk id "${id}"` });
      }
    }
    const text = `${c.question} ${c.mockAnswer.answer}`;
    errors.push(...scanTextForSecretsAndPii(text, "no-secrets-or-pii", { caseId: c.id }));
    if (text.toLowerCase().includes("voxmind")) {
      errors.push({ rule: "no-voxmind-content", caseId: c.id, detail: "case text mentions VoxMind" });
    }
  }
  for (const [id, count] of qaIdCounts) {
    if (count > 1) errors.push({ rule: "unique-case-id", caseId: id, detail: `Q&A case id used ${count} times` });
  }

  // --- Review case checks ---
  const reviewIdCounts = new Map<string, number>();
  for (const c of REVIEW_CASES) {
    reviewIdCounts.set(c.id, (reviewIdCounts.get(c.id) ?? 0) + 1);
    for (const id of c.relevantChunkIds) {
      if (!realChunkIds.has(id)) {
        errors.push({ rule: "expected-source-exists", caseId: c.id, chunkId: id, detail: `references unknown chunk id "${id}"` });
      }
    }
    const text = `${c.scope} ${c.notes}`;
    errors.push(...scanTextForSecretsAndPii(text, "no-secrets-or-pii", { caseId: c.id }));
    if (text.toLowerCase().includes("voxmind")) {
      errors.push({ rule: "no-voxmind-content", caseId: c.id, detail: "case text mentions VoxMind" });
    }
  }
  for (const [id, count] of reviewIdCounts) {
    if (count > 1) errors.push({ rule: "unique-case-id", caseId: id, detail: `review case id used ${count} times` });
  }

  return { errors, warnings, passed: errors.length === 0 };
}

export function renderAuditMarkdown(report: AuditReport): string {
  const section = (title: string, findings: AuditFinding[]) =>
    findings.length === 0
      ? `### ${title}\n\n_None._`
      : `### ${title}\n\n${findings.map((f) => `- \`${f.rule}\`${f.caseId ? ` (${f.caseId})` : ""}${f.chunkId ? ` [${f.chunkId}]` : ""}: ${f.detail}`).join("\n")}`;

  return `# DevForge Benchmark Audit Report

- **Status**: ${report.passed ? "PASSED — no structural benchmark defects found" : "FAILED — structural benchmark defects found"}
- **Errors**: ${report.errors.length}
- **Warnings**: ${report.warnings.length}

${section("Errors (structural — must be fixed)", report.errors)}

${section("Warnings (worth a human look, not necessarily wrong)", report.warnings)}
`;
}
