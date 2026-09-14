import { z } from "zod";

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const reviewIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
  reviewId: z.string().uuid("Invalid review id"),
});

export const createReviewSchema = z.object({
  scope: z
    .string()
    .trim()
    .min(1, "Scope must not be blank")
    .max(2000, "Scope must be 2000 characters or fewer")
    .optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
