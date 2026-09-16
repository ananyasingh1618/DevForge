import type { SafeUser } from "../services/auth.js";

declare global {
  namespace Express {
    interface Request {
      user?: SafeUser;
      /** Correlation ID for this request (Phase 17, Milestone 17.5) —
       * always set by middleware/requestContext.ts before any route
       * handler runs. See that file's own doc comment. */
      requestId: string;
    }
  }
}

export {};
