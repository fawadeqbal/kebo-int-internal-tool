import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, type Prisma } from "@kebo/database";
import { convertMinor, costDocLines, fromMinor, fxRate, profitBy, profitTotals, settle } from "@kebo/money";
import { can, LOST_REASONS, OPEN_STAGES, QUOTED_STATUSES, type LostReason } from "@kebo/shared";
import { addDays, ForbiddenError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { OrdersService } from "../orders/orders.service";
import { inquiryAccess } from "../inquiries/inquiries.service";
import { ordersWithMoneyDue } from "../money/due";

export interface Range {
  from: ISODate;
  to: ISODate;
}

/** Quoted value counts only each quotation's live revision (never superseded, draft or deleted ones), so revising never doubles it. */
const LIVE_QUOTED = [...QUOTED_STATUSES, "void" as const];

const day = (d: ISODate) => new Date(`${d}T00:00:00Z`);
const dayAfter = (d: ISODate) => new Date(`${addDays(d, 1)}T00:00:00Z`);

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
  ) {}

  /* ---------------------------------------------------------------- dashboard */

  async dashboard(user: SessionUser) {
    const today = this.clock.today();
    const s = await this.settings.get();
    const manager = can(user, "inquiries.viewAll");
    const scope: Prisma.InquiryWhereInput = { deletedAt: null, ...inquiryAccess(user) };
    const open = { ...scope, stage: { in: [...OPEN_STAGES] } };
    const deal = { id: true, refNo: true, title: true, stage: true, onHold: true, requiredBy: true, priority: true, customer: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } } } as const;
    const [byStage, overdue, onHold, unassigned, todo, myDeals, fresh, expiring] = await Promise.all([
      this.prisma.db.inquiry.groupBy({ by: ["stage"], where: open, _count: true }),
      this.prisma.db.inquiry.count({ where: { ...open, requiredBy: { lt: day(today) } } }),
      this.prisma.db.inquiry.count({ where: { ...open, onHold: true } }),
      manager ? this.prisma.db.inquiry.count({ where: { ...open, assigneeId: null } }) : Promise.resolve(0),
      this.orders.todo(user),
      this.prisma.db.inquiry.findMany({ where: { ...open, assigneeId: user.id }, select: deal, orderBy: [{ requiredBy: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], take: 8 }),
      manager ? this.prisma.db.inquiry.findMany({ where: { ...open, stage: "new" }, select: deal, orderBy: { createdAt: "desc" }, take: 8 }) : Promise.resolve([]),
      this.prisma.db.quotationRevision.findMany({
        where: { deletedAt: null, status: "sent", validUntil: { lte: day(addDays(today, s.reminders.dueSoonDays)) }, quotation: { inquiry: scope } },
        select: { id: true, number: true, validUntil: true, total: true, currency: true, quotation: { select: { refNo: true, inquiry: { select: { id: true, title: true, customer: { select: { name: true } } } } } } },
        orderBy: { validUntil: "asc" },
        take: 8,
      }),
    ]);
    const counts = Object.fromEntries(byStage.map((g) => [g.stage, g._count]));
    return {
      today,
      counts: { new: counts.new ?? 0, sourcing: counts.sourcing ?? 0, quoted: counts.quoted ?? 0, overdue, onHold, unassigned },
      todo: todo.slice(0, 12),
      myDeals: myDeals.map((d) => ({ ...d, requiredBy: d.requiredBy ? fromDbDate(d.requiredBy) : null })),
      newDeals: fresh.map((d) => ({ ...d, requiredBy: d.requiredBy ? fromDbDate(d.requiredBy) : null })),
      expiringQuotes: expiring.map((r) => ({ id: r.id, label: `${r.quotation.refNo} R${r.number}`, validUntil: fromDbDate(r.validUntil), total: r.total.toFixed(2), currency: r.currency, inquiry: r.quotation.inquiry })),
      money: manager ? await this.moneyNow(today) : null,
      workload: manager ? await this.workload() : null,
    };
  }

  /** This month's money and what is open right now. Amounts in other currencies are shown at today's rates. */
  private async moneyNow(today: ISODate) {
    const { sales } = await this.settings.get();
    const main = sales.currency;
    const toMain = (minor: number, currency: string) => {
      const rate = fxRate(currency, main, main, sales.exchangeRates);
      return rate ? convertMinor(minor, rate) : 0;
    };
    const monthStart = `${today.slice(0, 7)}-01`;
    const [quoted, won, paidIn, openOrders] = await Promise.all([
      this.prisma.db.quotationRevision.findMany({ where: { deletedAt: null, status: { in: LIVE_QUOTED }, sentOn: { gte: day(monthStart) } }, select: { total: true, currency: true } }),
      this.prisma.db.order.findMany({ where: { status: { not: "cancelled" }, orderedOn: { gte: day(monthStart) } }, select: { total: true, currency: true } }),
      this.prisma.db.payment.findMany({ where: { voidedAt: null, paidOn: { gte: day(monthStart) } }, select: { amount: true, bankCharges: true, currency: true } }),
      this.prisma.db.order.findMany({
        // Closed orders too, while money is still owed on them.
        where: { OR: [{ status: "open" }, { status: "closed", id: { in: await ordersWithMoneyDue(this.prisma) } }] },
        select: { total: true, currency: true, stage: true, status: true, payments: { where: { voidedAt: null }, select: { amount: true, bankCharges: true, currency: true } } },
      }),
    ]);
    const sum = (rows: { total: { toString(): string }; currency: string }[]) => rows.reduce((t, r) => t + toMain(decimalToMinor(r.total), r.currency), 0);
    let receivable = 0;
    const byStage = { confirmed: 0, in_production: 0, shipped: 0 };
    for (const o of openOrders) {
      const ins = o.payments.filter((p) => p.currency === o.currency).map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) }));
      receivable += toMain(settle(decimalToMinor(o.total), ins).outstandingMinor, o.currency);
      if (o.status === "open" && o.stage in byStage) byStage[o.stage as keyof typeof byStage] += 1;
    }
    return {
      currency: main,
      thisMonth: {
        quoted: fromMinor(sum(quoted)),
        won: fromMinor(sum(won)),
        received: fromMinor(paidIn.reduce((t, p) => t + toMain(decimalToMinor(p.amount) + decimalToMinor(p.bankCharges), p.currency), 0)),
      },
      now: { toReceive: fromMinor(receivable), openOrders: openOrders.filter((o) => o.status === "open").length, ordersByStage: byStage },
    };
  }

  /** Open deals and orders per person, and their late order steps. */
  private async workload() {
    const people = await this.prisma.db.user.findMany({
      where: { isActive: true, isSystem: false },
      select: { id: true, name: true, role: true, access: { select: { superAdmin: true, permissions: true } } },
      orderBy: { name: "asc" },
    });
    const [deals, orders] = await Promise.all([
      this.prisma.db.inquiry.groupBy({ by: ["assigneeId"], where: { deletedAt: null, stage: { in: [...OPEN_STAGES] } }, _count: true }),
      this.prisma.db.order.findMany({ where: { status: "open" }, select: { inquiry: { select: { assigneeId: true } } } }),
    ]);
    return people
      .map(({ access, ...p }) => ({
        ...p,
        /** Works only their own deals (no "see every deal"): always listed, even with nothing open. */
        ownWork: !access.superAdmin && !access.permissions.includes("inquiries.viewAll"),
        openDeals: deals.find((d) => d.assigneeId === p.id)?._count ?? 0,
        openOrders: orders.filter((o) => o.inquiry.assigneeId === p.id).length,
      }))
      .filter((p) => p.openDeals || p.openOrders || p.ownWork)
      .sort((a, b) => b.openDeals + b.openOrders - (a.openDeals + a.openOrders));
  }

  /* ---------------------------------------------------------------- reports */

  async report(user: SessionUser, r: Range, staffId?: string) {
    if (!can(user, "reports.view")) throw new ForbiddenError();
    const { sales } = await this.settings.get();
    const main = sales.currency;
    const toMain = (minor: number, currency: string) => {
      const rate = fxRate(currency, main, main, sales.exchangeRates);
      return rate ? convertMinor(minor, rate) : 0;
    };
    const person: Prisma.InquiryWhereInput = staffId ? { assigneeId: staffId } : {};
    const received: Prisma.InquiryWhereInput = { deletedAt: null, ...person, createdAt: { gte: day(r.from), lt: dayAfter(r.to) } };
    const closed: Prisma.InquiryWhereInput = { deletedAt: null, ...person, closedAt: { gte: day(r.from), lt: dayAfter(r.to) } };

    const [inRange, quotedDeals, wonDeals, lostDeals, byChannel, byCategory, lostReasons, closedRows, ordersInRange, staff] = await Promise.all([
      this.prisma.db.inquiry.count({ where: received }),
      this.prisma.db.inquiry.count({ where: { ...received, quotation: { revisions: { some: { deletedAt: null, status: { not: "draft" } } } } } }),
      this.prisma.db.inquiry.count({ where: { ...closed, stage: "won" } }),
      this.prisma.db.inquiry.count({ where: { ...closed, stage: "lost" } }),
      this.prisma.db.inquiry.groupBy({ by: ["channel"], where: received, _count: true }),
      this.prisma.db.inquiry.groupBy({ by: ["category"], where: received, _count: true, orderBy: { _count: { category: "desc" } }, take: 10 }),
      this.prisma.db.inquiry.groupBy({ by: ["lostReason"], where: { ...closed, stage: "lost" }, _count: true }),
      this.prisma.db.inquiry.findMany({ where: { ...closed, stage: { in: ["won", "lost"] } }, select: { stage: true, createdAt: true, closedAt: true, assigneeId: true } }),
      this.prisma.db.order.findMany({
        where: { status: { not: "cancelled" }, orderedOn: { gte: day(r.from), lte: day(r.to) }, ...(staffId ? { inquiry: { assigneeId: staffId } } : {}) },
        include: { lines: true, revision: { select: { discount: true } }, customer: { select: { name: true } }, inquiry: { select: { category: true, assignee: { select: { name: true } } } } },
      }),
      this.prisma.db.user.findMany({ where: { isSystem: false }, select: { id: true, name: true } }),
    ]);

    const avg = (rows: typeof closedRows) => (rows.length ? Math.round(rows.reduce((t, x) => t + (x.closedAt!.getTime() - x.createdAt.getTime()), 0) / rows.length) : null);
    // Estimated profit on the orders won in the range, from the costs recorded on their lines, in the main currency.
    const costed = ordersInRange.flatMap((o) =>
      costDocLines({
        id: o.id,
        discountMinor: toMain(decimalToMinor(o.revision.discount), o.currency),
        lines: o.lines.map((l) => ({
          docId: o.id,
          lineTotalMinor: toMain(decimalToMinor(l.lineTotal), o.currency),
          quantity: Number(l.quantity),
          unitCostMinor: l.unitCost === null ? null : toMain(decimalToMinor(l.unitCost), o.currency),
          keys: { customer: o.customer.name, category: o.inquiry.category, person: o.inquiry.assignee?.name ?? "Unassigned" },
        })),
      }),
    );
    const totals = profitTotals(costed);
    const money = (t: ReturnType<typeof profitTotals>) => ({ revenue: fromMinor(t.revenueMinor), cost: fromMinor(t.costMinor), profit: fromMinor(t.profitMinor), marginPercent: t.marginPercent, coveragePercent: t.coveragePercent, orders: t.documents });
    const name = (id: string | null) => staff.find((u) => u.id === id)?.name ?? "Unassigned";
    const perPerson = new Map<string, { won: number; lost: number }>();
    for (const c of closedRows) {
      const k = name(c.assigneeId);
      const p = perPerson.get(k) ?? { won: 0, lost: 0 };
      p[c.stage as "won" | "lost"] += 1;
      perPerson.set(k, p);
    }
    return {
      range: r,
      currency: main,
      funnel: { received: inRange, quoted: quotedDeals, won: wonDeals, lost: lostDeals, winRatePercent: wonDeals + lostDeals ? Math.round((wonDeals / (wonDeals + lostDeals)) * 100) : null },
      turnaroundMs: { won: avg(closedRows.filter((x) => x.stage === "won")), lost: avg(closedRows.filter((x) => x.stage === "lost")) },
      lostReasons: LOST_REASONS.map((reason: LostReason) => ({ reason, count: lostReasons.find((g) => g.lostReason === reason)?._count ?? 0 })).filter((x) => x.count),
      byChannel: byChannel.map((g) => ({ key: g.channel, count: g._count })),
      byCategory: byCategory.map((g) => ({ key: g.category, count: g._count })),
      people: [...perPerson.entries()].map(([person, v]) => ({ person, ...v, winRatePercent: Math.round((v.won / (v.won + v.lost)) * 100) })),
      wonValue: fromMinor(ordersInRange.reduce((t, o) => t + toMain(decimalToMinor(o.total), o.currency), 0)),
      profit: {
        total: money(totals),
        byCustomer: profitBy(costed, "customer").map((g) => ({ key: g.key, ...money(g) })),
        byCategory: profitBy(costed, "category").map((g) => ({ key: g.key, ...money(g) })),
        byPerson: profitBy(costed, "person").map((g) => ({ key: g.key, ...money(g) })),
      },
      trend: await this.trend(r.to, staffId),
    };
  }

  /** The 12 months up to `to`: deals received and won. */
  private async trend(to: ISODate, staffId?: string) {
    const months: string[] = [];
    const d = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
    for (let i = 11; i >= 0; i--) {
      const m = new Date(d);
      m.setUTCMonth(d.getUTCMonth() - i);
      months.push(m.toISOString().slice(0, 7));
    }
    const start = new Date(`${months[0]}-01T00:00:00Z`);
    const tz = this.clock.timeZone;
    const person = staffId ? `and assignee_id = '${staffId.replace(/[^0-9a-f-]/gi, "")}'` : "";
    const rows = await this.prisma.db.$queryRawUnsafe<{ m: string; received: bigint; won: bigint }[]>(
      `select to_char(date_trunc('month', created_at at time zone $1), 'YYYY-MM') as m,
              count(*) as received,
              count(*) filter (where stage = 'won') as won
         from inquiries where deleted_at is null and created_at >= $2 ${person}
        group by 1`,
      tz,
      start,
    );
    return months.map((m) => {
      const row = rows.find((x) => x.m === m);
      return { month: m, received: Number(row?.received ?? 0), won: Number(row?.won ?? 0) };
    });
  }

  /* ---------------------------------------------------------------- audit */

  async audit(user: SessionUser, q: { entityType?: string; entityId?: string; userId?: string; page: number; pageSize: number }) {
    if (!can(user, "audit.view")) throw new ForbiddenError();
    const where: Prisma.AuditLogWhereInput = { ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}), ...(q.userId ? { userId: q.userId } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.db.auditLog.count({ where }),
    ]);
    const names = Object.fromEntries((await this.prisma.db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return { total, page: q.page, pageSize: q.pageSize, rows: rows.map((r) => ({ ...r, userName: r.userId ? (names[r.userId] ?? "—") : "System" })) };
  }

  /** Helper for callers that need date-only ranges. */
  static parseRange(from: ISODate | undefined, to: ISODate | undefined, today: ISODate): Range {
    const t = to ?? today;
    return { from: from ?? `${t.slice(0, 7)}-01`, to: t };
  }
}
