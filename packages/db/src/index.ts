import { PrismaClient } from "@prisma/client";

declare global {
  var __jeanbotPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__jeanbotPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__jeanbotPrisma = prisma;
}
