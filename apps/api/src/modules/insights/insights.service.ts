import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, toDbDate } from "@kebo/database";
import { fromMinor, fxRate, roundHalfAway, settle, type Minor } from "@kebo/money";
import { can, LOST_REASON_LABEL, planStatus, type InquiryChannel, type LostReason } from "@kebo/shared";
import { addDays, daysBetween, ForbiddenError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { CashService } from "../money/cash.service";
import { MoneyService } from "../money/money.service";

const convert = (minor: Minor, rate: number) => roundHalfAway(minor / rate);
const ymOf = (d: ISODate) => d.slice(0, 7);
const ymParts = (ym: string) => ym.split("-").map(Number) as [number, number];
/** The month after "2026-10": "2026-11". */
const nextMonth = (ym: string) => {
  const [y, m] = ymParts(ym);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};
/** The last day of a month: "2026-02" → "2026-02-28". */
const lastDayOf = (ym: string) => {
  const [y, m] = ymParts(ym);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
/** The same day n months later (or earlier), kept inside the month (31 Mar − 1 month → 28/29 Feb). */
export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m] = ymParts(d.slice(0, 7));
  const ym = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  const last = Number(lastDayOf(ym).slice(8));
  return `${ym}-${String(Math.min(Number(d.slice(8)), last)).padStart(2, "0")}`;
}
const monthsList = (fromYm: string, toYm: string) => {
  const out: string[] = [];
  for (let m = fromYm; m <= toYm; m = nextMonth(m)) out.push(m);
  return out;
};

/**
 * The period before: the same calendar days a month (or as many months) back
 * when the period starts on the 1st ("October to the 28th" against "September
 * to the 28th"), otherwise the same number of days just before.
 */
