/**
 * A single structured error type used everywhere in the API so every failure
 * response shares one JSON envelope: { error: { code, message, details? } }.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, "VALIDATION_ERROR", message, details);
  }

  static unauthenticated(message = "Authentication required") {
    return new AppError(401, "UNAUTHENTICATED", message);
  }

  static notFound(message = "Not found") {
    return new AppError(404, "NOT_FOUND", message);
  }

  static conflict(code: string, message: string) {
    return new AppError(409, code, message);
  }
}
