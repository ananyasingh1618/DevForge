import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../env.js";

// Prisma 7 requires an explicit driver adapter at runtime (schema-level
// `datasource.url` is only used by the Migrate CLI via prisma.config.ts).
// Explicit pool sizing/timeouts (Phase 17, Milestone 17.3) — previously
// left at the `pg` driver's own defaults, which are reasonable for local
// development but not documented, deliberate, or tuned for this project's
// own traffic shape. See DATABASE_POOL_MAX's own comment in env.ts.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: env.DATABASE_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS,
});

export const prisma = new PrismaClient({ adapter });
