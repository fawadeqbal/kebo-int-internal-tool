import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { COMPANY_ROLE } from "./company-role";

export interface DatabaseOptions {
  /**
   * Where to connect. A company connection must log in as the company role
   * (companyDatabaseUrl()), never as the owner: the owner is a superuser, and a
   * superuser is not held by row-level security.
   */
  url: string;
  /** Log every query (development only). */
  logQueries?: boolean;
  /** Connections in the pool (default 10). */
  poolSize?: number;
  /**
   * A company connection: logs in as the restricted role with this company set
   * when it connects, so row-level security shows and changes only that
   * company's rows, and new rows are tagged with it. Without it the client is
   * the owner's (platform tables, scripts that work across companies).
   */
  companyId?: string;
  /** Close connections idle this long (default 30 s). */
  idleTimeoutMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres start-up options: every connection runs in UTC; a company one also
 * names its company. The policies read the company as it was at connect time
 * (app_company()), so SQL run later on the connection cannot move it to another.
 */
export function connectionOptions(companyId?: string): string {
  const opts = ["-c TimeZone=UTC"];
  if (companyId !== undefined) {
    if (!UUID.test(companyId)) throw new Error("Not a company id");
    // The role too: nothing when it logs in as the company role (as it must); a second lock otherwise.
    opts.push(`-c role=${COMPANY_ROLE}`, `-c app.company_id=${companyId}`);
  }
  return opts.join(" ");
}

export function createPrismaClient({
  url,
  logQueries = false,
  poolSize = 10,
  companyId,
  idleTimeoutMs = 30_000,
}: DatabaseOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: url,
    max: poolSize,
    idleTimeoutMillis: idleTimeoutMs,
    options: connectionOptions(companyId),
  });
  return new PrismaClient({ adapter, log: logQueries ? ["query", "warn", "error"] : ["warn", "error"] });
}

export { PrismaClient };

/** A client or an open transaction: repositories accept either, so callers decide the transaction boundary. */
export type Db = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
