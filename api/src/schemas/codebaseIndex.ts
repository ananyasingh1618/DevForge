import { z } from "zod";

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
});

export const fileIdParamSchema = z.object({
  projectId: z.string().uuid("Invalid project id"),
  fileId: z.string().uuid("Invalid file id"),
});
