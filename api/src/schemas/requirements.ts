import { z } from "zod";

export const requirementItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(["high", "medium", "low"]),
  source: z.enum(["stated", "inferred"]),
  acceptanceCriteria: z.array(z.string()),
});

export const requirementsContentSchema = z.object({
  projectSummary: z.string(),
  users: z.array(z.string()),
  functionalRequirements: z.array(requirementItemSchema),
  nonFunctionalRequirements: z.array(requirementItemSchema),
  // Defaulted to [] (unlike the other array fields above): a requirements
  // version created before these two fields existed has neither in its
  // stored JSON, and both this schema (PATCH's full-content-replace) and
  // the frontend read path need to tolerate that without failing — see
  // aiServiceClient.ts's mapAiRequirementsContentToCamelCase for the same
  // default applied to a version freshly analyzed by ai-service.
  features: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  constraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
});

export const analyzeRequirementsSchema = z.object({
  idea: z
    .string()
    .trim()
    .min(10, "Idea must be at least 10 characters")
    .max(5000, "Idea must be 5000 characters or fewer"),
});

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const versionParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
  versionId: z.string().uuid("Invalid requirements version id"),
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

export type RequirementItem = z.infer<typeof requirementItemSchema>;
export type RequirementsContent = z.infer<typeof requirementsContentSchema>;
export type AnalyzeRequirementsInput = z.infer<typeof analyzeRequirementsSchema>;
