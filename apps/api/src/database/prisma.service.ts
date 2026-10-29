import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { assertCompanyLogin, companyDatabaseUrl, createPrismaClient, prepareCompanyRole, type PrismaClient } from "@kebo/database";
import { ENV, type Env } from "../config/env";
import { CompanyContext } from "../common/company/company-context";
import { CompanyPools } from "./company-pools";

/** A company's connection is closed after this long unused. */
const IDLE_MS = 10 * 60_000;
/** A connection closed to make room is ended this long after, so work still using it finishes (transactions time out at 15 s). */
const GRACE_MS = 30_000;
/** Closed connections waiting out that time at once. */
const MAX_CLOSING = 5;

/**
 * The database. Company data is only reachable through a company connection:
 * it logs in as the restricted role kebo_app with that company set, so
 * row-level security shows and changes only that company's rows, and new rows
 * are tagged with it. kebo_app is no superuser and cannot become the owner, and
 * the policies follow the company the connection was opened for (see the
 * company_role migration), so no SQL run on it can reach another company.
 *
 * - `prisma.db` / `prisma.tx(fn)`: the current company's (from the request or job);
 *   with no company they throw, so company data is never read without one.
 * - `prisma.company(id)`: a given company's (background jobs, the platform admin).
 * - `prisma.platform`: the owner's connection, for the platform's own tables
 *   (companies, plans, leads…). Never for company data.
 *
 * Connections: the owner's pool (5), and up to COMPANY_POOLS_MAX companies' pools
 * of COMPANY_POOL_SIZE each (the least recently used company's is closed to make
 * room; a few just closed may finish their work first). Defaults: at most
 * 5 + (20 + 5) × 2 = 55 per process, API and worker together 110, under
 * Postgres' max_connections of 200.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly platform: PrismaClient;
  private readonly pools: CompanyPools<PrismaClient>;
  private readonly companyUrl: string;
  private readonly sweep: NodeJS.Timeout;
  private readonly log = new Logger("Database");

  constructor(@Inject(ENV) private readonly env: Env) {
    const logQueries = process.env.LOG_QUERIES === "true";
    this.platform = createPrismaClient({ url: env.DATABASE_URL, poolSize: 5, logQueries });
    this.companyUrl = companyDatabaseUrl(env.DATABASE_URL, env.AUTH_SECRET, env.COMPANY_DATABASE_URL);
    this.pools = new CompanyPools<PrismaClient>({
      max: env.COMPANY_POOLS_MAX,
      maxClosing: MAX_CLOSING,
      idleMs: IDLE_MS,
      graceMs: GRACE_MS,
      create: (companyId) => createPrismaClient({ url: this.companyUrl, companyId, poolSize: env.COMPANY_POOL_SIZE, logQueries }),
      close: (client) => client.$disconnect().catch((e) => this.log.warn(`closing a company connection failed: ${(e as Error).message}`)),
    });
    this.sweep = setInterval(() => this.pools.sweep(), 60_000);
    this.sweep.unref();
  }

  /** The company role can log in (with its password from AUTH_SECRET) before anything opens a company. */
  async onModuleInit() {
    if (!this.env.COMPANY_DATABASE_URL) {
      const done = await prepareCompanyRole(this.env.DATABASE_URL, this.env.AUTH_SECRET);
      if (done.length) this.log.log(`company connections' database role: ${done.join(", ")}`);
    }
    await assertCompanyLogin(this.companyUrl);
  }

  /** The current company's connection. */
  get db(): PrismaClient {
    return this.company(CompanyContext.require().id);
  }

  /** One company's connection (opened on first use, closed when idle or to make room). */
  company(companyId: string): PrismaClient {
    return this.pools.get(companyId);
  }

  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn as never, { timeout: 15_000 }) as Promise<T>;
  }

  /** A company is gone (deleted): drop its connection. */
  async forget(companyId: string) {
    await this.pools.forget(companyId);
  }

  async onModuleDestroy() {
    clearInterval(this.sweep);
    await Promise.all([this.platform.$disconnect(), this.pools.closeAll()]);
  }
}

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
