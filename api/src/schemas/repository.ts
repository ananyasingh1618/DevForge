import { z } from "zod";

// Written as an explicit char-code scan rather than a `\x00-\x1f` regex
// class, which ESLint's no-control-regex rule (correctly) flags as
// suspicious in most contexts — here it's a deliberate security check, not
// an accidental control character, so this avoids fighting the lint rule
// with a suppression comment for a two-line function.
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

// GitHub owner (user/org) names: alphanumeric or single hyphens, never
// starting or ending with one. Repo names: alphanumeric plus ._-.
const githubOwnerSchema = z
  .string()
  .trim()
  .min(1, "Owner is required")
  .max(39, "Owner must be 39 characters or fewer")
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, "Invalid GitHub owner name");

// `.` and `..` are excluded even though they otherwise match the character
// class: found during Milestone 16.4's security audit that a repo value of
// exactly "." or ".." survives this regex but, once concatenated into a
// GitHub API request path and parsed by the WHATWG URL parser inside
// fetch(), normalizes away a path segment — e.g. owner "someowner" + repo
// ".." becomes the request path "/repos/someowner/.." which URL-normalizes
// to "/repos/", not the intended endpoint. GitHub's own routing happens to
// 404 the resulting confused paths today, so this was not an exploitable
// bug in practice, but it's exactly the kind of defense-in-depth gap this
// milestone exists to close rather than leave to incidental 404s.
const githubRepoSchema = z
  .string()
  .trim()
  .min(1, "Repository name is required")
  .max(100, "Repository name must be 100 characters or fewer")
  .regex(/^[A-Za-z0-9_.-]+$/, "Invalid GitHub repository name")
  .refine((value) => value !== "." && value !== "..", "Repository name cannot be '.' or '..'");

export const connectRepositorySchema = z.object({
  token: z
    .string()
    .trim()
    .min(10, "Token looks too short to be a valid GitHub personal access token")
    .max(500, "Token is unexpectedly long"),
  owner: githubOwnerSchema,
  repo: githubRepoSchema,
});

// A real GitHub branch name can never contain a control character or a
// literal ".." path segment (git itself forbids both) — updateBranch()'s
// own live GitHub-branch-allowlist check (services/repository.ts) is the
// primary defense here (an arbitrary string can never be persisted unless
// GitHub itself returned it as a real branch), but this schema-level regex
// adds a second, independent gate at the boundary rather than relying on
// that allowlist check alone (Milestone 16.4's own defense-in-depth
// standard, matching the owner/repo pattern above).
export const updateBranchSchema = z.object({
  branch: z
    .string()
    .trim()
    .min(1, "Branch is required")
    .max(255, "Branch name must be 255 characters or fewer")
    .refine((value) => !hasControlCharacter(value), "Branch name contains control characters")
    .refine((value) => !value.includes(".."), "Branch name cannot contain '..'"),
});

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export type ConnectRepositoryInput = z.infer<typeof connectRepositorySchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
