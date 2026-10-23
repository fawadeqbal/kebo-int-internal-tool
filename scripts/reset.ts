/**
 * Wipes the database so it can be migrated and seeded again from scratch:
 *   npm run db:reset            → empty system with the 3 starting accounts
 *   npm run db:reset -- --demo  → the same plus sample customers, inquiries, quotations and invoices
 *
 * Every inquiry, customer, quotation, invoice, user and setting is deleted.
 * For safety it only runs against a database on this computer, unless
 * RESET_CONFIRM=delete-everything is set.
 */
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (check your .env file)");
  const { hostname, pathname } = new URL(url);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  if (process.env.NODE_ENV === "production" || (!local && process.env.RESET_CONFIRM !== "delete-everything")) {
    console.error(`[reset] refused: ${hostname} is not a database on this computer. Set RESET_CONFIRM=delete-everything to wipe it anyway.`);
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  console.log(`[reset] wiping database ${pathname.slice(1)} on ${hostname} …`);
  await pool.query(`DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await pool.end();
  console.log("[reset] done. Running migrations and seed next.");
}

main().catch((error) => {
  console.error("[reset] failed", error);
  process.exit(1);
});
