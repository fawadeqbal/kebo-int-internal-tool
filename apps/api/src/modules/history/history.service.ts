import { Injectable } from "@nestjs/common";
import { isSupplier } from "@kebo/database";
import { z } from "zod";
import { can, FLOW_STEPS, STEP_OF_ACTION } from "@kebo/shared";
import { ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import type { SessionUser } from "../../common/auth/session-user";
import { inquiryAccess } from "../inquiries/inquiries.service";
import { orderAccess } from "../../common/auth/order-access";
import { CustomersService } from "../parties/customers.service";
import { LimitsService } from "../../common/company/limits.service";

export const historyQuery = z.object({
  type: z.enum(["deal", "order", "customer", "factory"]),
  id: z.uuid("Unknown record"),
  /** An order's changes in one of its steps (see @kebo/shared STEP_OF_ACTION). */
  step: z.enum(FLOW_STEPS).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** A page of it (the History tab, Pager): with page, the answer is { rows, total, page, pageSize }. */
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** Words in what changed (its summary or action), and who changed it ("system" for the app itself). */
  q: z.string().trim().max(100).optional(),
  who: z.union([z.uuid(), z.literal("system")]).optional(),
});
export type HistoryQuery = z.infer<typeof historyQuery>;

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
    private readonly limits: LimitsService,
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
          quotations: { select: { revisions: { select: { id: true } } } },
          attachments: { select: { id: true, factoryQuoteId: true } },
          orders: { select: { id: true } },
        },
      });
      if (!i) throw new NotFoundError("Inquiry");
      const seeCosts = can(user, "sourcing.manage");
      return [
        { entityType: "inquiry", ids: [i.id] },
        { entityType: "factory_quote", ids: seeCosts ? i.factoryQuotes.map((f) => f.id) : [] },
        // Every quotation's revisions (A, B, C…).
        { entityType: "quotation", ids: i.quotations.flatMap((q) => q.revisions.map((r) => r.id)) },
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
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see suppliers.");
    const f = await db.party.findFirst({ where: { ...isSupplier, id: q.id }, select: { id: true } });
    if (!f) throw new NotFoundError("Supplier");
    return [{ entityType: "factory", ids: [f.id] }];
  }

  async list(user: SessionUser, q: HistoryQuery) {
    const scope = (await this.scope(user, q)).filter((s) => s.ids.length);
    // Expenses are for managers only; payments to factories for people who see costs.
    const hidden = [
      // Expenses: managers, and only with the expenses feature of the plan.
      ...(can(user, "expenses.manage") && (await this.limits.allows("expenses")) ? [] : ["expense"]),
      ...(can(user, "sourcing.manage") ? [] : ["payment_out"]),
    ];
    const words = q.q ? { OR: [{ summary: { contains: q.q, mode: "insensitive" as const } }, { action: { contains: q.q, mode: "insensitive" as const } }, { reason: { contains: q.q, mode: "insensitive" as const } }] } : {};
    const where = {
      OR: scope.map((s) => ({ entityType: s.entityType, entityId: { in: s.ids } })),
      // A card's first save is kept for its "Edited n×" only: the change itself is already in the history.
      NOT: [{ action: "card.first" }, ...hidden.map((h) => ({ action: { startsWith: h } }))],
      ...(q.who ? { userId: q.who === "system" ? null : q.who } : {}),
      ...(q.q ? { AND: [words] } : {}),
    };
    // A page (the History tab): counted and cut in the database; one step's changes are told apart here, so for a
    // step its latest 2,000 are read and cut after.
    const paged = q.page !== undefined;
    const skip = paged && !q.step ? (q.page! - 1) * q.pageSize : 0;
    const [rows, counted] = await Promise.all([
      this.prisma.db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: paged ? (q.step ? 2000 : q.pageSize) : 100 }),
      paged && !q.step ? this.prisma.db.auditLog.count({ where }) : null,
    ]);
    const ids = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
    const people = new Map(
      (await this.prisma.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u]),
    );
    const stepped = q.step ? rows.filter((r) => STEP_OF_ACTION(r.action, r.newValues) === q.step) : rows;
    const shown = paged ? (q.step ? stepped.slice((q.page! - 1) * q.pageSize, q.page! * q.pageSize) : stepped) : stepped.slice(0, q.limit ?? 100);
    const out = shown.map((r) => ({
      id: r.id,
      step: STEP_OF_ACTION(r.action, r.newValues),
      at: r.createdAt,
      by: (r.userId && people.get(r.userId)) || null,
      action: r.action,
      entityType: r.entityType,
      summary: r.summary,
      reason: r.reason,
      changes: changesOf(r.oldValues, r.newValues),
    }));
    return paged ? { rows: out, total: counted ?? stepped.length, page: q.page!, pageSize: q.pageSize } : out;
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
