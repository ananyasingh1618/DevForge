-- CreateEnum
CREATE TYPE "CodeReviewStatus" AS ENUM ('pending', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "CodeReviewFindingSeverity" AS ENUM ('critical', 'high', 'medium', 'low', 'info');

-- CreateEnum
CREATE TYPE "CodeReviewFindingCategory" AS ENUM ('bug', 'security', 'reliability', 'performance', 'maintainability', 'validation', 'error_handling', 'testing', 'architecture', 'other');

-- CreateEnum
CREATE TYPE "CodeReviewFindingConfidence" AS ENUM ('high', 'medium', 'low');

-- CreateTable
CREATE TABLE "code_reviews" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "codebase_index_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "status" "CodeReviewStatus" NOT NULL DEFAULT 'pending',
    "summary" TEXT,
    "finding_count" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "code_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_review_sources" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "source_order" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "code_review_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_review_findings" (
    "id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "CodeReviewFindingSeverity" NOT NULL,
    "category" "CodeReviewFindingCategory" NOT NULL,
    "confidence" "CodeReviewFindingConfidence" NOT NULL,
    "recommendation" TEXT NOT NULL,
    "actionable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_review_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_review_finding_sources" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,

    CONSTRAINT "code_review_finding_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "code_reviews_project_id_idx" ON "code_reviews"("project_id");

-- CreateIndex
CREATE INDEX "code_review_sources_review_id_idx" ON "code_review_sources"("review_id");

-- CreateIndex
CREATE UNIQUE INDEX "code_review_sources_review_id_chunk_id_key" ON "code_review_sources"("review_id", "chunk_id");

-- CreateIndex
CREATE INDEX "code_review_findings_review_id_idx" ON "code_review_findings"("review_id");

-- CreateIndex
CREATE INDEX "code_review_finding_sources_finding_id_idx" ON "code_review_finding_sources"("finding_id");

-- CreateIndex
CREATE INDEX "code_review_finding_sources_source_id_idx" ON "code_review_finding_sources"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "code_review_finding_sources_finding_id_source_id_key" ON "code_review_finding_sources"("finding_id", "source_id");

-- AddForeignKey
ALTER TABLE "code_reviews" ADD CONSTRAINT "code_reviews_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_reviews" ADD CONSTRAINT "code_reviews_codebase_index_id_fkey" FOREIGN KEY ("codebase_index_id") REFERENCES "codebase_indexes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_review_sources" ADD CONSTRAINT "code_review_sources_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "code_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_review_sources" ADD CONSTRAINT "code_review_sources_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "code_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_review_findings" ADD CONSTRAINT "code_review_findings_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "code_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_review_finding_sources" ADD CONSTRAINT "code_review_finding_sources_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "code_review_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_review_finding_sources" ADD CONSTRAINT "code_review_finding_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "code_review_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
