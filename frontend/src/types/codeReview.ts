export type ReviewFindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export type ReviewFindingCategory =
  | "bug"
  | "security"
  | "reliability"
  | "performance"
  | "maintainability"
  | "validation"
  | "error_handling"
  | "testing"
  | "architecture"
  | "other";

export type ReviewFindingConfidence = "high" | "medium" | "low";

export type CodeReviewSource = {
  filePath: string;
  symbolName: string | null;
  startLine: number;
  endLine: number;
  score: number;
};

export type CodeReviewFinding = {
  id: string;
  title: string;
  description: string;
  severity: ReviewFindingSeverity;
  category: ReviewFindingCategory;
  confidence: ReviewFindingConfidence;
  recommendation: string;
  actionable: boolean;
  sources: CodeReviewSource[];
};

export type CodeReview = {
  reviewId: string;
  scope: string;
  status: "pending" | "completed" | "failed";
  summary: string | null;
  findingCount: number;
  findings: CodeReviewFinding[];
  sources: CodeReviewSource[];
  branch: string;
  commit: string;
  createdAt: string;
  completedAt: string | null;
};
