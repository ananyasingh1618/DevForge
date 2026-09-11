-- CreateTable
CREATE TABLE "prd_versions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source_requirements_version_id" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prd_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prd_versions_project_id_idx" ON "prd_versions"("project_id");

-- CreateIndex
CREATE INDEX "prd_versions_source_requirements_version_id_idx" ON "prd_versions"("source_requirements_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "prd_versions_project_id_version_key" ON "prd_versions"("project_id", "version");

-- AddForeignKey
ALTER TABLE "prd_versions" ADD CONSTRAINT "prd_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prd_versions" ADD CONSTRAINT "prd_versions_source_requirements_version_id_fkey" FOREIGN KEY ("source_requirements_version_id") REFERENCES "requirements_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
