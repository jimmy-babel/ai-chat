import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { adapterDatabaseUrl } from "@/server/db-url";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const adapter = new PrismaMariaDb(adapterDatabaseUrl());
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function getDefaultUser() {
  const existing = await prisma.user.findFirst({
    where: { isDefault: true },
  });

  if (existing) return existing;

  return prisma.user.upsert({
    where: { email: "local@ai-chat.dev" },
    update: { isDefault: true, name: "Jimmy" },
    create: {
      email: "local@ai-chat.dev",
      isDefault: true,
      name: "Jimmy",
    },
  });
}
