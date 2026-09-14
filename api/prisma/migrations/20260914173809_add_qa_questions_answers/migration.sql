-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "codebase_index_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "insufficient_evidence" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_sources" (
    "id" TEXT NOT NULL,
    "answer_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "source_order" INTEGER NOT NULL,
    "cited" BOOLEAN NOT NULL DEFAULT false,
    "score" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "answer_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "questions_project_id_idx" ON "questions"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "answers_question_id_key" ON "answers"("question_id");

-- CreateIndex
CREATE INDEX "answer_sources_answer_id_idx" ON "answer_sources"("answer_id");

-- CreateIndex
CREATE UNIQUE INDEX "answer_sources_answer_id_chunk_id_key" ON "answer_sources"("answer_id", "chunk_id");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_codebase_index_id_fkey" FOREIGN KEY ("codebase_index_id") REFERENCES "codebase_indexes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_sources" ADD CONSTRAINT "answer_sources_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_sources" ADD CONSTRAINT "answer_sources_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "code_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
