import { z } from "zod";

export const evaluationRunIdParamSchema = z.object({
  runId: z.string().uuid("Invalid evaluation run id"),
});
