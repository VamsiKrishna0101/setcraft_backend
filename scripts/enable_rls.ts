import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: resolve(__dirname, "../.env") });

import prisma from "../config/prisma";

async function main() {
  console.log("----------------------------------------");
  console.log("Enabling Row Level Security (RLS) on all public tables...");
  console.log("----------------------------------------");

  // Query all tables in public schema
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename NOT LIKE '_prisma_%'
    ORDER BY tablename ASC;
  `;

  if (!tables.length) {
    console.log("No tables found in public schema.");
    return;
  }

  console.log(`Found ${tables.length} tables in public schema.`);

  for (const { tablename } of tables) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE public."${tablename}" ENABLE ROW LEVEL SECURITY;`
    );
    console.log(`  🔒 Enabled RLS on: public."${tablename}"`);
  }

  console.log("\n✅ Done! All public tables now have Row Level Security enabled.");
  console.log("ℹ️ Note: Your backend connects as user 'postgres' (which has BYPASSRLS), so server operations are unaffected.");
}

main()
  .catch((error) => {
    console.error("\n❌ Error enabling RLS:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
