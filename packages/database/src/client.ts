import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export interface DatabaseOptions {
  url: string;
  /** Log every query (development only). */
  logQueries?: boolean;
  /** Connections in the pool (default 10). */
  poolSize?: number;
}

/** One client per process: the API creates it once in its Prisma module; scripts create their own. */
export function createPrismaClient({ url, logQueries = false, poolSize = 10 }: DatabaseOptions): PrismaClient {
  const adapter = new PrismaPg({ connectionString: url, max: poolSize });
  return new PrismaClient({ adapter, log: logQueries ? ["query", "warn", "error"] : ["warn", "error"] });
}

export { PrismaClient };

/** A client or an open transaction: repositories accept either, so callers decide the transaction boundary. */
export type Db = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
