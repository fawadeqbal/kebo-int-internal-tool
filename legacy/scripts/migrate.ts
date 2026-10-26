/**
 * Applies pending database migrations. Runs automatically when the app container starts.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "drizzle");
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("select 1");
      break;
    } catch (error) {
      if (attempt >= 30) throw error;
      console.log(`[migrate] waiting for database (attempt ${attempt})…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await migrate(drizzle(pool), { migrationsFolder });
  console.log("[migrate] database is up to date");
  await pool.end();
}

main().catch((error) => {
  console.error("[migrate] failed", error);
  process.exit(1);
});
