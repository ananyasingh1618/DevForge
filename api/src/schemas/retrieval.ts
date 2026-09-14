import { z } from "zod";

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const searchRequestSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Query is required")
    .max(2000, "Query must be 2000 characters or fewer"),
  branch: z.string().trim().min(1).max(255).optional(),
  commit: z.string().trim().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type SearchRequestInput = z.infer<typeof searchRequestSchema>;
