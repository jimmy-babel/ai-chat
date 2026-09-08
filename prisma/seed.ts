import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import dotenv from "dotenv";
import { PrismaClient } from "../src/generated/prisma/client";
import { adapterDatabaseUrl } from "../src/server/db-url";

dotenv.config({ path: ".env.local" });
dotenv.config();

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(adapterDatabaseUrl()),
});

async function main() {
  await prisma.user.upsert({
    where: { email: "local@ai-chat.dev" },
    update: { isDefault: true, name: "Jimmy" },
    create: {
      email: "local@ai-chat.dev",
      isDefault: true,
      name: "Jimmy",
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
