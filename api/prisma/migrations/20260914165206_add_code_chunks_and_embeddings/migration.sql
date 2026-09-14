-- CreateTable
CREATE TABLE "code_chunks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "codebase_index_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "symbol_id" TEXT,
    "branch" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "start_line" INTEGER NOT NULL,
    "end_line" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embeddings" (
    "id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vector" DOUBLE PRECISION[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "code_chunks_project_id_idx" ON "code_chunks"("project_id");

-- CreateIndex
CREATE INDEX "code_chunks_codebase_index_id_commit_sha_idx" ON "code_chunks"("codebase_index_id", "commit_sha");

-- CreateIndex
CREATE UNIQUE INDEX "code_chunks_codebase_index_id_commit_sha_content_hash_key" ON "code_chunks"("codebase_index_id", "commit_sha", "content_hash");

-- CreateIndex
CREATE INDEX "embeddings_chunk_id_idx" ON "embeddings"("chunk_id");

-- CreateIndex
CREATE UNIQUE INDEX "embeddings_chunk_id_model_key" ON "embeddings"("chunk_id", "model");

-- AddForeignKey
ALTER TABLE "code_chunks" ADD CONSTRAINT "code_chunks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_chunks" ADD CONSTRAINT "code_chunks_codebase_index_id_fkey" FOREIGN KEY ("codebase_index_id") REFERENCES "codebase_indexes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_chunks" ADD CONSTRAINT "code_chunks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "indexed_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_chunks" ADD CONSTRAINT "code_chunks_symbol_id_fkey" FOREIGN KEY ("symbol_id") REFERENCES "symbols"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "code_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
