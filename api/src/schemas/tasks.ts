import { z } from "zod";

export const taskItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(["feature", "bug", "chore"]),
  priority: z.enum(["high", "medium", "low"]),
  acceptanceCriteria: z.array(z.string()),
  dependencies: z.array(z.string()),
  epicId: z.string().min(1),
  relatedComponent: z.string(),
  estimatedComplexity: z.enum(["small", "medium", "large"]),
  suggestedOrder: z.number().int(),
});

export const taskContentSchema = z.object({
  tasks: z.array(taskItemSchema),
});

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const versionParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
  versionId: z.string().uuid("Invalid task version id"),
});

export const compareQuerySchema = z
  .object({
    a: z.string().uuid("Invalid version id"),
    b: z.string().uuid("Invalid version id"),
  })
  .refine((data) => data.a !== data.b, {
    message: "a and b must be different version ids",
    path: ["b"],
  });

export type TaskItem = z.infer<typeof taskItemSchema>;
export type TaskContent = z.infer<typeof taskContentSchema>;
