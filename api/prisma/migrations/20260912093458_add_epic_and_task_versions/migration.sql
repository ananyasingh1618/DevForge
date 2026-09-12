-- CreateTable
CREATE TABLE "epic_versions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source_architecture_version_id" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "epic_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_versions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source_epic_version_id" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "epic_versions_project_id_idx" ON "epic_versions"("project_id");

-- CreateIndex
CREATE INDEX "epic_versions_source_architecture_version_id_idx" ON "epic_versions"("source_architecture_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "epic_versions_project_id_version_key" ON "epic_versions"("project_id", "version");

-- CreateIndex
CREATE INDEX "task_versions_project_id_idx" ON "task_versions"("project_id");

-- CreateIndex
CREATE INDEX "task_versions_source_epic_version_id_idx" ON "task_versions"("source_epic_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_versions_project_id_version_key" ON "task_versions"("project_id", "version");

-- AddForeignKey
ALTER TABLE "epic_versions" ADD CONSTRAINT "epic_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epic_versions" ADD CONSTRAINT "epic_versions_source_architecture_version_id_fkey" FOREIGN KEY ("source_architecture_version_id") REFERENCES "architecture_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_versions" ADD CONSTRAINT "task_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_versions" ADD CONSTRAINT "task_versions_source_epic_version_id_fkey" FOREIGN KEY ("source_epic_version_id") REFERENCES "epic_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
