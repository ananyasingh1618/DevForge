-- CreateEnum
CREATE TYPE "RepositoryConnectionStatus" AS ENUM ('pending', 'verified', 'error');

-- CreateTable
CREATE TABLE "repository_connections" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "github_owner" TEXT NOT NULL,
    "github_repo" TEXT NOT NULL,
    "github_repo_id" TEXT,
    "github_account_login" TEXT,
    "repository_url" TEXT NOT NULL,
    "default_branch" TEXT,
    "selected_branch" TEXT,
    "status" "RepositoryConnectionStatus" NOT NULL DEFAULT 'pending',
    "last_verified_at" TIMESTAMP(3),
    "last_error" TEXT,
    "encrypted_token" TEXT NOT NULL,
    "token_last_4" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repository_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repository_connections_project_id_key" ON "repository_connections"("project_id");

-- AddForeignKey
ALTER TABLE "repository_connections" ADD CONSTRAINT "repository_connections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
