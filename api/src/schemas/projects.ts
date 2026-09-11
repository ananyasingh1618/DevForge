import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be 100 characters or fewer"),
  description: z.string().trim().max(2000, "Description must be 2000 characters or fewer").optional(),
});

export const projectIdParamSchema = z.object({
  id: z.string().uuid("Invalid project id"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
