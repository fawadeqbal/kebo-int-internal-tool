import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, type Prisma } from "@kebo/database";
import { costDocLines, fromMinor, profitBy, profitTotals, settle, type CostedSoldLine } from "@kebo/money";
import { can, LOST_REASONS, OPEN_STAGES, QUOTED_STATUSES, type LostReason } from "@kebo/shared";
import { addDays, ForbiddenError, startOfDayIn, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { OrdersService } from "../orders/orders.service";
import { inquiryAccess } from "../inquiries/inquiries.service";
import { ordersWithMoneyDue } from "../money/due";
import { MainMoney } from "../money/order-money";

export interface Range {
  from: ISODate;
  to: ISODate;
}

/** Quoted value counts only each quotation's live revision (never superseded, draft or deleted ones), so revising never doubles it. */
const LIVE_QUOTED = [...QUOTED_STATUSES, "void" as const];

/** A calendar day for date columns (stored as dates, no time zone). */
const day = (d: ISODate) => new Date(`${d}T00:00:00Z`);

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
          total: true,
          currency: true,
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
        total: r.total.toFixed(2),
        currency: r.currency,
        inquiry: r.quotation.inquiry,
      })),
      money: manager ? await this.moneyNow(today) : null,
      workload: manager ? await this.workload() : null,
    };
  }

  /**
   * This month's money and what is open right now. Orders at the rate stored on
   * them, quotations at today's rates; currencies without a rate are listed in
   * `missingRates` (and left out), never added as 0 silently.
   */
  private async moneyNow(today: ISODate) {
    const { sales } = await this.settings.get();
    const main = sales.currency;
    const fx = new MainMoney(main, sales.exchangeRates);
    const monthStart = `${today.slice(0, 7)}-01`;
    const rated = { currency: true, mainCurrency: true, mainRate: true } as const;
    const [quoted, won, paidIn, openOrders] = await Promise.all([
      this.prisma.db.quotationRevision.findMany({
        where: { deletedAt: null, status: { in: LIVE_QUOTED }, sentOn: { gte: day(monthStart) } },
        select: { total: true, currency: true },
      }),
      this.prisma.db.order.findMany({
        where: { status: { not: "cancelled" }, orderedOn: { gte: day(monthStart) } },
        select: { total: true, ...rated },
      }),
      this.prisma.db.payment.findMany({
        where: { voidedAt: null, paidOn: { gte: day(monthStart) } },
        select: { amount: true, currency: true, order: { select: rated } },
      }),
      this.prisma.db.order.findMany({
        // Closed orders too, while money is still owed on them.
        where: { OR: [{ status: "open" }, { status: "closed", id: { in: await ordersWithMoneyDue(this.prisma) } }] },
        select: {
          total: true,
          ...rated,
          stage: true,
          status: true,
          payments: { where: { voidedAt: null }, select: { amount: true, bankCharges: true, currency: true } },
        },
      }),
    ]);
    let receivable = 0;
    const byStage = { confirmed: 0, in_production: 0, shipped: 0 };
    for (const o of openOrders) {
      const ins = o.payments
        .filter((p) => p.currency === o.currency)
        .map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) }));
      receivable += fx.order(settle(decimalToMinor(o.total), ins).outstandingMinor, o);
      if (o.status === "open" && o.stage in byStage) byStage[o.stage as keyof typeof byStage] += 1;
    }
    return {
      currency: main,
      thisMonth: {
        quoted: fromMinor(quoted.reduce((t, r) => t + fx.live(decimalToMinor(r.total), r.currency), 0)),
        won: fromMinor(won.reduce((t, o) => t + fx.order(decimalToMinor(o.total), o), 0)),
        // What arrived (the bank charges never reached us), as in profit & loss and Insights.
        received: fromMinor(
          paidIn.reduce(
            (t, p) =>
              t +
              (p.currency === p.order.currency
                ? fx.order(decimalToMinor(p.amount), p.order)
                : fx.live(decimalToMinor(p.amount), p.currency)),
            0,
          ),
        ),
      },
      now: { toReceive: fromMinor(receivable), openOrders: openOrders.filter((o) => o.status === "open").length, ordersByStage: byStage },
      /** Currencies with no exchange rate: their amounts are left out of the figures above. */
      missingRates: fx.missingRates,
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
    const fx = new MainMoney(main, sales.exchangeRates);
    const person: Prisma.InquiryWhereInput = staffId ? { assigneeId: staffId } : {};
    // Days in the company's time zone: a deal at 05:00 on 1 November in Shanghai is November's.
    const tz = this.clock.timeZone;
    const span = { gte: startOfDayIn(r.from, tz), lt: startOfDayIn(addDays(r.to, 1), tz) };
    const received: Prisma.InquiryWhereInput = { deletedAt: null, ...person, createdAt: span };
    const closed: Prisma.InquiryWhereInput = { deletedAt: null, ...person, closedAt: span };

    const [inRange, quotedDeals, wonDeals, lostDeals, byChannel, byCategory, lostReasons, closedRows, ordersInRange, staff] =
      await Promise.all([
        this.prisma.db.inquiry.count({ where: received }),
        this.prisma.db.inquiry.count({
          where: { ...received, quotation: { revisions: { some: { deletedAt: null, status: { not: "draft" } } } } },
        }),
        this.prisma.db.inquiry.count({ where: { ...closed, stage: "won" } }),
        this.prisma.db.inquiry.count({ where: { ...closed, stage: "lost" } }),
        this.prisma.db.inquiry.groupBy({ by: ["channel"], where: received, _count: true }),
        this.prisma.db.inquiry.groupBy({
          by: ["category"],
          where: received,
          _count: true,
          orderBy: { _count: { category: "desc" } },
          take: 10,
        }),
        this.prisma.db.inquiry.groupBy({ by: ["lostReason"], where: { ...closed, stage: "lost" }, _count: true }),
        this.prisma.db.inquiry.findMany({
          where: { ...closed, stage: { in: ["won", "lost"] } },
          select: { stage: true, createdAt: true, closedAt: true, assigneeId: true },
        }),
        this.prisma.db.order.findMany({
          where: {
            status: { not: "cancelled" },
            orderedOn: { gte: day(r.from), lte: day(r.to) },
            ...(staffId ? { inquiry: { assigneeId: staffId } } : {}),
          },
          include: {
            lines: { orderBy: { sortOrder: "asc" } },
            costs: { select: { cost: true } },
            customer: { select: { name: true } },
            inquiry: { select: { category: true, assignee: { select: { name: true } } } },
          },
        }),
        this.prisma.db.user.findMany({ where: { isSystem: false }, select: { id: true, name: true } }),
      ]);

    const avg = (rows: typeof closedRows) =>
      rows.length ? Math.round(rows.reduce((t, x) => t + (x.closedAt!.getTime() - x.createdAt.getTime()), 0) / rows.length) : null;
    // Estimated profit on the orders won in the range: worked out in each order's currency from the costs on its
    // lines and the costs to reach the basis it was sold on (as on the order's page), then each line turned into
    // the main currency at the order's own rate. Lines without a cost are left out of profit and shown apart.
    const costed = ordersInRange.flatMap((o): CostedSoldLine[] => {
      if (!fx.known(o)) {
        fx.order(0, o); // listed as missing
        return [];
      }
      const linesSum = o.lines.reduce((t, l) => t + decimalToMinor(l.lineTotal), 0);
      const keys = { customer: o.customer.name, category: o.inquiry.category, person: o.inquiry.assignee?.name ?? "Unassigned" };
      return costDocLines({
        id: o.id,
        discountMinor: Math.max(linesSum - decimalToMinor(o.total), 0),
        extraCostMinor: o.costs.reduce((t, c) => t + decimalToMinor(c.cost), 0),
        lines: o.lines.map((l) => ({
          docId: o.id,
          lineTotalMinor: decimalToMinor(l.lineTotal),
          quantity: l.quantity.toString(),
          unitCostMinor: l.unitCost === null ? null : decimalToMinor(l.unitCost),
          keys,
        })),
      }).map((l) => {
        const revenue = fx.order(l.revenueMinor, o);
        const cost = l.costMinor === null ? null : fx.order(l.costMinor, o);
        return { ...l, revenueMinor: revenue, costMinor: cost, profitMinor: cost === null ? null : revenue - cost };
      });
    });
    const totals = profitTotals(costed);
    const money = (t: ReturnType<typeof profitTotals>) => ({
      revenue: fromMinor(t.revenueMinor),
      /** Sales whose lines have no cost: left out of profit and margin. */
      uncostedRevenue: fromMinor(t.uncostedRevenueMinor),
      cost: fromMinor(t.costMinor),
      profit: fromMinor(t.profitMinor),
      marginPercent: t.marginPercent,
      coveragePercent: t.coveragePercent,
      orders: t.documents,
    });
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
      funnel: {
        received: inRange,
        quoted: quotedDeals,
        won: wonDeals,
        lost: lostDeals,
        winRatePercent: wonDeals + lostDeals ? Math.round((wonDeals / (wonDeals + lostDeals)) * 100) : null,
      },
      turnaroundMs: { won: avg(closedRows.filter((x) => x.stage === "won")), lost: avg(closedRows.filter((x) => x.stage === "lost")) },
      lostReasons: LOST_REASONS.map((reason: LostReason) => ({
        reason,
        count: lostReasons.find((g) => g.lostReason === reason)?._count ?? 0,
      })).filter((x) => x.count),
      byChannel: byChannel.map((g) => ({ key: g.channel, count: g._count })),
      byCategory: byCategory.map((g) => ({ key: g.category, count: g._count })),
      people: [...perPerson.entries()].map(([person, v]) => ({
        person,
        ...v,
        winRatePercent: Math.round((v.won / (v.won + v.lost)) * 100),
      })),
      wonValue: fromMinor(ordersInRange.reduce((t, o) => t + fx.order(decimalToMinor(o.total), o), 0)),
      profit: {
        total: money(totals),
        byCustomer: profitBy(costed, "customer").map((g) => ({ key: g.key, ...money(g) })),
        byCategory: profitBy(costed, "category").map((g) => ({ key: g.key, ...money(g) })),
        byPerson: profitBy(costed, "person").map((g) => ({ key: g.key, ...money(g) })),
      },
      trend: await this.trend(r.to, staffId),
      /** Currencies with no exchange rate: their amounts are left out (never counted as 0 silently). */
      missingRates: fx.missingRates,
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
    const tz = this.clock.timeZone;
    // The first month from its first day in the company's time zone (not UTC: the first hours would be lost).
    const start = startOfDayIn(`${months[0]}-01`, tz);
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
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.db.auditLog.count({ where }),
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
      rows: rows.map((r) => ({ ...r, userName: r.userId ? (names[r.userId] ?? "—") : "System" })),
    };
  }

  /** Helper for callers that need date-only ranges. */
  static parseRange(from: ISODate | undefined, to: ISODate | undefined, today: ISODate): Range {
    const t = to ?? today;
    return { from: from ?? `${t.slice(0, 7)}-01`, to: t };
  }
}
