import { z } from "zod";

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const questionParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
  questionId: z.string().uuid("Invalid question id"),
});

export const askQuestionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "Question is required")
    .max(2000, "Question must be 2000 characters or fewer"),
});

export type AskQuestionInput = z.infer<typeof askQuestionSchema>;
