import { Injectable } from "@nestjs/common";
import { livePurchase, decimalToMinor, fromDbDate, toDbDate, type Prisma } from "@kebo/database";
import { formatMinor, fromMinor, roundHalfAway, toMinor, type Minor } from "@kebo/money";
import { can, LOST_REASON_LABEL, type LostReason } from "@kebo/shared";
import { daysBetween, ForbiddenError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import { ReadCache } from "../../common/cache/read-cache";
import type { SessionUser } from "../../common/auth/session-user";
import { LimitsService } from "../../common/company/limits.service";
import { FactsReadService } from "../insights/facts/facts-read.service";
import { convert } from "./order-money";

/** part ÷ whole in %, one decimal, half away from zero (−6.25 → −6.3). */
const pct = (part: number, whole: number) => (whole > 0 ? roundHalfAway((part / whole) * 1000) / 10 : null);
/** "2026-11" for the month `n` months after `d`'s. */
const monthOf = (d: ISODate, n = 0) => {
  const x = new Date(`${d.slice(0, 7)}-01T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 7);
};

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
 * Where we lose money (managers), for a period: what lost deals cost and why we lost them, customers who cost
 * more than they earn, win rate and selling cost by person and by product category, profit that leaked after
 * the sale (planned against actual), expenses against sales month by month, money stuck with factories before
 * the customer paid, what visits to each factory cost — and warnings when something crosses a line.
 *
 * Every order figure (sales, profit on the quote, profit now expected, costs over plan, received, what we owe
 * and paid factories) is read from the Insights tables (FactsReadService), so it is the figure Insights and the
 * order's Costs page show; deals' outcomes from inquiry_facts; the monthly trend is Insights' sales and costs.
 * Only plain sums of expenses (a deal's selling cost, visits to a factory) are added up here, each at its own
 * rate (`convert`), as Insights' cash does.
 */
@Injectable()
export class LeaksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly cache: ReadCache,
    private readonly limits: LimitsService,
    private readonly facts: FactsReadService,
  ) {}

  /** The same for every manager: shared while nothing changes (ReadCache). */
  async report(user: SessionUser, q: { from?: ISODate; to?: ISODate }) {
    if (!can(user, "expenses.manage")) throw new ForbiddenError("Only managers can see where money is lost.");
    // Built on expenses (a plan feature); the cash book's warning only with the cash book.
    await this.limits.require("expenses");
    const cashBook = await this.limits.allows("cash_book");
    return this.cache.get(`leaks:${q.from ?? ""}:${q.to ?? ""}:${this.clock.today()}:${cashBook}`, () => this.compute(user, q, cashBook));
  }

  private async compute(user: SessionUser, q: { from?: ISODate; to?: ISODate }, cashBook: boolean) {
    const today = this.clock.today();
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 4)}-01-01`;
    const range = { gte: toDbDate(from), lte: toDbDate(to) };
    const twelve = { from: `${monthOf(to, -11)}-01`, to };
    const inMain = (e: { amount: Prisma.Decimal; rate: Prisma.Decimal }) => convert(decimalToMinor(e.amount), Number(e.rate));
    const monthName = (m: string) =>
      new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));

    // The tables first (each read works the queue off), then what only the records hold.
    const money = await this.facts.moneyByOrder(user, { from, to });
    const [decided, monthly, cash] = await Promise.all([
      this.facts.inquiryGroups(user, { from, to, period: "all", by: "company", on: "closed" }, true),
      this.facts.orderGroups(user, { ...twelve, period: "month", by: "company" }, true),
      this.facts.cash(user, twelve, true),
    ]);
    const [closedDeals, openDeals, periodExpenses, people] = await Promise.all([
      // Deals decided in the period (the Insights table's outcome and day decided).
      this.prisma.db.$queryRaw<
        {
          id: string;
          refNo: string;
          title: string;
          stage: "won" | "lost";
          category: string;
          lostReason: LostReason | null;
          assigneeId: string | null;
          customerId: string;
          customerName: string;
        }[]
      >`
        select f.inquiry_id as id, i.ref_no as "refNo", i.title, f.outcome as stage, f.category, f.lost_reason::text as "lostReason",
               f.handled_by as "assigneeId", c.id as "customerId", c.name as "customerName"
        from inquiry_facts f join inquiries i on i.id = f.inquiry_id join parties c on c.id = f.customer_id
        where f.outcome in ('won', 'lost') and f.closed_on between ${from}::date and ${to}::date`,
      // Deals still open that money was spent on, with their quotation's value (the Insights table's).
      this.prisma.db.$queryRaw<{ id: string; refNo: string; customer: string; value: string | null }[]>`
        select f.inquiry_id as id, i.ref_no as "refNo", c.name as customer, f.quoted_value_main::text as value
        from inquiry_facts f join inquiries i on i.id = f.inquiry_id join parties c on c.id = f.customer_id
        where f.outcome = 'open' and exists (select 1 from expenses e where e.inquiry_id = f.inquiry_id and e.voided_at is null)`,
      this.prisma.db.expense.findMany({
        where: { voidedAt: null, spentOn: range },
        select: {
          amount: true,
          rate: true,
          orderId: true,
          factory: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
        },
      }),
      this.prisma.db.user.findMany({ where: { isSystem: false }, select: { id: true, name: true } }),
    ]);
    const main = money.currency;
    const show = (minor: Minor, currency: string = main) => formatMinor(minor, currency as typeof main);
    const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? "Nobody";
    const warnings: Warning[] = [];

    // What was spent on each deal (all of it, and before any order: the selling cost), each expense at its own rate.
    const dealIds = [...new Set([...closedDeals.map((d) => d.id), ...openDeals.map((d) => d.id), ...money.rows.map((o) => o.inquiryId)])];
    const dealExpenses = dealIds.length
      ? await this.prisma.db.expense.findMany({
          where: { voidedAt: null, inquiryId: { in: dealIds } },
          select: { inquiryId: true, orderId: true, amount: true, rate: true },
        })
      : [];
    const spentOn = new Map<string, { all: number; selling: number }>();
    for (const e of dealExpenses) {
      const x = spentOn.get(e.inquiryId!) ?? { all: 0, selling: 0 };
      const v = inMain(e);
      x.all += v;
      if (!e.orderId) x.selling += v;
      spentOn.set(e.inquiryId!, x);
    }

    /* ----- lost deals: what they cost and why */
    const lost = closedDeals.filter((d) => d.stage === "lost");
    const reasons = new Map<string, { deals: number; spent: number }>();
    const lostRows = lost.map((d) => {
      const spent = spentOn.get(d.id)?.all ?? 0;
      const key = d.lostReason ?? "not_said";
      const r = reasons.get(key) ?? { deals: 0, spent: 0 };
      r.deals += 1;
      r.spent += spent;
      reasons.set(key, r);
      return {
        id: d.id,
        refNo: d.refNo,
        title: d.title,
        customer: { id: d.customerId, name: d.customerName },
        reason: d.lostReason,
        assignee: nameOf(d.assigneeId),
        spentMinor: spent,
      };
    });
    const lostSpent = lostRows.reduce((t, r) => t + r.spentMinor, 0);

    /* ----- win rate and selling cost by person and by category */
    const groupBy = (key: (d: (typeof closedDeals)[number]) => string) => {
      const m = new Map<string, { won: number; lost: number; spent: number }>();
      for (const d of closedDeals) {
        const k = key(d);
        const g = m.get(k) ?? { won: 0, lost: 0, spent: 0 };
        g[d.stage] += 1;
        // Selling cost: what was spent before the order (or on the lost deal), not the order's own freight and inspection.
        g.spent += spentOn.get(d.id)?.selling ?? 0;
        m.set(k, g);
      }
      return [...m.entries()]
        .map(([key, g]) => ({
          key,
          won: g.won,
          lost: g.lost,
          winRate: pct(g.won, g.won + g.lost),
          spent: fromMinor(g.spent),
          costPerWin: g.won ? fromMinor(roundHalfAway(g.spent / g.won)) : null,
        }))
        .sort((a, b) => b.won + b.lost - (a.won + a.lost) || a.key.localeCompare(b.key));
    };

    /* ----- profit planned against actual, for orders placed in the period */
    const leakRows = money.rows
      .filter((o) => o.orderedOn >= from && o.orderedOn <= to)
      .map((o) => {
        // Paid to factories beyond what we owe them (extra work, a price that changed). Rate rounding is not
        // a cost: only more than half a percent (and more than 1.00) counts.
        const over = o.factoryPaidMinor - o.factoryOwedMinor;
        const factoryExtra = over > Math.max(100, o.factoryOwedMinor * 0.005) ? over : 0;
        // Planned: the profit on the quote. After the sale: its costs over plan (expenses not in the planned
        // costs, bank charges), what was spent on the deal before it, and factories paid beyond what we owe.
        const beforeSale = spentOn.get(o.inquiryId)?.selling ?? 0;
        const actual = o.profitExpectedMinor - beforeSale - factoryExtra;
        return {
          id: o.orderId,
          refNo: o.refNo,
          customer: o.customer,
          revenueMinor: o.salesMinor,
          plannedMinor: o.profitQuoteMinor,
          orderCostsMinor: o.costsOverPlanMinor,
          beforeSaleMinor: beforeSale,
          factoryExtraMinor: factoryExtra,
          actualMinor: actual,
          leakMinor: o.profitQuoteMinor - actual,
          uncosted: o.costedMinor < o.salesMinor,
          uncostedMinor: o.salesMinor - o.costedMinor,
        };
      })
      .sort((a, b) => b.leakMinor - a.leakMinor || a.refNo.localeCompare(b.refNo));
    for (const r of leakRows) {
      if (r.actualMinor < 0)
        warnings.push({
          level: "bad",
          text: `Order ${r.refNo} (${r.customer.name}) is losing money: ${show(r.actualMinor)} after all costs.`,
          href: `/orders/${r.id}/payment`,
        });
      else if (r.plannedMinor > 0 && (r.leakMinor / r.plannedMinor) * 100 >= LIMITS.leakPercent)
        warnings.push({
          level: "warn",
          text: `Order ${r.refNo} kept only ${Math.round((r.actualMinor / r.plannedMinor) * 100)}% of its planned profit: ${show(r.leakMinor)} went on costs after the quote.`,
          href: `/orders/${r.id}/payment`,
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
      if (!e.customer || e.orderId) continue;
      cust(e.customer).spent += inMain(e);
    }
    const customerRows = [...customers.values()]
      .map((c) => ({
        customer: c.customer,
        sales: fromMinor(c.sales),
        profit: fromMinor(c.profit),
        spent: fromMinor(c.spent),
        net: fromMinor(c.profit - c.spent),
        netMinor: c.profit - c.spent,
        spentMinor: c.spent,
      }))
      .sort((a, b) => b.netMinor - a.netMinor || a.customer.name.localeCompare(b.customer.name));
    for (const c of customerRows.filter((x) => x.netMinor < 0 && Number(x.spent) > 0).slice(0, 5))
      warnings.push({
        level: "warn",
        text: `${c.customer.name} cost more than they earned us: net ${show(c.netMinor)} (spent ${show(c.spentMinor)}).`,
        href: `/customers/${c.customer.id}`,
      });

    /* ----- open deals: spending against the quotation */
    for (const d of openDeals) {
      const spent = spentOn.get(d.id)?.all ?? 0;
      // Against its latest quotation's value (its lowest option when it offers several), as Insights.
      const value = d.value === null ? 0 : toMinor(d.value);
      if (value > 0 && (spent / value) * 100 >= LIMITS.dealSpendPercent)
        warnings.push({
          level: "warn",
          text: `${d.refNo} (${d.customer}): ${show(spent)} spent, ${pct(spent, value)}% of its quotation, and not won yet.`,
          href: `/inquiries/${d.id}`,
        });
    }

    /* ----- money stuck: paid to factories before the customer paid us (open orders) */
    const open = money.rows.filter((o) => o.status === "open" && o.factoryPaidMinor - o.receivedMinor > 0);
    const firstPaid = open.length
      ? (
          await this.prisma.db.allocation.groupBy({
            by: ["purchaseOrderId"],
            where: { ...livePurchase, purchaseOrderId: { in: open.map((o) => o.orderId) } },
            _min: { on: true },
          })
        ).map((p) => ({ orderId: p.purchaseOrderId, _min: { paidOn: p._min.on } }))
      : [];
    const stuck = open
      .map((o) => {
        const first = firstPaid.find((p) => p.orderId === o.orderId)?._min.paidOn;
        return {
          id: o.orderId,
          refNo: o.refNo,
          customer: o.customer,
          currency: main,
          stuckMinor: o.factoryPaidMinor - o.receivedMinor,
          days: first ? daysBetween(fromDbDate(first), today) : 0,
        };
      })
      .sort((a, b) => b.stuckMinor - a.stuckMinor || a.refNo.localeCompare(b.refNo));
    for (const s of stuck.filter((x) => x.days >= LIMITS.stuckDays))
      warnings.push({
        level: "warn",
        text: `${s.refNo}: ${show(s.stuckMinor, s.currency)} paid to the factory ${s.days} days ago is not back from ${s.customer.name} yet.`,
        href: `/orders/${s.id}/payment`,
      });

    /* ----- expenses against sales, month by month (12 months to the end of the period): Insights' sales and costs */
    const trend = Array.from({ length: 12 }, (_, i) => monthOf(to, i - 11)).map((m) => {
      const salesM = toMinor(monthly.rows.find((r) => r.period === m)?.sales ?? "0");
      const exp = toMinor(cash.months.find((r) => r.month === m)?.expenses ?? "0");
      return { month: m, sales: fromMinor(salesM), expenses: fromMinor(exp), percent: pct(exp, salesM), expMinor: exp };
    });
    const earlier = trend.slice(0, -1).filter((t) => t.expMinor > 0);
    const avg = earlier.length ? earlier.reduce((t, x) => t + x.expMinor, 0) / earlier.length : 0;
    const last = trend[trend.length - 1]!;
    if (avg > 0 && last.expMinor > avg * LIMITS.expenseJump)
      warnings.push({
        level: "warn",
        text: `Expenses in ${monthName(last.month)} (${show(last.expMinor)}) are ${Math.round((last.expMinor / avg) * 100 - 100)}% above the monthly average.`,
        href: "/finance/expenses",
      });

    /* ----- factories: what visits and costs there came to */
    const factories = new Map<string, { factory: { id: string; name: string }; spent: number; count: number }>();
    for (const e of periodExpenses) {
      if (!e.factory) continue;
      const f = factories.get(e.factory.id) ?? { factory: e.factory, spent: 0, count: 0 };
      f.spent += inMain(e);
      f.count += 1;
      factories.set(e.factory.id, f);
    }

    /* ----- amounts not on an account (the cash book cannot match the bank) */
    const unassigned =
      (await this.prisma.db.moneyMovement.count({ where: { accountId: null, voidedAt: null, valueDate: range } })) +
      (await this.prisma.db.expense.count({ where: { accountId: null, payLater: false, voidedAt: null, spentOn: range } }));
    const hasAccounts = (await this.prisma.db.moneyAccount.count()) > 0;
    if (cashBook && hasAccounts && unassigned > 0)
      warnings.push({
        level: "warn",
        text: `${unassigned} amount${unassigned === 1 ? " is" : "s are"} not on an account, so the cash book cannot match the bank.`,
        href: "/finance/cash-book?acct=none",
      });

    const planned = leakRows.reduce((t, r) => t + r.plannedMinor, 0);
    const actual = leakRows.reduce((t, r) => t + r.actualMinor, 0);
    return {
      range: { from, to },
      currency: main,
      summary: {
        lostDeals: lost.length,
        lostSpent: fromMinor(lostSpent),
        /** Won ÷ decided, of the deals decided in the period (Insights' win rate by the day decided). */
        winRate: decided.rows[0]?.winRate ?? null,
        planned: fromMinor(planned),
        actual: fromMinor(actual),
        leaked: fromMinor(planned - actual),
        keptPercent: planned > 0 ? Math.round((actual / planned) * 100) : null,
        stuck: fromMinor(stuck.reduce((t, s) => t + s.stuckMinor, 0)),
        /** Value of the period's orders on lines without a cost: left out of planned and actual profit. */
        uncostedRevenue: fromMinor(leakRows.reduce((t, r) => t + r.uncostedMinor, 0)),
      },
      lostReasons: [...reasons.entries()]
        .map(([reason, r]) => ({
          reason: reason as LostReason | "not_said",
          label: reason === "not_said" ? "No reason given" : LOST_REASON_LABEL[reason as LostReason],
          deals: r.deals,
          spent: fromMinor(r.spent),
        }))
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
        /** Its value on lines without a cost: left out of planned and actual profit. */
        uncostedRevenue: fromMinor(r.uncostedMinor),
      })),
      customers: {
        best: customerRows
          .filter((c) => c.netMinor > 0)
          .slice(0, 5)
          .map(({ netMinor: _n, spentMinor: _s, ...c }) => c),
        costing: customerRows
          .filter((c) => c.netMinor < 0)
          .reverse()
          .slice(0, 5)
          .map(({ netMinor: _n, spentMinor: _s, ...c }) => c),
      },
      // Months before anything happened are left out (at least the last three stay).
      trend: trend
        .slice(
          Math.min(
            Math.max(
              trend.findIndex((t) => t.expMinor > 0 || Number(t.sales) > 0),
              0,
            ),
            trend.length - 3,
          ),
        )
        .map(({ expMinor: _e, ...t }) => t),
      stuck: stuck.slice(0, 10).map((s) => ({
        id: s.id,
        refNo: s.refNo,
        customer: s.customer,
        currency: s.currency,
        amount: fromMinor(s.stuckMinor),
        days: s.days,
      })),
      factories: [...factories.values()]
        .sort((a, b) => b.spent - a.spent)
        .map((f) => ({ factory: f.factory, spent: fromMinor(f.spent), count: f.count })),
      warnings: warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1)),
      missingRates: [...new Set([...monthly.missingRates, ...cash.missingRates])].sort(),
    };
  }
}
