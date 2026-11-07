import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: resolve(__dirname, "../.env") });

import prisma from "../config/prisma";

async function main() {
  console.log("----------------------------------------");
  console.log("Checking Database Connection...");
  const rawUrl = process.env.DATABASE_URL || "";
  try {
    const url = new URL(rawUrl);
    console.log(`Host:     ${url.hostname}`);
    console.log(`Port:     ${url.port || "5432"}`);
    console.log(`Database: ${url.pathname.replace(/^\//, "")}`);
    console.log(`User:     ${url.username}`);
  } catch {
    console.log("DATABASE_URL is not a valid URI format.");
  }
  console.log("----------------------------------------\n");

  try {
    console.log("Connecting via Prisma and executing SELECT 1...");
    const result = await prisma.$queryRaw`SELECT 1 as connected`;
    console.log("✅ Success! Database is reachable and responsive:", result);

    console.log("\nChecking table access ('WeeklyPlanRun')...");
    const count = await prisma.weeklyPlanRun.count();
    console.log(`✅ Table access verified! WeeklyPlanRun count: ${count}`);
  } catch (error: any) {
    console.error("\n❌ Database connection failed!");
    console.error("Error Code:", error?.code || "NONE");
    console.error("Error Message:", error?.message || error);
    if (error?.code === "P1001") {
      console.error(
        "\n💡 Hint: Can't reach database server. If using Supabase:\n" +
          "1. Check if your project is paused at https://supabase.com/dashboard\n" +
          "2. Supabase direct connections (db.<ref>.supabase.co:5432) are IPv6-only.\n" +
          "   If your network doesn't support IPv6, switch to the Supabase connection pooler host (port 5432/6543) in your .env."
      );
    } else if (error?.code === "P1000") {
      console.error("\n💡 Hint: Authentication failed. Check your database password in .env.");
    } else if (error?.code === "P2021" || error?.message?.includes("does not exist")) {
      console.error("\n💡 Hint: The table does not exist. Run 'npx prisma db push' to apply the schema.");
    }
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

main();
