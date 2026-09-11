-- CreateTable
CREATE TABLE "architecture_versions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source_prd_version_id" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "architecture_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "architecture_versions_project_id_idx" ON "architecture_versions"("project_id");

-- CreateIndex
CREATE INDEX "architecture_versions_source_prd_version_id_idx" ON "architecture_versions"("source_prd_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "architecture_versions_project_id_version_key" ON "architecture_versions"("project_id", "version");

-- AddForeignKey
ALTER TABLE "architecture_versions" ADD CONSTRAINT "architecture_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "architecture_versions" ADD CONSTRAINT "architecture_versions_source_prd_version_id_fkey" FOREIGN KEY ("source_prd_version_id") REFERENCES "prd_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
