import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../env.js";

// Prisma 7 requires an explicit driver adapter at runtime (schema-level
// `datasource.url` is only used by the Migrate CLI via prisma.config.ts).
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
