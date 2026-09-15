import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkContent, FIXTURE_CHUNKS } from "./fixtureRepo.js";
import { RETRIEVAL_CASES } from "./retrievalCases.js";
import { QA_CASES } from "./qaCases.js";
import { REVIEW_CASES } from "./reviewCases.js";

// Mirrors api/prisma/schema.prisma's real Phase 10 enums exactly (not
// re-exported from api, since evaluation/ has no dependency on it — see
// docs/EVALUATION_PHASE_PLAN.md for why this package uses raw pg/its own
// types rather than importing api's generated Prisma client). Kept in sync
// by hand; a mismatch here would only ever make this test too strict, never
// silently accept an invalid category/severity.
const REAL_SEVERITIES = ["critical", "high", "medium", "low", "info"];
const REAL_CATEGORIES = [
  "bug",
  "security",
  "reliability",
  "performance",
  "maintainability",
  "validation",
  "error_handling",
  "testing",
  "architecture",
  "other",
];

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function uniqueIds<T extends { id: string }>(items: T[]): string[] {
  return items.map((i) => i.id);
}

describe("dataset: fixture chunks", () => {
  it("has stable, unique chunk ids", () => {
    const ids = FIXTURE_CHUNKS.map((c) => c.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every chunk resolves to real, non-empty content on disk", () => {
    for (const chunk of FIXTURE_CHUNKS) {
      const content = chunkContent(chunk);
      expect(content.length).toBeGreaterThan(0);
      expect(chunk.startLine).toBeGreaterThanOrEqual(1);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });

  it("no fixture file contains a credential-shaped string", () => {
    const credentialPatterns = [/ghp_[A-Za-z0-9]{10,}/, /sk-ant-[A-Za-z0-9-]{10,}/, /AKIA[0-9A-Z]{16}/];
    for (const chunk of FIXTURE_CHUNKS) {
      const raw = readFileSync(path.join(FIXTURES_DIR, chunk.filePath), "utf-8");
      for (const pattern of credentialPatterns) {
        expect(raw).not.toMatch(pattern);
      }
    }
  });

  it("every fixture file documents itself as synthetic dataset content, not real project source", () => {
    const uniqueFiles = new Set(FIXTURE_CHUNKS.map((c) => c.filePath));
    for (const filePath of uniqueFiles) {
      const raw = readFileSync(path.join(FIXTURES_DIR, filePath), "utf-8");
      expect(raw).toContain("evaluation dataset");
      expect(raw.toLowerCase()).not.toContain("voxmind");
    }
  });
});

describe("dataset: retrieval cases", () => {
  it("has stable, unique case ids", () => {
    const ids = uniqueIds(RETRIEVAL_CASES);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every referenced chunk id is a real fixture chunk", () => {
    const realIds = new Set(FIXTURE_CHUNKS.map((c) => c.chunkId));
    for (const c of RETRIEVAL_CASES) {
      for (const id of [
        ...c.expectedChunkIds,
        ...c.acceptableAlternativeChunkIds,
        ...(c.directSourceChunkIds ?? []),
        ...(c.supportingSourceChunkIds ?? []),
        ...(c.irrelevantExampleChunkIds ?? []),
      ]) {
        expect(realIds.has(id)).toBe(true);
      }
    }
  });

  // Phase 13, Milestone 13.4: a retrieval case is allowed zero expected
  // chunks only when it's explicitly marked `answerable: false` (an
  // insufficient-evidence case, the retrieval-side counterpart to
  // QA_CASES' `insufficientEvidenceExpected`) — every other case must have
  // at least one real expected chunk. See benchmarkAudit.ts for the fuller
  // automated audit this hand-written test complements.
  it("every case has a non-empty query, and an answerable case has at least one expected chunk", () => {
    for (const c of RETRIEVAL_CASES) {
      expect(c.query.length).toBeGreaterThan(0);
      if (c.answerable === false) {
        expect(c.expectedChunkIds.length).toBe(0);
      } else {
        expect(c.expectedChunkIds.length).toBeGreaterThan(0);
      }
    }
  });

  it("an unanswerable case never accidentally has real expected evidence", () => {
    for (const c of RETRIEVAL_CASES) {
      if (c.answerable === false) {
        expect(c.expectedChunkIds).toEqual([]);
        expect(c.acceptableAlternativeChunkIds).toEqual([]);
      }
    }
  });
});

describe("dataset: Q&A cases", () => {
  it("has stable, unique case ids", () => {
    const ids = uniqueIds(QA_CASES);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every referenced chunk id is a real fixture chunk", () => {
    const realIds = new Set(FIXTURE_CHUNKS.map((c) => c.chunkId));
    for (const c of QA_CASES) {
      for (const id of [...c.requiredEvidenceChunkIds, ...c.mockAnswer.citedChunkIds]) {
        expect(realIds.has(id)).toBe(true);
      }
    }
  });

  it("a case expecting insufficient evidence has no required evidence and a mock answer that agrees", () => {
    for (const c of QA_CASES) {
      if (c.insufficientEvidenceExpected) {
        expect(c.requiredEvidenceChunkIds).toEqual([]);
        expect(c.mockAnswer.insufficientEvidence).toBe(true);
        expect(c.mockAnswer.citedChunkIds).toEqual([]);
      }
    }
  });

  it("every mock answer's cited chunks are a subset of its required evidence (grounded by construction)", () => {
    for (const c of QA_CASES) {
      for (const id of c.mockAnswer.citedChunkIds) {
        expect(c.requiredEvidenceChunkIds).toContain(id);
      }
    }
  });
});

describe("dataset: code review cases", () => {
  it("has stable, unique case ids", () => {
    const ids = uniqueIds(REVIEW_CASES);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every expected finding uses a real severity and category matching Phase 10's own enums", () => {
    for (const c of REVIEW_CASES) {
      for (const f of c.expectedFindings) {
        expect(REAL_SEVERITIES).toContain(f.severityRange[0]);
        expect(REAL_SEVERITIES).toContain(f.severityRange[1]);
        expect(REAL_CATEGORIES).toContain(f.category);
      }
    }
  });

  it("every mock finding uses a real severity and category matching Phase 10's own enums", () => {
    for (const c of REVIEW_CASES) {
      for (const f of c.mockFindings) {
        expect(REAL_SEVERITIES).toContain(f.severity);
        expect(REAL_CATEGORIES).toContain(f.category);
      }
    }
  });

  it("every referenced chunk id (relevant/expected/cited) is a real fixture chunk", () => {
    const realIds = new Set(FIXTURE_CHUNKS.map((c) => c.chunkId));
    for (const c of REVIEW_CASES) {
      for (const id of c.relevantChunkIds) expect(realIds.has(id)).toBe(true);
      for (const f of c.expectedFindings) expect(realIds.has(f.expectedSourceChunkId)).toBe(true);
      for (const f of c.mockFindings) {
        for (const id of f.citedChunkIds) expect(realIds.has(id)).toBe(true);
      }
    }
  });

  it("every mock finding's citations point only within that case's own relevant evidence (no unsupported source reference)", () => {
    for (const c of REVIEW_CASES) {
      for (const f of c.mockFindings) {
        for (const id of f.citedChunkIds) {
          expect(c.relevantChunkIds).toContain(id);
        }
      }
    }
  });

  it("a case with no expected findings has no mock findings either (empty review is the correct ground truth)", () => {
    for (const c of REVIEW_CASES) {
      if (c.expectedFindings.length === 0) {
        expect(c.mockFindings).toEqual([]);
      }
    }
  });

  it("includes at least one clean (no-finding) case and one prompt-injection regression case", () => {
    const ids = REVIEW_CASES.map((c) => c.id);
    expect(ids).toContain("review-clean-file-no-findings");
    expect(ids).toContain("review-prompt-injection-in-comment");
  });
});
