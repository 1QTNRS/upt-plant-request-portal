import { PrismaClient } from "@prisma/client";

import { resolveDatabaseUrl } from "./lib/env.server";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

// Prisma reads DATABASE_URL from the environment when the client is
// constructed. Setting it here keeps local development working with no `.env`
// while still requiring an explicit URL in production.
process.env.DATABASE_URL = resolveDatabaseUrl();

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
