import { z } from "zod";

export const architectureContentSchema = z.object({
  overview: z.string(),
  systemArchitecture: z.string(),
  technologyStack: z.array(z.string()),
  components: z.array(z.string()),
  dataModel: z.array(z.string()),
  apiDesign: z.array(z.string()),
  dataFlows: z.array(z.string()),
  security: z.array(z.string()),
  scalability: z.array(z.string()),
  deployment: z.array(z.string()),
  tradeoffs: z.array(z.string()),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
});

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const versionParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
  versionId: z.string().uuid("Invalid architecture version id"),
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

export type ArchitectureContent = z.infer<typeof architectureContentSchema>;
