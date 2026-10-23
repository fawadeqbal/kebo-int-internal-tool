import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction — repositories accept either. */
export type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __qmsPool?: Pool; __qmsDb?: Database };

function createDb(): Database {
  const pool =
    globalForDb.__qmsPool ??
    new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX ?? 10),
    });
  globalForDb.__qmsPool = pool;
  return drizzle(pool, { schema });
}

/** Single shared connection pool (re-used across hot reloads in development). */
export const db: Database = globalForDb.__qmsDb ?? (globalForDb.__qmsDb = createDb());
export { schema };
