-- CreateTable
CREATE TABLE "requirements_versions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "idea_text" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirements_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "requirements_versions_project_id_idx" ON "requirements_versions"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "requirements_versions_project_id_version_key" ON "requirements_versions"("project_id", "version");

-- AddForeignKey
ALTER TABLE "requirements_versions" ADD CONSTRAINT "requirements_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
