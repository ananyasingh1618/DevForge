import { z } from "zod";

export const epicItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  objective: z.string().min(1),
  businessValue: z.string().min(1),
  scope: z.string().min(1),
  acceptanceCriteria: z.array(z.string()),
  dependencies: z.array(z.string()),
  relatedComponents: z.array(z.string()),
});

export const epicContentSchema = z.object({
  epics: z.array(epicItemSchema),
});

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const versionParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
  versionId: z.string().uuid("Invalid epic version id"),
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

export type EpicItem = z.infer<typeof epicItemSchema>;
export type EpicContent = z.infer<typeof epicContentSchema>;
