import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@kebo/database";
import { ENV, type Env } from "../config/env";
import { CompanyContext } from "../common/company/company-context";

/** A company's connection is closed after this long unused. */
const IDLE_MS = 10 * 60_000;

/**
 * The database. Company data is only reachable through a company connection:
 * it runs as the restricted role with that company set, so row-level security
 * shows and changes only that company's rows, and new rows are tagged with it.
 *
 * - `prisma.db` / `prisma.tx(fn)`: the current company's (from the request or job);
 *   with no company they throw, so company data is never read without one.
 * - `prisma.company(id)`: a given company's (background jobs, the platform admin).
 * - `prisma.platform`: the owner's connection, for the platform's own tables
 *   (companies, plans, leads…). Never for company data.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly platform: PrismaClient;
  private readonly clients = new Map<string, { client: PrismaClient; usedAt: number }>();
  private readonly sweep: NodeJS.Timeout;
  private readonly log = new Logger("Database");

  constructor(@Inject(ENV) private readonly env: Env) {
    this.platform = createPrismaClient({ url: env.DATABASE_URL, poolSize: 5, logQueries: process.env.LOG_QUERIES === "true" });
    this.sweep = setInterval(() => void this.closeIdle(), 60_000);
    this.sweep.unref();
  }

  /** The current company's connection. */
  get db(): PrismaClient {
    return this.company(CompanyContext.require().id);
  }

  /** One company's connection (opened on first use, closed when idle). */
  company(companyId: string): PrismaClient {
    const hit = this.clients.get(companyId);
    if (hit) {
      hit.usedAt = Date.now();
      return hit.client;
    }
    const client = createPrismaClient({
      url: this.env.DATABASE_URL,
      companyId,
      poolSize: this.env.COMPANY_POOL_SIZE,
      logQueries: process.env.LOG_QUERIES === "true",
    });
    this.clients.set(companyId, { client, usedAt: Date.now() });
    return client;
  }

  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn as never, { timeout: 15_000 }) as Promise<T>;
  }

  /** A company is gone (deleted): drop its connection. */
  async forget(companyId: string) {
    const hit = this.clients.get(companyId);
    this.clients.delete(companyId);
    await hit?.client.$disconnect().catch(() => undefined);
  }

  private async closeIdle() {
    const now = Date.now();
    for (const [id, c] of this.clients) {
      if (now - c.usedAt < IDLE_MS) continue;
      this.clients.delete(id);
      await c.client.$disconnect().catch((e) => this.log.warn(`closing a company connection failed: ${(e as Error).message}`));
    }
  }

  async onModuleDestroy() {
    clearInterval(this.sweep);
    await Promise.all([this.platform.$disconnect(), ...[...this.clients.values()].map((c) => c.client.$disconnect())]);
    this.clients.clear();
  }
}

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
