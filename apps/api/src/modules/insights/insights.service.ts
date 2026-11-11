import { Injectable } from "@nestjs/common";
import { livePart, fromDbDate } from "@kebo/database";
import { fromMinor, toMinor } from "@kebo/money";
import { can, PAYMENT_ROUTE_SHORT, planStatus, planWhen, type BalanceWhen, type LcTerms } from "@kebo/shared";
import { daysBetween, DomainError, ForbiddenError, type ISODate } from "@kebo/utils";
import { creditsAll } from "../treasury/api";
import { CashService } from "../treasury/cash.service";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { ordersWithMoneyDue } from "../billing/api";
import { chargedExpenses, fxOf, positionOf } from "../billing/api";
import { MainMoney } from "../money/order-money";
import { livePlansOf } from "../billing/api";
import { FactsReadService } from "./facts/facts-read.service";

const ymOf = (d: ISODate) => d.slice(0, 7);
/** The last day of `d`'s month. */
const monthEnd = (d: ISODate): ISODate => {
  const [y, m] = d.slice(0, 7).split("-").map(Number) as [number, number];
  return `${d.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
/** The change from `before` to `now` in percent, as Insights shows it (null when there was nothing before). */
const change = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 100));

/**
 * Targets (the company's and each person's), what customers still owe order by order, and the few figures the
 * emails carry. Every sales, profit and money figure is read from the Insights tables (FactsReadService), the
 * same as Insights and Home show.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly cash: CashService,
    private readonly limits: LimitsService,
    private readonly facts: FactsReadService,
  ) {}

  private assert(user: SessionUser) {
    if (!can(user, "reports.view")) throw new ForbiddenError("Only managers can see insights.");
  }

  /** A target in the main currency (it was set in the main currency of its day). */
  private async inMain(t: { amount: { toString(): string }; currency: string }) {
    const { sales } = await this.settings.get();
    return new MainMoney(sales.currency, sales.exchangeRates).live(toMinor(t.amount.toString()), t.currency);
  }

  /** This month's company target and how far along it is: Insights' sales for the month (Home). */
  async monthTarget(user: SessionUser) {
    this.assert(user);
    const today = this.clock.today();
    const month = ymOf(today);
    const [t, sold] = await Promise.all([
      this.prisma.db.salesTarget.findUnique({ where: { companyId_month: { companyId: user.companyId, month } } }),
      this.facts.orderGroups(user, { from: `${month}-01`, to: monthEnd(today), period: "all", by: "company" }),
    ]);
    const reached = toMinor(sold.rows[0]?.sales ?? "0");
    const amount = t ? await this.inMain(t) : null;
    return {
      month,
      currency: sold.currency,
      amount: amount === null ? null : fromMinor(amount),
      reached: fromMinor(reached),
      percent: amount ? Math.round((reached / amount) * 100) : null,
      canSet: can(user, "expenses.manage"),
    };
  }

  /**
   * The figures the summary emails carry for a span (and, given, the span before), read as the system: sales,
   * orders, profit on the quote and now expected, win rate, cash in, new customers, what customers owe, the
   * month's target, the best customers, and what is in our accounts (the cash book, a plan feature).
   */
  async figures(user: SessionUser, span: { from: ISODate; to: ISODate }, before?: { from: ISODate; to: ISODate }) {
    const all = { period: "all" as const, by: "company" as const };
    const [now, prev, funnel, cash, owed, byCustomer, fresh] = await Promise.all([
      this.facts.orderGroups(user, { ...span, ...all }, true),
      before ? this.facts.orderGroups(user, { ...before, ...all }, true) : Promise.resolve(null),
      this.facts.funnel(user, span, true),
      this.facts.cash(user, span, true),
      this.facts.aging(user, { side: "receivable" }, true),
      this.facts.orderGroups(user, { ...span, period: "all", by: "customer" }, true),
      // Customers whose first order (not cancelled) falls in the span.
      this.prisma.db.$queryRaw<{ n: number }[]>`
        select count(*)::int as n from (select customer_id, min(ordered_on) as first from order_facts where status <> 'cancelled' group by 1) x
        where x.first between ${span.from}::date and ${span.to}::date`,
    ]);
    const t = now.rows[0];
    const b = prev?.rows[0];
    const n = (v: string | null | undefined) => toMinor(v ?? "0");
    let inHand: string | null = null;
    if (await this.limits.allows("cash_book")) {
      const { sales } = await this.settings.get();
      const fx = new MainMoney(sales.currency, sales.exchangeRates);
      const accounts = (await this.cash.accounts(user)) as { archived: boolean; currency: string; balance?: string }[];
      inHand = fromMinor(accounts.filter((a) => !a.archived && a.balance !== undefined).reduce((s, a) => s + fx.live(toMinor(a.balance!), a.currency), 0));
    }
    const target = span.from.slice(0, 7) === span.to.slice(0, 7) ? await this.monthTargetOf(span.from.slice(0, 7), n(t?.sales)) : null;
    return {
      currency: now.currency,
      sales: { value: t?.sales ?? "0.00", change: b ? change(n(t?.sales), n(b.sales)) : null },
      orders: { value: t?.orders ?? 0, change: b ? change(t?.orders ?? 0, b.orders) : null },
      /** Gross profit: the profit on the quote, and its margin. */
      grossProfit: { value: t?.profitQuote ?? "0.00", margin: t?.marginQuote ?? null },
      /** Profit now expected (after the costs over plan), with the money permission and the expenses module. */
      profitExpected: t?.profitExpected === null || t?.profitExpected === undefined ? null : { value: t.profitExpected, change: b?.profitExpected ? change(n(t.profitExpected), n(b.profitExpected)) : null },
      winRate: funnel.winRate,
      cashIn: fromMinor(cash.months.reduce((s, m) => s + n(m.in), 0)),
      newCustomers: fresh[0]?.n ?? 0,
      toReceive: owed.total,
      overdue: fromMinor(n(owed.d30) + n(owed.d60) + n(owed.d90) + n(owed.older)),
      inHand,
      target,
      topCustomers: [...byCustomer.rows].sort((x, y) => n(y.sales) - n(x.sales)).slice(0, 5).map((c) => ({ name: c.label, sales: c.sales })),
    };
  }

  private async monthTargetOf(month: string, reachedMinor: number) {
    const t = await this.prisma.db.salesTarget.findFirst({ where: { month } });
    if (!t) return null;
    const amount = await this.inMain(t);
    return { amount: fromMinor(amount), reached: fromMinor(reachedMinor), percent: amount ? Math.round((reachedMinor / amount) * 100) : null };
  }

  /* ---------------------------------------------------------------- targets */

  async targets(user: SessionUser, year: number) {
    this.assert(user);
    const rows = await this.prisma.db.salesTarget.findMany({ where: { month: { startsWith: `${year}-` } }, orderBy: { month: "asc" } });
    return rows.map((r) => ({ month: r.month, amount: r.amount.toFixed(2), currency: r.currency }));
  }

  /** A month's sales target in the main currency; 0 or empty removes it. */
  async setTarget(user: SessionUser, month: string, amount: number | null) {
    if (!can(user, "expenses.manage")) throw new ForbiddenError("Only managers can set targets.");
    const { sales } = await this.settings.get();
    if (!amount) {
      await this.prisma.db.salesTarget.deleteMany({ where: { month } });
      return { month, amount: null };
    }
    const row = await this.prisma.db.salesTarget.upsert({
      where: { companyId_month: { companyId: user.companyId, month } },
      create: { month, amount, currency: sales.currency, updatedById: user.id },
      update: { amount, currency: sales.currency, updatedById: user.id },
    });
    return { month: row.month, amount: row.amount.toFixed(2), currency: row.currency };
  }

  /** Each person's targets for a year (managers set them in Company › Targets). */
  async personTargets(user: SessionUser, year: number) {
    this.assert(user);
    const [rows, people] = await Promise.all([
      this.prisma.db.personTarget.findMany({ where: { month: { startsWith: `${year}-` } }, orderBy: [{ month: "asc" }] }),
      // The people who sell: those who handle inquiries (or already have a target that year).
      this.prisma.db.user.findMany({
        where: {
          isSystem: false,
          isActive: true,
          OR: [{ assignedDeals: { some: { deletedAt: null } } }, { relPersonTarget: { some: { month: { startsWith: `${year}-` } } } }],
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 30,
      }),
    ]);
    return { people, targets: rows.map((r) => ({ month: r.month, userId: r.userId, amount: r.amount.toFixed(2), currency: r.currency })) };
  }

  /** One person's target for a month in the main currency; 0 or empty removes it. */
  async setPersonTarget(user: SessionUser, month: string, userId: string, amount: number | null) {
    if (!can(user, "expenses.manage")) throw new ForbiddenError("Only managers can set targets.");
    const person = await this.prisma.db.user.findFirst({ where: { id: userId, isSystem: false } });
    if (!person) throw new DomainError("That person is not in your company.");
    const { sales } = await this.settings.get();
    if (!amount) {
      await this.prisma.db.personTarget.deleteMany({ where: { month, userId } });
      return { month, userId, amount: null };
    }
    const row = await this.prisma.db.personTarget.upsert({
      where: { companyId_month_userId: { companyId: user.companyId, month, userId } },
      create: { month, userId, amount, currency: sales.currency, updatedById: user.id },
      update: { amount, currency: sales.currency, updatedById: user.id },
    });
    return { month: row.month, userId, amount: row.amount.toFixed(2), currency: row.currency };
  }

  /** My own target this month and how far I am (Home, for everyone with a target): my sales from the Insights tables. */
  async myTarget(user: SessionUser) {
    const today = this.clock.today();
    const month = ymOf(today);
    const t = await this.prisma.db.personTarget.findUnique({ where: { companyId_month_userId: { companyId: user.companyId, month, userId: user.id } } });
    if (!t) return { month, target: null, sold: null, percent: null, currency: null, daysLeft: null };
    const mine = await this.facts.orderGroups(user, { from: `${month}-01`, to: today, personId: user.id, period: "all", by: "company" }, true);
    const sold = toMinor(mine.rows[0]?.sales ?? "0");
    const target = await this.inMain(t);
    return {
      month,
      currency: mine.currency,
      target: fromMinor(target),
      sold: fromMinor(sold),
      percent: target ? Math.round((sold / target) * 100) : null,
      daysLeft: daysBetween(today, monthEnd(today)),
    };
  }

  /* ---------------------------------------------------------------- to receive */

  /** What customers still owe, order by order, the most overdue first (Money → To receive). */
  async receivables(user: SessionUser) {
    if (!can(user, "payments.record") && !can(user, "expenses.manage")) throw new ForbiddenError("You do not record money.");
    const today = this.clock.today();
    const fx = fxOf(await this.settings.get(), await this.limits.allows("expenses"));
    const orders = await this.prisma.db.order.findMany({
      where: { status: { in: ["open", "closed"] }, id: { in: await ordersWithMoneyDue(this.prisma, fx) } },
      select: {
        id: true,
        refNo: true,
        currency: true,
        mainCurrency: true,
        mainRate: true,
        depositPercent: true,
        expenses: chargedExpenses,
        total: true,
        stage: true,
        status: true,
        paymentRoute: true,
        balanceWhen: true,
        lcTerms: true,
        lcDays: true,
        customer: { select: { id: true, name: true } },
        inquiry: { select: { assignee: { select: { id: true, name: true } } } },
        allocations: { where: livePart, select: { amount: true, bankCharges: true, on: true } },
        receivables: { orderBy: { sortOrder: "asc" }, select: { id: true, label: true, amount: true, dueOn: true, part: true, dueRule: true, dueDays: true } },
      },
    });
    const livePlans = await livePlansOf(this.prisma.db, orders.map((o) => o.id));
    const rows = orders
      .map((o) => {
        const settled = positionOf(o, fx);
        if (settled.dueMinor <= 0) return null;
        // Dated from each instalment's rule and the order's dates as they are now.
        const plan = planStatus(livePlans.get(o.id)?.items ?? [], settled.settledMinor, today, 7);
        const next = plan.find((p) => p.openMinor > 0) ?? null;
        const terms = { route: o.paymentRoute, balanceWhen: o.balanceWhen as BalanceWhen | null, lcTerms: o.lcTerms as LcTerms | null, lcDays: o.lcDays };
        const late = plan.filter((p) => p.status === "late");
        const lastPaid =
          o.allocations
            .map((p) => fromDbDate(p.on))
            .sort()
            .pop() ?? null;
        return {
          id: o.id,
          refNo: o.refNo,
          customer: o.customer,
          handledBy: o.inquiry.assignee,
          stage: o.stage,
          closed: o.status === "closed",
          currency: o.currency,
          total: o.total.toFixed(2),
          received: fromMinor(settled.settledMinor),
          /** Expenses charged to the customer: part of what is due. */
          charged: fromMinor(settled.chargedMinor),
          due: fromMinor(settled.dueMinor),
          overdue: fromMinor(late.reduce((t, p) => t + p.openMinor, 0)),
          daysLate: late.length && late[0]!.dueOn ? daysBetween(late[0]!.dueOn, today) : 0,
          next: next && {
            label: next.label,
            open: fromMinor(next.openMinor),
            dueOn: next.dueOn,
            status: next.status,
            /** When an undated part falls due ("90 days after the papers"). */
            when: next.dueOn ? null : planWhen(next, terms) || null,
          },
          /** How it comes: the route ("LC", "Informal", "Bank contract"). */
          how: o.paymentRoute ? PAYMENT_ROUTE_SHORT[o.paymentRoute] : null,
          lastPaid,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.daysLate - a.daysLate || (a.next?.dueOn ?? "9999").localeCompare(b.next?.dueOn ?? "9999"));
    const totals = new Map<string, { due: number; overdue: number }>();
    for (const r of rows) {
      const t = totals.get(r.currency) ?? { due: 0, overdue: 0 };
      t.due += Math.round(Number(r.due) * 100);
      t.overdue += Math.round(Number(r.overdue) * 100);
      totals.set(r.currency, t);
    }
    // Money we hold for customers (their credit): shown as a minus against what they owe.
    const byCustomer = new Map<string, Record<string, number>>();
    for (const c of await creditsAll(this.prisma.db)) {
      const b = byCustomer.get(c.partyId) ?? {};
      b[c.currency] = (b[c.currency] ?? 0) + c.minor;
      byCustomer.set(c.partyId, b);
    }
    const held = new Map<string, { minor: number; customers: number }>();
    for (const b of byCustomer.values())
      for (const [currency, minor] of Object.entries(b)) {
        if (minor <= 0) continue;
        const h = held.get(currency) ?? { minor: 0, customers: 0 };
        h.minor += minor;
        h.customers += 1;
        held.set(currency, h);
      }
    return {
      rows,
      totals: [...totals.entries()].map(([currency, t]) => ({
        currency,
        due: fromMinor(t.due),
        overdue: fromMinor(t.overdue),
        /** What they owe less the credit we hold for them. */
        credit: fromMinor(held.get(currency)?.minor ?? 0),
        net: fromMinor(t.due - (held.get(currency)?.minor ?? 0)),
      })),
      /** Held for customers (their credit), per currency. */
      held: [...held.entries()].map(([currency, h]) => ({ currency, amount: fromMinor(h.minor), customers: h.customers })),
    };
  }
}
