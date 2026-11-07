import { resolve } from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

dotenv.config({ path: resolve(__dirname, "../.env") });

const rawUrl = process.env.DATABASE_URL || "";
const isRemote =
  rawUrl &&
  !rawUrl.includes("127.0.0.1") &&
  !rawUrl.includes("localhost");

// If connecting to remote Supabase / cloud DB, strip sslmode parameter from URL
// so that pg-connection-string doesn't override our custom SSL settings.
// Also ensure Supabase pooler uses port 6543 (transaction mode) if 5432 was given,
// to avoid EMAXCONNSESSION (max clients reached in session mode limit: 15).
let connectionString = isRemote
  ? rawUrl.replace(/([?&])sslmode=[^&]*(&?)/g, (_m, p1, p2) => (p2 && p1 === "?" ? "?" : "")).replace(/[?&]$/, "")
  : rawUrl;

if (connectionString.includes(".pooler.supabase.com:5432")) {
  connectionString = connectionString.replace(".pooler.supabase.com:5432", ".pooler.supabase.com:6543");
}

const pool = new Pool({
  connectionString,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export { pool };
export default prisma;
