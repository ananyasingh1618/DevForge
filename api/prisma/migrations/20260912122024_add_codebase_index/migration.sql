-- CreateEnum
CREATE TYPE "CodebaseIndexStatus" AS ENUM ('pending', 'indexing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "FileParseStatus" AS ENUM ('parsed', 'unsupported', 'parse_error', 'skipped_binary', 'skipped_too_large', 'skipped_index_limit');

-- CreateTable
CREATE TABLE "codebase_indexes" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "repository_connection_id" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "commit_sha" TEXT,
    "status" "CodebaseIndexStatus" NOT NULL DEFAULT 'pending',
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "parsed_file_count" INTEGER NOT NULL DEFAULT 0,
    "failed_file_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "codebase_indexes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indexed_files" (
    "id" TEXT NOT NULL,
    "index_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "language" TEXT,
    "size_bytes" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "parse_status" "FileParseStatus" NOT NULL,
    "parse_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexed_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "symbols" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "start_line" INTEGER NOT NULL,
    "end_line" INTEGER NOT NULL,
    "parent_id" TEXT,
    "signature" TEXT,

    CONSTRAINT "symbols_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "codebase_indexes_project_id_key" ON "codebase_indexes"("project_id");

-- CreateIndex
CREATE INDEX "codebase_indexes_repository_connection_id_idx" ON "codebase_indexes"("repository_connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "indexed_files_index_id_path_key" ON "indexed_files"("index_id", "path");

-- CreateIndex
CREATE INDEX "symbols_file_id_idx" ON "symbols"("file_id");

-- CreateIndex
CREATE INDEX "symbols_parent_id_idx" ON "symbols"("parent_id");

-- AddForeignKey
ALTER TABLE "codebase_indexes" ADD CONSTRAINT "codebase_indexes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codebase_indexes" ADD CONSTRAINT "codebase_indexes_repository_connection_id_fkey" FOREIGN KEY ("repository_connection_id") REFERENCES "repository_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indexed_files" ADD CONSTRAINT "indexed_files_index_id_fkey" FOREIGN KEY ("index_id") REFERENCES "codebase_indexes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "symbols" ADD CONSTRAINT "symbols_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "indexed_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "symbols" ADD CONSTRAINT "symbols_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "symbols"("id") ON DELETE SET NULL ON UPDATE CASCADE;
