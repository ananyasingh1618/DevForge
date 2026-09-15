-- CreateEnum
CREATE TYPE "EvaluationRunMode" AS ENUM ('mock', 'real');

-- CreateTable
CREATE TABLE "evaluation_runs" (
    "id" TEXT NOT NULL,
    "dataset_version" TEXT NOT NULL,
    "evaluator_version" TEXT NOT NULL,
    "mode" "EvaluationRunMode" NOT NULL,
    "git_commit" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "total_cases" INTEGER NOT NULL,
    "failed_case_count" INTEGER NOT NULL,
    "retrieval_metrics" JSONB NOT NULL,
    "qa_metrics" JSONB NOT NULL,
    "review_metrics" JSONB NOT NULL,
    "report_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evaluation_runs_created_at_idx" ON "evaluation_runs"("created_at");
