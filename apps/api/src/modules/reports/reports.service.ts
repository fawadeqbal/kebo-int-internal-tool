import { Injectable } from "@nestjs/common";
import { fromDbDate, type Prisma } from "@kebo/database";
import { fromMinor, toMinor } from "@kebo/money";
import { can, OPEN_STAGES } from "@kebo/shared";
import { addDays, ForbiddenError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { OrdersService } from "../orders/orders.service";
import { inquiryAccess } from "../inquiries/inquiries.service";
import { optionFigures, worthView } from "../quotations/revision-figures";
import { FactsReadService } from "../insights/facts/facts-read.service";

export interface Range {
  from: ISODate;
  to: ISODate;
}

/** A calendar day for date columns (stored as dates, no time zone). */
const day = (d: ISODate) => new Date(`${d}T00:00:00Z`);
/** "2026-11" for the month `n` months after `d`'s. */
const monthStartOf = (d: ISODate, n = 0) => {
  const x = new Date(`${d.slice(0, 7)}-01T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 7);
};
/** The last day of `d`'s month. */
const monthEnd = (d: ISODate): ISODate => addDays(`${monthStartOf(d, 1)}-01`, -1);
/** The 12 months up to `d`'s: ["2025-12", …, "2026-11"]. */
const monthsUpTo = (d: ISODate) => Array.from({ length: 12 }, (_, i) => monthStartOf(d, i - 11));

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
    private readonly facts: FactsReadService,
  ) {}

  /* ---------------------------------------------------------------- dashboard */

  async dashboard(user: SessionUser) {
    const today = this.clock.today();
    const s = await this.settings.get();
    const manager = can(user, "inquiries.viewAll");
    const scope: Prisma.InquiryWhereInput = { deletedAt: null, ...inquiryAccess(user) };
    const open = { ...scope, stage: { in: [...OPEN_STAGES] } };
    const deal = {
      id: true,
      refNo: true,
      title: true,
      stage: true,
      onHold: true,
      requiredBy: true,
      priority: true,
      customer: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
    } as const;
    const [byStage, overdue, onHold, unassigned, todo, myDeals, fresh, expiring] = await Promise.all([
      this.prisma.db.inquiry.groupBy({ by: ["stage"], where: open, _count: true }),
      this.prisma.db.inquiry.count({ where: { ...open, requiredBy: { lt: day(today) } } }),
      this.prisma.db.inquiry.count({ where: { ...open, onHold: true } }),
      manager ? this.prisma.db.inquiry.count({ where: { ...open, assigneeId: null } }) : Promise.resolve(0),
      this.orders.todo(user),
      this.prisma.db.inquiry.findMany({
        where: { ...open, assigneeId: user.id },
        select: deal,
        orderBy: [{ requiredBy: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        take: 8,
      }),
      manager
        ? this.prisma.db.inquiry.findMany({ where: { ...open, stage: "new" }, select: deal, orderBy: { createdAt: "desc" }, take: 8 })
        : Promise.resolve([]),
      this.prisma.db.quotationRevision.findMany({
        where: {
          deletedAt: null,
          status: "sent",
          validUntil: { lte: day(addDays(today, s.reminders.dueSoonDays)) },
          quotation: { inquiry: scope },
        },
        select: {
          id: true,
          number: true,
          validUntil: true,
          currency: true,
          ...optionFigures,
          quotation: { select: { refNo: true, inquiry: { select: { id: true, title: true, customer: { select: { name: true } } } } } },
        },
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
      expiringQuotes: expiring.map((r) => ({
        id: r.id,
        label: `${r.quotation.refNo} R${r.number}`,
        validUntil: fromDbDate(r.validUntil),
        // What it is worth: one option's total, or the lowest–highest of its options (labelled).
        ...worthView(r),
        currency: r.currency,
        inquiry: r.quotation.inquiry,
      })),
      money: manager ? await this.moneyNow(user, today) : null,
      workload: manager ? await this.workload(user) : null,
    };
  }

  /**
   * This month's money and what is open right now (managers), from the Insights tables: the same figures
   * and labels as Insights (Sales, Cash in, To receive, Overdue, Quoted value) for the same month.
   */
  private async moneyNow(user: SessionUser, today: ISODate) {
    const month = { from: `${today.slice(0, 7)}-01` as ISODate, to: monthEnd(today) };
    const [orders, cash, funnel, owed, work] = await Promise.all([
      this.facts.orderGroups(user, { ...month, period: "all", by: "company" }, true),
      this.facts.cash(user, month, true),
      this.facts.funnel(user, month, true),
      this.facts.aging(user, { side: "receivable" }, true),
      this.facts.work(user),
    ]);
    const t = orders.rows[0];
    const stage = (k: string) => work.ordersByStage[k] ?? 0;
    return {
      currency: orders.currency,
      thisMonth: {
        // Inquiries that came in this month and were quoted, each at its latest quotation (accepted option, else lowest).
        quoted: funnel.quotedValue,
        quotedUpTo: null,
        /** Sales: the orders made this month. */
        won: t?.sales ?? "0.00",
        /** Cash in: what customers paid this month. */
        received: fromMinor(cash.months.reduce((s, m) => s + toMinor(m.in), 0)),
      },
      now: {
        toReceive: owed.total,
        overdue: fromMinor(toMinor(owed.d30) + toMinor(owed.d60) + toMinor(owed.d90) + toMinor(owed.older)),
        openOrders: work.openOrders,
        ordersByStage: { confirmed: stage("confirmed"), in_production: stage("in_production"), shipped: stage("shipped") },
      },
      /** Currencies with no exchange rate: their amounts are left out of the figures above. */
      missingRates: [...new Set([...orders.missingRates, ...cash.missingRates])].sort(),
    };
  }

  /** Open deals and orders per person (the Insights tables), and who works only their own deals. */
  private async workload(user: SessionUser) {
    const people = await this.prisma.db.user.findMany({
      where: { isActive: true, isSystem: false },
      select: { id: true, name: true, role: true, access: { select: { superAdmin: true, permissions: true } } },
      orderBy: { name: "asc" },
    });
    const work = await this.facts.work(user);
    return people
      .map(({ access, ...p }) => ({
        ...p,
        /** Works only their own deals (no "see every deal"): always listed, even with nothing open. */
        ownWork: !access.superAdmin && !access.permissions.includes("inquiries.viewAll"),
        openDeals: work.inquiriesOf(p.id),
        openOrders: work.ordersOf(p.id),
      }))
      .filter((p) => p.openDeals || p.openOrders || p.ownWork)
      .sort((a, b) => b.openDeals + b.openOrders - (a.openDeals + a.openOrders));
  }

  /* ---------------------------------------------------------------- reports */

  /**
   * The printable report (View / Print, PDF, CSV, Excel) for a span, from the Insights tables with the same
   * definitions as Insights: inquiries by when they came in (the funnel, channels, categories, people, the
   * 12 months), orders by when they were ordered (sales and profit on the quote). `staffId`: one person's.
   */
  async report(user: SessionUser, r: Range, staffId?: string) {
    if (!can(user, "reports.view")) throw new ForbiddenError();
    const span = { from: r.from, to: r.to, ...(staffId ? { personId: staffId } : {}) };
    const twelve = { ...span, from: `${monthStartOf(r.to, -11)}-01` as ISODate };
    const [funnel, inquiries, byChannel, byCategory, byPerson, orders, ordersByCustomer, ordersByCategory, ordersByPerson, months] = await Promise.all([
      this.facts.funnel(user, span),
      this.facts.inquiryGroups(user, { ...span, period: "all", by: "company" }),
      this.facts.inquiryGroups(user, { ...span, period: "all", by: "channel" }),
      this.facts.inquiryGroups(user, { ...span, period: "all", by: "category" }),
      this.facts.inquiryGroups(user, { ...span, period: "all", by: "person" }),
      this.facts.orderGroups(user, { ...span, period: "all", by: "company" }),
      this.facts.orderGroups(user, { ...span, period: "all", by: "customer" }),
      this.facts.orderGroups(user, { ...span, period: "all", by: "category" }),
      this.facts.orderGroups(user, { ...span, period: "all", by: "person" }),
      this.facts.inquiryGroups(user, { ...twelve, period: "month", by: "company" }),
    ]);
    type OrderRow = (typeof orders.rows)[number];
    // Profit on the quote, on the sales whose lines have a cost (the rest shown apart), as Insights.
    const money = (g: OrderRow | undefined) => {
      const sales = toMinor(g?.sales ?? "0");
      const costed = toMinor(g?.costed ?? "0");
      const profit = toMinor(g?.profitQuote ?? "0");
      return {
        revenue: fromMinor(sales),
        /** Sales whose lines have no cost: left out of profit and margin. */
        uncostedRevenue: fromMinor(sales - costed),
        cost: fromMinor(costed - profit),
        profit: fromMinor(profit),
        marginPercent: g?.marginQuote ?? null,
        coveragePercent: sales > 0 ? Math.round((costed / sales) * 100) : null,
        orders: g?.orders ?? 0,
      };
    };
    const groups = (rows: OrderRow[]) =>
      [...rows].sort((a, b) => toMinor(b.sales) - toMinor(a.sales) || a.label.localeCompare(b.label)).map((g) => ({ key: g.label, ...money(g) }));
    const total = inquiries.rows[0];
    const last = monthsUpTo(r.to);
    return {
      range: r,
      currency: orders.currency,
      funnel: {
        received: funnel.inquiries,
        quoted: funnel.quoted,
        won: funnel.won,
        lost: funnel.lost,
        winRatePercent: funnel.winRate,
      },
      /** From coming in to won or lost, on average (days), for the inquiries that came in in the span. */
      turnaroundDays: { won: total?.daysToWin ?? null, lost: total?.daysToLose ?? null },
      lostReasons: funnel.lostReasons,
      byChannel: [...byChannel.rows].sort((a, b) => b.inquiries - a.inquiries).map((g) => ({ key: g.key, count: g.inquiries })),
      byCategory: [...byCategory.rows]
        .sort((a, b) => b.inquiries - a.inquiries || a.key.localeCompare(b.key))
        .slice(0, 10)
        .map((g) => ({ key: g.key, count: g.inquiries })),
      people: byPerson.rows
        .filter((p) => p.won + p.lost > 0)
        .map((p) => ({ person: p.label, won: p.won, lost: p.lost, winRatePercent: p.winRate ?? 0 })),
      /** Sales: the orders made in the span. */
      wonValue: orders.rows[0]?.sales ?? "0.00",
      profit: {
        total: money(orders.rows[0]),
        byCustomer: groups(ordersByCustomer.rows),
        byCategory: groups(ordersByCategory.rows),
        byPerson: groups(ordersByPerson.rows),
      },
      /** The 12 months up to `to`: inquiries that came in each month, and how many of them were won. */
      trend: last.map((m) => {
        const row = months.rows.find((x) => x.period === m);
        return { month: m, received: row?.inquiries ?? 0, won: row?.won ?? 0 };
      }),
      /** Currencies with no exchange rate: their amounts are left out (never counted as 0 silently). */
      missingRates: orders.missingRates,
    };
  }

  /* ---------------------------------------------------------------- audit */

  async audit(user: SessionUser, q: { entityType?: string; entityId?: string; userId?: string; page: number; pageSize: number }) {
    if (!can(user, "audit.view")) throw new ForbiddenError();
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
    };
    const [rows, total, byType] = await Promise.all([
      this.prisma.db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.db.auditLog.count({ where }),
      // The list's chips: how many entries of each kind of record, for the same record and person.
      this.prisma.db.auditLog.groupBy({ by: ["entityType"], where: { ...where, entityType: undefined }, _count: true }),
    ]);
    const names = Object.fromEntries(
      (
        await this.prisma.db.user.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))] } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: Object.fromEntries(byType.map((g) => [g.entityType, g._count])) as Record<string, number>,
      rows: rows.map((r) => ({ ...r, userName: r.userId ? (names[r.userId] ?? "—") : "System" })),
    };
  }

  /** Helper for callers that need date-only ranges. */
  static parseRange(from: ISODate | undefined, to: ISODate | undefined, today: ISODate): Range {
    const t = to ?? today;
    return { from: from ?? `${t.slice(0, 7)}-01`, to: t };
  }
}
