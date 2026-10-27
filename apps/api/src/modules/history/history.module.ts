import { Controller, Get, Injectable, Module, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { can } from "@kebo/shared";
import { ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Validate } from "../../common/http/zod.pipe";
import { CurrentUser } from "../../common/auth/decorators";
import type { SessionUser } from "../../common/auth/session-user";
import { inquiryAccess } from "../inquiries/inquiries.service";
import { orderAccess } from "../orders/orders.service";
import { CustomersService } from "../parties/customers.service";
import { PartiesModule } from "../parties/parties.module";

const historyQuery = z.object({ type: z.enum(["deal", "order", "customer", "factory"]), id: z.uuid("Unknown record") });
type HistoryQuery = z.infer<typeof historyQuery>;

/**
 * A record's history for everyone who may see the record: who changed what,
 * when, old → new, and why. A deal's history includes its factory prices,
 * quotation revisions, files and orders; an order's includes its payments.
 */
@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
  ) {}

  /** The audit entries that belong to the record, as { entityType: ids }. */
  private async scope(user: SessionUser, q: HistoryQuery): Promise<{ entityType: string; ids: string[] }[]> {
    const db = this.prisma.db;
    if (q.type === "deal") {
      const i = await db.inquiry.findFirst({
        where: { id: q.id, deletedAt: null, ...inquiryAccess(user) },
        select: {
          id: true,
          factoryQuotes: { select: { id: true } },
          quotation: { select: { revisions: { select: { id: true } } } },
          attachments: { select: { id: true, factoryQuoteId: true } },
          orders: { select: { id: true } },
        },
      });
      if (!i) throw new NotFoundError("Inquiry");
      const seeCosts = can(user, "sourcing.manage");
      return [
        { entityType: "inquiry", ids: [i.id] },
        { entityType: "factory_quote", ids: seeCosts ? i.factoryQuotes.map((f) => f.id) : [] },
        { entityType: "quotation", ids: i.quotation?.revisions.map((r) => r.id) ?? [] },
        // A factory offer's files only for people who see factory prices.
        { entityType: "attachment", ids: i.attachments.filter((a) => seeCosts || !a.factoryQuoteId).map((a) => a.id) },
        { entityType: "order", ids: i.orders.map((o) => o.id) },
      ];
    }
    if (q.type === "order") {
      const o = await db.order.findFirst({ where: { id: q.id, ...orderAccess(user) }, select: { id: true } });
      if (!o) throw new NotFoundError("Order");
      return [{ entityType: "order", ids: [o.id] }];
    }
    if (q.type === "customer") {
      await this.customers.get(user, q.id);
      return [{ entityType: "customer", ids: [q.id] }];
    }
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see factories.");
    const f = await db.factory.findFirst({ where: { id: q.id }, select: { id: true } });
    if (!f) throw new NotFoundError("Factory");
    return [{ entityType: "factory", ids: [f.id] }];
  }

  async list(user: SessionUser, q: HistoryQuery) {
    const scope = (await this.scope(user, q)).filter((s) => s.ids.length);
    // Expenses are for managers only; payments to factories for people who see costs.
    const hidden = [
      ...(can(user, "expenses.manage") ? [] : ["expense"]),
      ...(can(user, "sourcing.manage") ? [] : ["payment_out"]),
    ];
    const rows = await this.prisma.db.auditLog.findMany({
      where: {
        OR: scope.map((s) => ({ entityType: s.entityType, entityId: { in: s.ids } })),
        ...(hidden.length ? { NOT: hidden.map((h) => ({ action: { startsWith: h } })) } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    const ids = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
    const people = new Map(
      (await this.prisma.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u]),
    );
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      by: (r.userId && people.get(r.userId)) || null,
      action: r.action,
      entityType: r.entityType,
      summary: r.summary,
      reason: r.reason,
      changes: changesOf(r.oldValues, r.newValues),
    }));
  }
}

/** Fields whose value changed, as { field, from, to } (both objects are flat snapshots). */
export function changesOf(oldValues: unknown, newValues: unknown) {
  const o = (oldValues && typeof oldValues === "object" ? oldValues : {}) as Record<string, unknown>;
  const n = (newValues && typeof newValues === "object" ? newValues : {}) as Record<string, unknown>;
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
  return [...new Set([...Object.keys(o), ...Object.keys(n)])]
    .filter((k) => k !== "reason" && show(o[k]) !== show(n[k]))
    .map((k) => ({ field: k, from: show(o[k]), to: show(n[k]) }));
}

@ApiTags("history")
@Controller("history")
class HistoryController {
  constructor(private readonly history: HistoryService) {}

  /** ?type=deal|order|customer|factory&id= — who changed what, when and why (newest first). */
  @Get()
  list(@CurrentUser() user: SessionUser, @Query(Validate(historyQuery)) q: HistoryQuery) {
    return this.history.list(user, q);
  }
}

@Module({ imports: [PartiesModule], controllers: [HistoryController], providers: [HistoryService] })
export class HistoryModule {}
