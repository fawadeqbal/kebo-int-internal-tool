import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Prisma } from "@kebo/database";
import type { Request } from "express";
import { from, type Observable } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { PrismaService } from "../../database/prisma.service";

/**
 * Saves that check the version they started from. A form sends `If-Match: <the record's updatedAt when it was
 * opened>`; when the record changed since (someone else saved it), the save is refused (409 "stale") with who
 * changed it and when, instead of quietly overwriting their work. Without the header, a save works as before.
 */
export const VERSIONED = "kebo:versioned";
const TABLES = ["parties", "inquiries", "orders", "expenses", "money_movements"] as const;
type Table = (typeof TABLES)[number];
/** The record is the row of `table` whose id is the route's `:id`. */
export const Versioned = (table: Table) => SetMetadata(VERSIONED, table);

@Injectable()
export class VersionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const table = this.reflector.get<Table | undefined>(VERSIONED, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<Request>();
    const seen = req.header("if-match")?.trim();
    if (!table || !seen || !TABLES.includes(table)) return next.handle();
    return from(this.check(table, String(req.params.id ?? ""), seen)).pipe(mergeMap(() => next.handle()));
  }

  private async check(table: Table, id: string, seen: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return;
    const [row] = await this.prisma.db.$queryRaw<{ updated_at: Date }[]>`select updated_at from ${Prisma.raw(`"${table}"`)} where id = ${id}::uuid`;
    if (!row || Math.abs(row.updated_at.getTime() - Date.parse(seen)) < 1) return;
    const [who] = await this.prisma.db.$queryRaw<{ name: string | null }[]>`
      select u.name from audit_logs a left join users u on u.id = a.user_id where a.entity_id = ${id}::uuid order by a.created_at desc limit 1`;
    const minutes = Math.round((Date.now() - row.updated_at.getTime()) / 60_000);
    const when = minutes < 1 ? "just now" : minutes < 120 ? `${minutes} minute${minutes === 1 ? "" : "s"} ago` : `${Math.round(minutes / 60)} hours ago`;
    throw new ConflictException({
      message: `${who?.name ?? "Someone"} changed this while you had it open (${when}). Reload to see their change, then make yours again.`,
      code: "stale",
    });
  }
}
