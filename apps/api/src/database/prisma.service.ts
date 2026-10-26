import { Global, Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@kebo/database";
import { ENV, type Env } from "../config/env";

/**
 * The one database client of the process. Services use `prisma.db` for single
 * queries and `prisma.tx(fn)` when several writes must succeed or fail together.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly db: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.db = createPrismaClient({ url: env.DATABASE_URL, logQueries: process.env.LOG_QUERIES === "true" });
  }

  tx<T>(fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn as never, { timeout: 15_000 }) as Promise<T>;
  }

  async onModuleDestroy() {
    await this.db.$disconnect();
  }
}

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