export function previousPeriod(from: ISODate, to: ISODate): { from: ISODate; to: ISODate } {
  if (from.endsWith("-01")) {
    const months = monthsList(ymOf(from), ymOf(to)).length;
    const pTo = to === lastDayOf(ymOf(to)) ? lastDayOf(ymOf(addMonths(`${ymOf(to)}-01`, -months))) : addMonths(to, -months);
    return { from: addMonths(from, -months), to: pTo };
  }
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

type Figures = {
  revenue: number;
  goodsCost: number;
  expenses: number;
  cashIn: number;
  cashOut: number;
  orders: number;
  received: number;
  won: number;
  lost: number;
  quotesSent: number;
  quotesValue: number;
  quoteDays: number[];
  closeDays: number[];
  shippedWithDate: number;
  shippedOnTime: number;
  newCustomers: number;
  repeatOrders: number;
};
const empty = (): Figures => ({
  revenue: 0,
  goodsCost: 0,
  expenses: 0,
  cashIn: 0,
  cashOut: 0,
  orders: 0,
  received: 0,
  won: 0,
  lost: 0,
  quotesSent: 0,
  quotesValue: 0,
  quoteDays: [],
  closeDays: [],
  shippedWithDate: 0,
  shippedOnTime: 0,
  newCustomers: 0,
  repeatOrders: 0,
});
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((t, x) => t + x, 0) / xs.length) * 10) / 10 : null);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/**
 * The numbers behind Insights and Home, for any period, against the period
 * before: sales, profit, cash, the funnel, customers, countries, channels,
 * people and factories, what customers owe by age, and the monthly target.
 * Amounts are in the main currency (orders and payments at today's Settings
 * rates; expenses and factory payments at the rates used when paid).
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly cash: CashService,
    private readonly money: MoneyService,
  ) {}

  private assert(user: SessionUser) {
    if (!can(user, "reports.view")) throw new ForbiddenError("Only managers can see insights.");
  }

  async overview(user: SessionUser, q: { from?: ISODate; to?: ISODate }) {
    this.assert(user);
    const today = this.clock.today();
    const to = q.to && q.to < today ? q.to : today;
    const from = q.from && q.from <= to ? q.from : `${ymOf(to)}-01`;
    const prev = previousPeriod(from, to);
    const seeMoney = can(user, "expenses.manage");
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

    // The 12 months up to the end of the period (or every month of a longer period), and the same months a year before.
    const seriesMonths = monthsList(ymOf(from) < ymOf(addMonths(to, -11)) ? ymOf(from) : ymOf(addMonths(to, -11)), ymOf(to));
    const loadFrom = [prev.from, `${ymOf(addMonths(`${seriesMonths[0]}-01`, -12))}-01`].sort()[0]!;
    const span = { gte: toDbDate(loadFrom), lte: toDbDate(to) };
    const spanTime = { gte: new Date(`${loadFrom}T00:00:00Z`), lt: new Date(`${addDays(to, 1)}T00:00:00Z`) };

    const [orders, expenses, payments, factoryPaid, deals, revisions, firstOrders, targets] = await Promise.all([
      this.prisma.db.order.findMany({
        where: { status: { not: "cancelled" }, orderedOn: span },
        select: {
          id: true,
          currency: true,
          total: true,
          orderedOn: true,
          shipBy: true,
          shippedOn: true,
          customerId: true,
          customer: { select: { id: true, name: true, country: true } },
          inquiry: { select: { category: true, channel: true, assigneeId: true } },
          lines: {
            select: {
              unitCost: true,
              quantity: true,
              lineTotal: true,
              quoteLine: { select: { factoryQuoteLine: { select: { factoryQuote: { select: { factory: { select: { id: true, name: true } } } } } } } },
            },
          },
        },
      }),
      seeMoney ? this.prisma.db.expense.findMany({ where: { voidedAt: null, spentOn: span }, select: { amount: true, rate: true, spentOn: true } }) : Promise.resolve([]),
      this.prisma.db.payment.findMany({ where: { voidedAt: null, paidOn: span }, select: { amount: true, bankCharges: true, currency: true, paidOn: true } }),
      seeMoney
        ? this.prisma.db.factoryPayment.findMany({ where: { voidedAt: null, paidOn: span }, select: { amount: true, rate: true, paidOn: true, order: { select: { currency: true } } } })
        : Promise.resolve([]),
      this.prisma.db.inquiry.findMany({
        where: { deletedAt: null, OR: [{ createdAt: spanTime }, { closedAt: spanTime }] },
        select: {
          id: true,
          createdAt: true,
          closedAt: true,
          stage: true,
          lostReason: true,
          channel: true,
          category: true,
          assigneeId: true,
          quotation: { select: { revisions: { where: { deletedAt: null, sentOn: { not: null } }, orderBy: { sentOn: "asc" }, take: 1, select: { sentOn: true } } } },
        },
      }),
      this.prisma.db.quotationRevision.findMany({
        where: { deletedAt: null, sentOn: span, status: { notIn: ["draft"] } },
        select: { sentOn: true, total: true, currency: true },
      }),
      this.prisma.db.order.groupBy({ by: ["customerId"], where: { status: { not: "cancelled" } }, _min: { orderedOn: true } }),
      this.prisma.db.salesTarget.findMany({ where: { month: { in: seriesMonths } } }),
    ]);
    const firstOrder = new Map(firstOrders.map((f) => [f.customerId, fromDbDate(f._min.orderedOn!)]));
    const dayOf = (d: Date) => d.toISOString().slice(0, 10);
    const inRange = (d: ISODate, r: { from: ISODate; to: ISODate }) => d >= r.from && d <= r.to;

    // Per order, once: value and goods cost in the main currency.
    const orderMoney = orders.map((o) => {
      let cost = 0;
      for (const l of o.lines) if (l.unitCost !== null) cost += roundHalfAway(decimalToMinor(l.unitCost) * Number(l.quantity));
      return { o, on: fromDbDate(o.orderedOn), revenue: toMain(decimalToMinor(o.total), o.currency), cost: toMain(cost, o.currency) };
    });

    const figuresFor = (r: { from: ISODate; to: ISODate }): Figures => {
      const f = empty();
      for (const x of orderMoney) {
        if (!inRange(x.on, r)) continue;
        f.revenue += x.revenue;
        f.goodsCost += x.cost;
        f.orders += 1;
        const first = firstOrder.get(x.o.customerId);
        if (first && inRange(first, r) && first === x.on) f.newCustomers += 1;
        if (first && first < x.on) f.repeatOrders += 1;
      }
      for (const o of orders) {
        const shipped = fromDbDateOrNull(o.shippedOn);
        const by = fromDbDateOrNull(o.shipBy);
        if (shipped && by && inRange(shipped, r)) {
          f.shippedWithDate += 1;
          if (shipped <= by) f.shippedOnTime += 1;
        }
      }
      for (const e of expenses) if (inRange(fromDbDate(e.spentOn), r)) f.expenses += convert(decimalToMinor(e.amount), Number(e.rate));
      for (const p of payments) if (inRange(fromDbDate(p.paidOn), r)) f.cashIn += toMain(decimalToMinor(p.amount), p.currency);
      for (const p of factoryPaid) if (inRange(fromDbDate(p.paidOn), r)) f.cashOut += toMain(convert(decimalToMinor(p.amount), Number(p.rate)), p.order.currency);
      f.cashOut += f.expenses;
      for (const d of deals) {
        const created = dayOf(d.createdAt);
        if (inRange(created, r)) f.received += 1;
        const closed = d.closedAt ? dayOf(d.closedAt) : null;
        if (closed && inRange(closed, r)) {
          if (d.stage === "won") {
            f.won += 1;
            f.closeDays.push(daysBetween(created, closed));
          } else if (d.stage === "lost") f.lost += 1;
        }
        const sent = d.quotation?.revisions[0]?.sentOn;
        if (sent && inRange(fromDbDate(sent), r)) f.quoteDays.push(daysBetween(created, fromDbDate(sent)));
      }
      for (const q of revisions) {
        if (!q.sentOn || !inRange(fromDbDate(q.sentOn), r)) continue;
        f.quotesSent += 1;
        f.quotesValue += toMain(decimalToMinor(q.total), q.currency);
      }
      return f;
    };
    const cur = figuresFor({ from, to });
    const before = figuresFor(prev);

    /* ----- right now: cash, what customers owe (by age), what we owe factories, the pipeline */
    const openOrders = await this.prisma.db.order.findMany({
      where: { status: { in: ["open", "closed"] } },
      select: {
        currency: true,
        total: true,
        payments: { where: { voidedAt: null }, select: { amount: true, bankCharges: true, currency: true } },
        planItems: { orderBy: { sortOrder: "asc" }, select: { id: true, label: true, amount: true, dueOn: true } },
      },
    });
    const aging = { notDue: 0, d30: 0, d60: 0, d90: 0, older: 0 };
    let toReceive = 0;
    let overdue = 0;
    for (const o of openOrders) {
      const settled = settle(
        decimalToMinor(o.total),
        o.payments.filter((p) => p.currency === o.currency).map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })),
      );
      if (settled.outstandingMinor <= 0) continue;
      toReceive += toMain(settled.outstandingMinor, o.currency);
      const plan = planStatus(
        o.planItems.map((p) => ({ id: p.id, label: p.label, amountMinor: decimalToMinor(p.amount), dueOn: fromDbDateOrNull(p.dueOn) })),
        settled.settledMinor,
        today,
        0,
      );
      for (const p of plan) {
        if (p.openMinor <= 0) continue;
        const v = toMain(p.openMinor, o.currency);
        if (!p.dueOn || p.dueOn >= today) aging.notDue += v;
        else {
          overdue += v;
          const late = daysBetween(p.dueOn, today);
          if (late <= 30) aging.d30 += v;
          else if (late <= 60) aging.d60 += v;
          else if (late <= 90) aging.d90 += v;
          else aging.older += v;
        }
      }
    }
    let cashInHand: number | null = null;
    let toPay: number | null = null;
    if (seeMoney) {
      const accounts = (await this.cash.accounts(user)) as { archived: boolean; currency: string; balance?: string }[];
      cashInHand = accounts.filter((a) => !a.archived && a.balance !== undefined).reduce((t, a) => t + toMain(Math.round(Number(a.balance) * 100), a.currency), 0);
      const payables = await this.money.payables(user, false);
      toPay = payables.reduce((t, p) => t + toMain(Math.round(Number(p.toPay) * 100), p.currency), 0);
    }
    const quoted = await this.prisma.db.inquiry.findMany({
      where: { deletedAt: null, stage: "quoted" },
      select: { quotation: { select: { revisions: { where: { deletedAt: null, status: "sent" }, orderBy: { number: "desc" }, take: 1, select: { total: true, currency: true } } } } },
    });
    const pipeline = quoted.reduce((t, d) => {
      const r = d.quotation?.revisions[0];
      return t + (r ? toMain(decimalToMinor(r.total), r.currency) : 0);
    }, 0);
    const winRate = pct(cur.won, cur.won + cur.lost);

    /* ----- month by month */
    const series = seriesMonths.map((m) => {
      const r = { from: `${m}-01`, to: lastDayOf(m) < to ? lastDayOf(m) : to };
      const f = figuresFor(r);
      const ly = figuresFor({ from: addMonths(`${m}-01`, -12), to: lastDayOf(ymOf(addMonths(`${m}-01`, -12))) });
      const target = targets.find((t) => t.month === m);
      return {
        month: m,
        revenue: fromMinor(f.revenue),
        grossProfit: fromMinor(f.revenue - f.goodsCost),
        expenses: seeMoney ? fromMinor(f.expenses) : null,
        netProfit: seeMoney ? fromMinor(f.revenue - f.goodsCost - f.expenses) : null,
        cashIn: fromMinor(f.cashIn),
        cashOut: seeMoney ? fromMinor(f.cashOut) : null,
        received: f.received,
        won: f.won,
        lastYearRevenue: fromMinor(ly.revenue),
        target: target ? fromMinor(toMain(decimalToMinor(target.amount), target.currency)) : null,
      };
    });

    /* ----- this period's breakdowns */
    const inCur = orderMoney.filter((x) => inRange(x.on, { from, to }));
    const group = <K extends string>(key: (x: (typeof inCur)[number]) => K | null) => {
      const m = new Map<K, { revenue: number; cost: number; orders: number; customers: Set<string> }>();
      for (const x of inCur) {
        const k = key(x);
        if (k === null) continue;
        const g = m.get(k) ?? { revenue: 0, cost: 0, orders: 0, customers: new Set<string>() };
        g.revenue += x.revenue;
        g.cost += x.cost;
        g.orders += 1;
        g.customers.add(x.o.customerId);
        m.set(k, g);
      }
      return [...m.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
    };
    const customerNames = new Map(inCur.map((x) => [x.o.customer.id, x.o.customer]));
    const topCustomers = group((x) => x.o.customer.id)
      .slice(0, 10)
      .map(([id, g]) => ({
        customer: customerNames.get(id)!,
        revenue: fromMinor(g.revenue),
        grossProfit: fromMinor(g.revenue - g.cost),
        orders: g.orders,
        isNew: (() => {
          const f = firstOrder.get(id);
          return !!f && inRange(f, { from, to });
        })(),
      }));
    const categories = group((x) => x.o.inquiry.category)
      .slice(0, 10)
      .map(([category, g]) => ({ category, revenue: fromMinor(g.revenue), grossProfit: fromMinor(g.revenue - g.cost), orders: g.orders }));
    const countries = group((x) => x.o.customer.country).map(([country, g]) => ({ country, revenue: fromMinor(g.revenue), orders: g.orders, customers: g.customers.size }));

    const dealsCur = deals.filter((d) => inRange(dayOf(d.createdAt), { from, to }));
    const closedCur = deals.filter((d) => d.closedAt && inRange(dayOf(d.closedAt), { from, to }));
    const funnel = {
      received: dealsCur.length,
      quoted: dealsCur.filter((d) => d.quotation?.revisions.length).length,
      won: dealsCur.filter((d) => d.stage === "won").length,
    };
    const channels = new Map<InquiryChannel, { received: number; won: number }>();
    for (const d of dealsCur) {
      const c = channels.get(d.channel) ?? { received: 0, won: 0 };
      c.received += 1;
      if (d.stage === "won") c.won += 1;
      channels.set(d.channel, c);
    }
    const lostReasons = new Map<string, number>();
    for (const d of closedCur.filter((x) => x.stage === "lost")) lostReasons.set(d.lostReason ?? "not_said", (lostReasons.get(d.lostReason ?? "not_said") ?? 0) + 1);

    const users = await this.prisma.db.user.findMany({ where: { isSystem: false }, select: { id: true, name: true } });
    const people = new Map<string, { received: number; won: number; lost: number; revenue: number; quoteDays: number[] }>();
    const person = (id: string | null) => {
      const k = id ?? "nobody";
      const p = people.get(k) ?? { received: 0, won: 0, lost: 0, revenue: 0, quoteDays: [] };
      people.set(k, p);
      return p;
    };
    for (const d of dealsCur) {
      const p = person(d.assigneeId);
      p.received += 1;
      const sent = d.quotation?.revisions[0]?.sentOn;
      if (sent) p.quoteDays.push(daysBetween(dayOf(d.createdAt), fromDbDate(sent)));
    }
    for (const d of closedCur) {
      if (d.stage === "won") person(d.assigneeId).won += 1;
      else if (d.stage === "lost") person(d.assigneeId).lost += 1;
    }
    for (const x of inCur) person(x.o.inquiry.assigneeId).revenue += x.revenue;

    const factories = new Map<string, { factory: { id: string; name: string }; spend: number; orders: Set<string> }>();
    for (const x of inCur)
      for (const l of x.o.lines) {
        const f = l.quoteLine?.factoryQuoteLine?.factoryQuote.factory;
        if (!f || l.unitCost === null) continue;
        const g = factories.get(f.id) ?? { factory: f, spend: 0, orders: new Set<string>() };
        g.spend += toMain(roundHalfAway(decimalToMinor(l.unitCost) * Number(l.quantity)), x.o.currency);
        g.orders.add(x.o.id);
        factories.set(f.id, g);
      }

    const monthTarget = targets.find((t) => t.month === ymOf(today));
    const monthRevenue = figuresFor({ from: `${ymOf(today)}-01`, to: today }).revenue;

    /** A figure now and before, with the change in percent (null when there is nothing to compare). */
    const kpi = (now: number | null, then: number | null, money = true) => ({
      value: now === null ? null : money ? fromMinor(now) : now,
      previous: then === null ? null : money ? fromMinor(then) : then,
      change: now === null || then === null || then === 0 ? null : Math.round(((now - then) / Math.abs(then)) * 1000) / 10,
    });

    return {
      range: { from, to },
      previous: prev,
      currency: main,
      seeMoney,
      kpis: {
        revenue: kpi(cur.revenue, before.revenue),
        grossProfit: kpi(cur.revenue - cur.goodsCost, before.revenue - before.goodsCost),
        margin: kpi(pct(cur.revenue - cur.goodsCost, cur.revenue), pct(before.revenue - before.goodsCost, before.revenue), false),
        netProfit: seeMoney ? kpi(cur.revenue - cur.goodsCost - cur.expenses, before.revenue - before.goodsCost - before.expenses) : null,
        expenses: seeMoney ? kpi(cur.expenses, before.expenses) : null,
        cashIn: kpi(cur.cashIn, before.cashIn),
        cashOut: seeMoney ? kpi(cur.cashOut, before.cashOut) : null,
        orders: kpi(cur.orders, before.orders, false),
        avgOrder: kpi(cur.orders ? Math.round(cur.revenue / cur.orders) : null, before.orders ? Math.round(before.revenue / before.orders) : null),
        received: kpi(cur.received, before.received, false),
        won: kpi(cur.won, before.won, false),
        winRate: kpi(winRate, pct(before.won, before.won + before.lost), false),
        quotesSent: kpi(cur.quotesSent, before.quotesSent, false),
        quotesValue: kpi(cur.quotesValue, before.quotesValue),
        quoteDays: kpi(avg(cur.quoteDays), avg(before.quoteDays), false),
        closeDays: kpi(avg(cur.closeDays), avg(before.closeDays), false),
        onTime: kpi(pct(cur.shippedOnTime, cur.shippedWithDate), pct(before.shippedOnTime, before.shippedWithDate), false),
        newCustomers: kpi(cur.newCustomers, before.newCustomers, false),
        repeatShare: kpi(pct(cur.repeatOrders, cur.orders), pct(before.repeatOrders, before.orders), false),
      },
      now: {
        cashInHand: cashInHand === null ? null : fromMinor(cashInHand),
        toReceive: fromMinor(toReceive),
        overdue: fromMinor(overdue),
        toPay: toPay === null ? null : fromMinor(toPay),
        pipeline: fromMinor(pipeline),
        pipelineDeals: quoted.length,
        /** The pipeline times the win rate of the period: what it is likely to bring. */
        weightedPipeline: winRate === null ? null : fromMinor(Math.round((pipeline * winRate) / 100)),
      },
      target: {
        month: ymOf(today),
        amount: monthTarget ? fromMinor(toMain(decimalToMinor(monthTarget.amount), monthTarget.currency)) : null,
        reached: fromMinor(monthRevenue),
        percent: monthTarget && Number(monthTarget.amount) > 0 ? Math.round((monthRevenue / toMain(decimalToMinor(monthTarget.amount), monthTarget.currency)) * 100) : null,
        canSet: can(user, "expenses.manage"),
      },
      series,
      funnel,
      aging: { notDue: fromMinor(aging.notDue), d30: fromMinor(aging.d30), d60: fromMinor(aging.d60), d90: fromMinor(aging.d90), older: fromMinor(aging.older) },
      topCustomers,
      categories,
      countries,
      channels: [...channels.entries()].map(([channel, c]) => ({ channel, ...c, winRate: pct(c.won, c.received) })).sort((a, b) => b.received - a.received),
      lostReasons: [...lostReasons.entries()]
        .map(([reason, count]) => ({ reason, label: reason === "not_said" ? "No reason given" : LOST_REASON_LABEL[reason as LostReason], count }))
        .sort((a, b) => b.count - a.count),
      people: [...people.entries()]
        .map(([id, p]) => ({
          id: id === "nobody" ? null : id,
          name: id === "nobody" ? "Nobody" : (users.find((u) => u.id === id)?.name ?? "Someone"),
          received: p.received,
          won: p.won,
          lost: p.lost,
          winRate: pct(p.won, p.won + p.lost),
          revenue: fromMinor(p.revenue),
          quoteDays: avg(p.quoteDays),
        }))
        .sort((a, b) => Number(b.revenue) - Number(a.revenue) || b.received - a.received),
      factories: [...factories.values()]
        .map((f) => ({ factory: f.factory, spend: fromMinor(f.spend), orders: f.orders.size }))
        .sort((a, b) => Number(b.spend) - Number(a.spend))
        .slice(0, 10),
      missingRates: [...missing],
    };
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
      where: { month },
      create: { month, amount, currency: sales.currency, updatedById: user.id },
      update: { amount, currency: sales.currency, updatedById: user.id },
    });
    return { month: row.month, amount: row.amount.toFixed(2), currency: row.currency };
  }

  /* ---------------------------------------------------------------- to receive */

  /** What customers still owe, order by order, the most overdue first (Money → To receive). */
  async receivables(user: SessionUser) {
    if (!can(user, "payments.record") && !can(user, "expenses.manage")) throw new ForbiddenError("You do not record money.");
    const today = this.clock.today();
    const orders = await this.prisma.db.order.findMany({
      where: { status: { in: ["open", "closed"] } },
      select: {
        id: true,
        refNo: true,
        currency: true,
        total: true,
        stage: true,
        status: true,
        customer: { select: { id: true, name: true } },
        inquiry: { select: { assignee: { select: { id: true, name: true } } } },
        payments: { where: { voidedAt: null }, select: { amount: true, bankCharges: true, currency: true, paidOn: true } },
        planItems: { orderBy: { sortOrder: "asc" }, select: { id: true, label: true, amount: true, dueOn: true } },
      },
    });
    const rows = orders
      .map((o) => {
        const settled = settle(
          decimalToMinor(o.total),
          o.payments.filter((p) => p.currency === o.currency).map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })),
        );
        if (settled.outstandingMinor <= 0) return null;
        const plan = planStatus(
          o.planItems.map((p) => ({ id: p.id, label: p.label, amountMinor: decimalToMinor(p.amount), dueOn: fromDbDateOrNull(p.dueOn) })),
          settled.settledMinor,
          today,
          7,
        );
        const next = plan.find((p) => p.openMinor > 0) ?? null;
        const late = plan.filter((p) => p.status === "late");
        const lastPaid = o.payments.map((p) => fromDbDate(p.paidOn)).sort().pop() ?? null;
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
          due: fromMinor(settled.outstandingMinor),
          overdue: fromMinor(late.reduce((t, p) => t + p.openMinor, 0)),
          daysLate: late.length && late[0]!.dueOn ? daysBetween(late[0]!.dueOn, today) : 0,
          next: next && { label: next.label, open: fromMinor(next.openMinor), dueOn: next.dueOn, status: next.status },
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
    return { rows, totals: [...totals.entries()].map(([currency, t]) => ({ currency, due: fromMinor(t.due), overdue: fromMinor(t.overdue) })) };
  }
}
