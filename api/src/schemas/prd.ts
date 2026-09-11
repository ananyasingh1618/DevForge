import { z } from "zod";

export const prdContentSchema = z.object({
  overview: z.string(),
  problemStatement: z.string(),
  goals: z.array(z.string()),
  personas: z.array(z.string()),
  functionalRequirements: z.array(z.string()),
  nonFunctionalRequirements: z.array(z.string()),
  userWorkflows: z.array(z.string()),
  edgeCases: z.array(z.string()),
  successCriteria: z.array(z.string()),
  constraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
});

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const versionParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
  versionId: z.string().uuid("Invalid PRD version id"),
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

export type PrdContent = z.infer<typeof prdContentSchema>;
