import { z } from "zod";

// GitHub owner (user/org) names: alphanumeric or single hyphens, never
// starting or ending with one. Repo names: alphanumeric plus ._-.
const githubOwnerSchema = z
  .string()
  .trim()
  .min(1, "Owner is required")
  .max(39, "Owner must be 39 characters or fewer")
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, "Invalid GitHub owner name");

const githubRepoSchema = z
  .string()
  .trim()
  .min(1, "Repository name is required")
  .max(100, "Repository name must be 100 characters or fewer")
  .regex(/^[A-Za-z0-9_.-]+$/, "Invalid GitHub repository name");

export const connectRepositorySchema = z.object({
  token: z
    .string()
    .trim()
    .min(10, "Token looks too short to be a valid GitHub personal access token")
    .max(500, "Token is unexpectedly long"),
  owner: githubOwnerSchema,
  repo: githubRepoSchema,
});

export const updateBranchSchema = z.object({
  branch: z
    .string()
    .trim()
    .min(1, "Branch is required")
    .max(255, "Branch name must be 255 characters or fewer"),
});

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export type ConnectRepositoryInput = z.infer<typeof connectRepositorySchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
