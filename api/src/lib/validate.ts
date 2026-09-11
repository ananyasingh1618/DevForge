import type { ZodType } from "zod";
import { AppError } from "./errors.js";

/**
 * Parses `input` against `schema`, throwing a structured 400 AppError (with
 * per-field messages) on failure instead of a raw Zod error. Used for request
 * bodies and route params alike.
 */
export function parseWithSchema<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw AppError.badRequest("Invalid request", result.error.flatten().fieldErrors);
  }
  return result.data;
}
