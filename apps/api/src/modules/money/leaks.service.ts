import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, toDbDate, type Prisma } from "@kebo/database";
import { formatMinor, fromMinor, fxRate, roundHalfAway, type Minor } from "@kebo/money";
import { can, LOST_REASON_LABEL, type LostReason } from "@kebo/shared";
import { addDays, ForbiddenError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import { ReadCache } from "../../common/cache/read-cache";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";

const convert = (minor: Minor, rate: number) => roundHalfAway(minor / rate);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** When a warning is raised. */
const LIMITS = {
  /** Spent on a deal still open, as a share of its quotation. */
  dealSpendPercent: 5,
  /** Paid to factories before the customer paid us, for longer than this. */
  stuckDays: 30,
  /** Profit lost after the sale, as a share of the profit planned. */
  leakPercent: 25,
  /** Expenses this month against the 12-month average. */
  expenseJump: 1.5,
};

export type Warning = { level: "bad" | "warn"; text: string; href: string | null };

/**
 * Where we lose money (managers), for a period: what lost deals cost and why
 * we lost them, customers who cost more than they earn, win rate and selling
 * cost by person and by product category, profit that leaked after the sale
 * (planned against actual), expenses against sales month by month, money stuck
 * with factories before the customer paid, what visits to each factory cost —
 * and warnings when something crosses a line.
 */
/** A deal decided in the period, with what was spent on it in minor units of the main currency. */
type ClosedDeal = {
  id: string;
  refNo: string;
  title: string;
  stage: "won" | "lost";
  category: string;
  lostReason: LostReason | null;
  assigneeId: string | null;
  customerId: string;
  customerName: string;
  spentMinor: number;
  /** Before any order: the selling cost. */
  sellingMinor: number;
};
/** An order as the report reads it: its sums in minor units (of its currency, expenses in the main one). */
type LeakOrder = {
  id: string;
  refNo: string;
  status: string;
  currency: string;
  totalMinor: number;
  orderedOn: ISODate;
  customerId: string;
  customerName: string;
  costMinor: number;
  uncostedMinor: number;
  factoryPaidMinor: number;
  firstFactoryPaid: ISODate | null;
  receivedMinor: number;
  orderCostsMinor: number;
  beforeSaleMinor: number;
};

@Injectable()
export class LeaksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly cache: ReadCache,
  ) {}

  /** The same for every manager: shared while nothing changes (ReadCache). */
  async report(user: SessionUser, q: { from?: ISODate; to?: ISODate }) {
    if (!can(user, "expenses.manage")) throw new ForbiddenError("Only managers can see where money is lost.");
    return this.cache.get(`leaks:${q.from ?? ""}:${q.to ?? ""}:${this.clock.today()}`, () => this.compute(q));
  }

  private async compute(q: { from?: ISODate; to?: ISODate }) {
    const today = this.clock.today();
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 4)}-01-01`;
    const { sales } = await this.settings.get();
    const main = sales.currency;
    const missing = new Set<string>();
    const toMain = (minor: Minor, currency: string) => {
      const r = fxRate(currency, main, main, sales.exchangeRates);
      if (r === null) {
        missing.add(currency);
        return 0;
      }
      return convert(minor, r);
    };
    const range = { gte: toDbDate(from), lte: toDbDate(to) };
    const inMain = (e: { amount: Prisma.Decimal; rate: Prisma.Decimal }) => convert(decimalToMinor(e.amount), Number(e.rate));
    const show = (minor: Minor, currency: string = main) => formatMinor(minor, currency as typeof main);
    const monthName = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));

    const [closedDeals, openDeals, orders, periodExpenses, people] = await Promise.all([
      // Deals decided in the period, with what was spent on them (all of it, and before any order: the
      // selling cost), added up in the database. Each expense in the main currency at its rate, rounded
      // as inMain does; timestamps in the database's zone, as Prisma writes them.
      this.prisma.db.$queryRaw<ClosedDeal[]>`
        select i.id, i.ref_no as "refNo", i.title, i.stage::text as stage, i.category, i.lost_reason::text as "lostReason",
               i.assignee_id as "assigneeId", c.id as "customerId", c.name as "customerName",
               coalesce(sum(sign(v.x) * floor(abs(v.x) + 0.5)), 0)::float8 as "spentMinor",
               coalesce(sum(sign(v.x) * floor(abs(v.x) + 0.5)) filter (where e.order_id is null), 0)::float8 as "sellingMinor"
        from inquiries i
        join customers c on c.id = i.customer_id
        left join expenses e on e.inquiry_id = i.id and e.voided_at is null
        left join lateral (select (e.amount * 100)::float8 / e.rate::float8 as x) v on e.id is not null
        where i.deleted_at is null and i.stage in ('won', 'lost')
          and i.closed_at >= ${from}::timestamp and i.closed_at < ${addDays(to, 1)}::timestamp
        group by i.id, c.id`,
      // Deals still open, with their latest quotation value and what was spent on them.
      this.prisma.db.inquiry.findMany({
        where: { deletedAt: null, stage: { in: ["new", "sourcing", "quoted"] }, expenses: { some: { voidedAt: null } } },
        select: {
          id: true,
          refNo: true,
          title: true,
          customer: { select: { name: true } },
          expenses: { where: { voidedAt: null }, select: { amount: true, rate: true } },
          quotation: { select: { revisions: { where: { deletedAt: null }, orderBy: { number: "desc" }, take: 1, select: { total: true, currency: true } } } },
        },
      }),
      // Orders placed in the period (planned against actual), and open ones (money stuck), each as one
      // row of sums from the database: goods cost, what is not costed, paid to factories (in the order's
      // currency at each payment's rate), received, the order's expenses and those on its deal before it.
      this.prisma.db.$queryRaw<LeakOrder[]>`
        select o.id, o.ref_no as "refNo", o.status::text as status, o.currency, (o.total * 100)::float8 as "totalMinor",
               to_char(o.ordered_on, 'YYYY-MM-DD') as "orderedOn", c.id as "customerId", c.name as "customerName",
               coalesce((select sum(sign(v.x) * floor(abs(v.x) + 0.5)) from order_lines l
                 cross join lateral (select (l.unit_cost * 100)::float8 * l.quantity::float8 as x) v
                 where l.order_id = o.id and l.unit_cost is not null), 0)::float8 as "costMinor",
               coalesce((select sum(l.line_total * 100) from order_lines l where l.order_id = o.id and l.unit_cost is null), 0)::float8 as "uncostedMinor",
               coalesce((select sum(sign(v.x) * floor(abs(v.x) + 0.5)) from factory_payments p
                 cross join lateral (select (p.amount * 100)::float8 / p.rate::float8 as x) v
                 where p.order_id = o.id and p.voided_at is null), 0)::float8 as "factoryPaidMinor",
               (select to_char(min(p.paid_on), 'YYYY-MM-DD') from factory_payments p where p.order_id = o.id and p.voided_at is null) as "firstFactoryPaid",
               coalesce((select sum((p.amount + p.bank_charges) * 100) from payments p
                 where p.order_id = o.id and p.voided_at is null and p.currency = o.currency), 0)::float8 as "receivedMinor",
               coalesce((select sum(sign(v.x) * floor(abs(v.x) + 0.5)) from expenses e
                 cross join lateral (select (e.amount * 100)::float8 / e.rate::float8 as x) v
                 where e.order_id = o.id and e.voided_at is null), 0)::float8 as "orderCostsMinor",
               coalesce((select sum(sign(v.x) * floor(abs(v.x) + 0.5)) from expenses e
                 cross join lateral (select (e.amount * 100)::float8 / e.rate::float8 as x) v
                 where e.inquiry_id = o.inquiry_id and e.order_id is null and e.voided_at is null), 0)::float8 as "beforeSaleMinor"
        from orders o
        join customers c on c.id = o.customer_id
        where o.status <> 'cancelled' and (o.ordered_on between ${from}::date and ${to}::date or o.status = 'open')`,
      // Every expense in the period, and the 12 months before its end for the trend.
      this.prisma.db.expense.findMany({
        where: { voidedAt: null, spentOn: { gte: toDbDate(`${addDays(`${to.slice(0, 7)}-01`, -334).slice(0, 7)}-01`), lte: toDbDate(to) } },
        select: { amount: true, rate: true, spentOn: true, customerId: true, inquiryId: true, orderId: true, factoryId: true, factory: { select: { id: true, name: true } }, customer: { select: { id: true, name: true } } },
      }),
      this.prisma.db.user.findMany({ where: { isSystem: false }, select: { id: true, name: true } }),
    ]);
    const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? "Nobody";
    const inPeriod = (d: Date) => fromDbDate(d) >= from && fromDbDate(d) <= to;
    const inPeriodDay = (d: ISODate) => d >= from && d <= to;
    const warnings: Warning[] = [];

    /* ----- lost deals: what they cost and why */
    const lost = closedDeals.filter((d) => d.stage === "lost");
    const reasons = new Map<string, { deals: number; spent: number }>();
    const lostRows = lost.map((d) => {
      const spent = d.spentMinor;
      const key = d.lostReason ?? "not_said";
      const r = reasons.get(key) ?? { deals: 0, spent: 0 };
      r.deals += 1;
      r.spent += spent;
      reasons.set(key, r);
      return { id: d.id, refNo: d.refNo, title: d.title, customer: { id: d.customerId, name: d.customerName }, reason: d.lostReason, assignee: nameOf(d.assigneeId), spentMinor: spent };
    });
    const lostSpent = lostRows.reduce((t, r) => t + r.spentMinor, 0);

    /* ----- win rate and selling cost by person and by category */
    const groupBy = (key: (d: (typeof closedDeals)[number]) => string) => {
      const m = new Map<string, { won: number; lost: number; spent: number }>();
      for (const d of closedDeals) {
        const k = key(d);
        const g = m.get(k) ?? { won: 0, lost: 0, spent: 0 };
        g[d.stage as "won" | "lost"] += 1;
        // Selling cost: what was spent before the order (or on the lost deal), not the order's own freight and inspection.
        g.spent += d.sellingMinor;
        m.set(k, g);
      }
      return [...m.entries()]
        .map(([key, g]) => ({
          key,
          won: g.won,
          lost: g.lost,
          winRate: g.won + g.lost ? Math.round((g.won / (g.won + g.lost)) * 100) : null,
          spent: fromMinor(g.spent),
          costPerWin: g.won ? fromMinor(roundHalfAway(g.spent / g.won)) : null,
        }))
        .sort((a, b) => b.won + b.lost - (a.won + a.lost) || a.key.localeCompare(b.key));
    };

    /* ----- profit planned against actual, for orders placed in the period */
    const placed = orders.filter((o) => inPeriodDay(o.orderedOn));
    const leakRows = placed
      .map((o) => {
        const revenue = toMain(o.totalMinor, o.currency);
        const uncosted = o.uncostedMinor;
        const goods = toMain(o.costMinor, o.currency);
        // Paid to factories beyond the costs on the lines (extra work, a price that changed); counted only once paid in full or more.
        const paidFactories = toMain(o.factoryPaidMinor, o.currency);
        // Rate rounding is not a cost: only more than half a percent (and more than 1.00) counts.
        const factoryExtra = paidFactories - goods > Math.max(100, goods * 0.005) ? paidFactories - goods : 0;
        const orderCosts = o.orderCostsMinor;
        const beforeSale = o.beforeSaleMinor;
        const planned = revenue - goods;
        const actual = planned - orderCosts - beforeSale - factoryExtra;
        return {
          id: o.id,
          refNo: o.refNo,
          customer: { id: o.customerId, name: o.customerName },
          revenueMinor: revenue,
          plannedMinor: planned,
          orderCostsMinor: orderCosts,
          beforeSaleMinor: beforeSale,
          factoryExtraMinor: factoryExtra,
          actualMinor: actual,
          leakMinor: planned - actual,
          uncosted: uncosted > 0,
        };
      })
      .sort((a, b) => b.leakMinor - a.leakMinor || a.refNo.localeCompare(b.refNo));
    for (const r of leakRows) {
      if (r.actualMinor < 0) warnings.push({ level: "bad", text: `Order ${r.refNo} (${r.customer.name}) is losing money: ${show(r.actualMinor)} after all costs.`, href: `/orders/${r.id}/money` });
      else if (r.plannedMinor > 0 && (r.leakMinor / r.plannedMinor) * 100 >= LIMITS.leakPercent)
        warnings.push({
          level: "warn",
          text: `Order ${r.refNo} kept only ${Math.round((r.actualMinor / r.plannedMinor) * 100)}% of its planned profit: ${show(r.leakMinor)} went on costs after the quote.`,
          href: `/orders/${r.id}/money`,
        });
    }

    /* ----- customers: earned against spent in the period */
    const customers = new Map<string, { customer: { id: string; name: string }; sales: number; profit: number; spent: number }>();
    const cust = (c: { id: string; name: string }) => {
      const x = customers.get(c.id) ?? { customer: c, sales: 0, profit: 0, spent: 0 };
      customers.set(c.id, x);
      return x;
    };
    for (const r of leakRows) {
      const c = cust(r.customer);
      c.sales += r.revenueMinor;
      c.profit += r.plannedMinor - r.orderCostsMinor - r.factoryExtraMinor;
    }
    for (const e of periodExpenses) {
      if (!e.customer || !inPeriod(e.spentOn) || e.orderId) continue;
      cust(e.customer).spent += inMain(e);
    }
    const customerRows = [...customers.values()]
      .map((c) => ({ customer: c.customer, sales: fromMinor(c.sales), profit: fromMinor(c.profit), spent: fromMinor(c.spent), net: fromMinor(c.profit - c.spent), netMinor: c.profit - c.spent, spentMinor: c.spent }))
      .sort((a, b) => b.netMinor - a.netMinor || a.customer.name.localeCompare(b.customer.name));
    for (const c of customerRows.filter((x) => x.netMinor < 0 && Number(x.spent) > 0).slice(0, 5))
      warnings.push({ level: "warn", text: `${c.customer.name} cost more than they earned us: net ${show(c.netMinor)} (spent ${show(c.spentMinor)}).`, href: `/customers/${c.customer.id}` });

    /* ----- open deals: spending against the quotation */
    for (const d of openDeals) {
      const spent = d.expenses.reduce((t, e) => t + inMain(e), 0);
      const q = d.quotation?.revisions[0];
      const value = q ? toMain(decimalToMinor(q.total), q.currency) : 0;
      if (value > 0 && (spent / value) * 100 >= LIMITS.dealSpendPercent)
        warnings.push({
          level: "warn",
          text: `${d.refNo} (${d.customer.name}): ${show(spent)} spent, ${pct(spent, value)}% of its quotation, and not won yet.`,
          href: `/deals/${d.id}`,
        });
    }

    /* ----- money stuck: paid to factories before the customer paid us */
    const stuck = orders
      .filter((o) => o.status === "open")
      .map((o) => {
        const received = o.receivedMinor;
        const paid = o.factoryPaidMinor;
        const first = o.firstFactoryPaid;
        const days = first ? Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${first}T00:00:00Z`).getTime()) / 86_400_000) : 0;
        return { id: o.id, refNo: o.refNo, customer: { id: o.customerId, name: o.customerName }, currency: o.currency, stuckMinor: paid - received, days, mainMinor: toMain(paid - received, o.currency) };
      })
      .filter((x) => x.stuckMinor > 0)
      .sort((a, b) => b.mainMinor - a.mainMinor || a.refNo.localeCompare(b.refNo));
    for (const s of stuck.filter((x) => x.days >= LIMITS.stuckDays))
      warnings.push({ level: "warn", text: `${s.refNo}: ${show(s.stuckMinor, s.currency)} paid to the factory ${s.days} days ago is not back from ${s.customer.name} yet.`, href: `/orders/${s.id}/money` });

    /* ----- expenses against sales, month by month (12 months to the end of the period) */
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    const monthOrders = await this.prisma.db.order.findMany({
      where: { status: { not: "cancelled" }, orderedOn: { gte: toDbDate(`${months[0]}-01`), lte: toDbDate(to) } },
      select: { total: true, currency: true, orderedOn: true },
    });
    const trend = months.map((m) => {
      const salesM = monthOrders.filter((o) => fromDbDate(o.orderedOn).startsWith(m)).reduce((t, o) => t + toMain(decimalToMinor(o.total), o.currency), 0);
      const exp = periodExpenses.filter((e) => fromDbDate(e.spentOn).startsWith(m)).reduce((t, e) => t + inMain(e), 0);
      return { month: m, sales: fromMinor(salesM), expenses: fromMinor(exp), percent: pct(exp, salesM), expMinor: exp };
    });
    const earlier = trend.slice(0, -1).filter((t) => t.expMinor > 0);
    const avg = earlier.length ? earlier.reduce((t, x) => t + x.expMinor, 0) / earlier.length : 0;
    const last = trend[trend.length - 1]!;
    if (avg > 0 && last.expMinor > avg * LIMITS.expenseJump)
      warnings.push({ level: "warn", text: `Expenses in ${monthName(last.month)} (${show(last.expMinor)}) are ${Math.round((last.expMinor / avg) * 100 - 100)}% above the monthly average.`, href: "/money?tab=expenses" });

    /* ----- factories: what visits and costs there came to */
    const factories = new Map<string, { factory: { id: string; name: string }; spent: number; count: number }>();
    for (const e of periodExpenses) {
      if (!e.factory || !inPeriod(e.spentOn)) continue;
      const f = factories.get(e.factory.id) ?? { factory: e.factory, spent: 0, count: 0 };
      f.spent += inMain(e);
      f.count += 1;
      factories.set(e.factory.id, f);
    }

    /* ----- amounts not on an account (the cash book cannot match the bank) */
    const unassigned =
      (await this.prisma.db.payment.count({ where: { accountId: null, voidedAt: null, paidOn: range } })) +
      (await this.prisma.db.factoryPayment.count({ where: { accountId: null, voidedAt: null, paidOn: range } })) +
      (await this.prisma.db.expense.count({ where: { accountId: null, voidedAt: null, spentOn: range } }));
    const hasAccounts = (await this.prisma.db.moneyAccount.count()) > 0;
    if (hasAccounts && unassigned > 0)
      warnings.push({ level: "warn", text: `${unassigned} amount${unassigned === 1 ? " is" : "s are"} not on an account, so the cash book cannot match the bank.`, href: "/money?tab=cash&acct=none" });

    const planned = leakRows.reduce((t, r) => t + r.plannedMinor, 0);
    const actual = leakRows.reduce((t, r) => t + r.actualMinor, 0);
    const won = closedDeals.filter((d) => d.stage === "won").length;
    return {
      range: { from, to },
      currency: main,
      summary: {
        lostDeals: lost.length,
        lostSpent: fromMinor(lostSpent),
        winRate: won + lost.length ? Math.round((won / (won + lost.length)) * 100) : null,
        planned: fromMinor(planned),
        actual: fromMinor(actual),
        leaked: fromMinor(planned - actual),
        keptPercent: planned > 0 ? Math.round((actual / planned) * 100) : null,
        stuck: fromMinor(stuck.reduce((t, s) => t + s.mainMinor, 0)),
      },
      lostReasons: [...reasons.entries()]
        .map(([reason, r]) => ({ reason: reason as LostReason | "not_said", label: reason === "not_said" ? "No reason given" : LOST_REASON_LABEL[reason as LostReason], deals: r.deals, spent: fromMinor(r.spent) }))
        .sort((a, b) => b.deals - a.deals),
      lostDeals: lostRows
        .sort((a, b) => b.spentMinor - a.spentMinor || b.refNo.localeCompare(a.refNo))
        .slice(0, 10)
        .map(({ spentMinor, ...r }) => ({ ...r, spent: fromMinor(spentMinor) })),
      byPerson: groupBy((d) => nameOf(d.assigneeId)),
      byCategory: groupBy((d) => d.category),
      orders: leakRows.slice(0, 15).map((r) => ({
        id: r.id,
        refNo: r.refNo,
        customer: r.customer,
        revenue: fromMinor(r.revenueMinor),
        planned: fromMinor(r.plannedMinor),
        orderCosts: fromMinor(r.orderCostsMinor),
        beforeSale: fromMinor(r.beforeSaleMinor),
        factoryExtra: fromMinor(r.factoryExtraMinor),
        actual: fromMinor(r.actualMinor),
        leaked: fromMinor(r.leakMinor),
        uncosted: r.uncosted,
      })),
      customers: {
        best: customerRows.filter((c) => c.netMinor > 0).slice(0, 5).map(({ netMinor: _n, spentMinor: _s, ...c }) => c),
        costing: customerRows.filter((c) => c.netMinor < 0).reverse().slice(0, 5).map(({ netMinor: _n, spentMinor: _s, ...c }) => c),
      },
      // Months before anything happened are left out (at least the last three stay).
      trend: trend
        .slice(Math.min(Math.max(trend.findIndex((t) => t.expMinor > 0 || Number(t.sales) > 0), 0), trend.length - 3))
        .map(({ expMinor: _e, ...t }) => t),
      stuck: stuck.slice(0, 10).map((s) => ({ id: s.id, refNo: s.refNo, customer: s.customer, currency: s.currency, amount: fromMinor(s.stuckMinor), days: s.days })),
      factories: [...factories.values()].sort((a, b) => b.spent - a.spent).map((f) => ({ factory: f.factory, spent: fromMinor(f.spent), count: f.count })),
      warnings: warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1)),
      missingRates: [...missing],
    };
  }
}
