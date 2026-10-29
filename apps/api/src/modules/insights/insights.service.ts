import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull } from "@kebo/database";
import { fromMinor, orderProfit, roundHalfAway, settle, type Minor } from "@kebo/money";
import { can, LOST_REASON_LABEL, planStatus, type InquiryChannel, type InquiryStage, type LostReason } from "@kebo/shared";
import { addDays, daysBetween, ForbiddenError, startOfDayIn, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import { ReadCache } from "../../common/cache/read-cache";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { CashService } from "../money/cash.service";
import { MoneyService } from "../money/money.service";
import { ordersWithMoneyDue } from "../money/due";
import { basisOfOrders, convert, costingsOf, countedExpenses, MainMoney } from "../money/order-money";

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

/** An order as Insights reads it: flat, with its own rate to the main currency. */
type OrderRow = {
  id: string;
  currency: string;
  mainCurrency: string | null;
  mainRate: string | null;
  totalMinor: number;
  orderedOn: ISODate;
  shipBy: ISODate | null;
  shippedOn: ISODate | null;
  customerId: string;
  customerName: string;
  country: string;
  category: string;
  channel: string;
  assigneeId: string | null;
};
/** A deal as Insights reads it, with the day its first quotation went out. */
type DealRow = {
  id: string;
  createdOn: ISODate;
  closedOn: ISODate | null;
  stage: InquiryStage;
  lostReason: string | null;
  channel: InquiryChannel;
  category: string;
  assigneeId: string | null;
  firstSent: ISODate | null;
};

type Figures = {
  revenue: number;
  /** Revenue whose lines have a cost: gross profit is worked out on it alone. */
  costedRevenue: number;
  /** Goods and the costs to reach the basis sold on. */
  goodsCost: number;
  expenses: number;
  /** Taken by banks from customers' payments. */
  bankCharges: number;
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
  costedRevenue: 0,
  goodsCost: 0,
  expenses: 0,
  bankCharges: 0,
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
/** Gross profit: the revenue with a cost less that cost (revenue without a cost is never profit). */
const gross = (f: Figures) => f.costedRevenue - f.goodsCost;
/** Profit after expenses and bank charges. */
const net = (f: Figures) => gross(f) - f.expenses - f.bankCharges;
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((t, x) => t + x, 0) / xs.length) * 10) / 10 : null);
/** part ÷ whole in %, one decimal, half away from zero (−6.25 → −6.3). */
const pct = (part: number, whole: number) => (whole > 0 ? roundHalfAway((part / whole) * 1000) / 10 : null);

/**
 * The numbers behind Insights and Home, for any period, against the period
 * before: sales, profit, cash, the funnel, customers, countries, channels,
 * people and factories, what customers owe by age, and the monthly target.
 * Amounts are in the main currency (orders and their payments at the rate
 * stored on each order; expenses and factory payments at the rates used when
 * paid; quotations and targets at today's Settings rates).
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly cash: CashService,
    private readonly money: MoneyService,
    private readonly cache: ReadCache,
    private readonly limits: LimitsService,
  ) {}

  private assert(user: SessionUser) {
    if (!can(user, "reports.view")) throw new ForbiddenError("Only managers can see insights.");
  }

  /** The same answer for everyone with the same permissions, shared while nothing changes (ReadCache). */
  async overview(user: SessionUser, q: { from?: ISODate; to?: ISODate }) {
    this.assert(user);
    // Expenses are a plan feature: without it, no expenses and no profit after them.
    const expensesOn = await this.limits.allows("expenses");
    const cashBookOn = await this.limits.allows("cash_book");
    const key = `insights:${q.from ?? ""}:${q.to ?? ""}:${this.clock.today()}:${[...user.permissions].sort().join(",")}:${expensesOn}:${cashBookOn}`;
    return this.cache.get(key, () => this.computeOverview(user, q, expensesOn, cashBookOn));
  }

  private async computeOverview(user: SessionUser, q: { from?: ISODate; to?: ISODate }, expensesOn: boolean, cashBookOn: boolean) {
    const today = this.clock.today();
    const to = q.to && q.to < today ? q.to : today;
    const from = q.from && q.from <= to ? q.from : `${ymOf(to)}-01`;
    const prev = previousPeriod(from, to);
    const seeMoney = can(user, "expenses.manage");
    const seeExpenses = seeMoney && expensesOn;
    const { sales } = await this.settings.get();
    const main = sales.currency;
    const fx = new MainMoney(main, sales.exchangeRates);
    const toMain = (minor: Minor, currency: string) => fx.live(minor, currency);
    const tz = this.clock.timeZone;

    // The 12 months up to the end of the period (or every month of a longer period), and the same months a year before.
    const seriesMonths = monthsList(ymOf(from) < ymOf(addMonths(to, -11)) ? ymOf(from) : ymOf(addMonths(to, -11)), ymOf(to));
    const loadFrom = [prev.from, `${ymOf(addMonths(`${seriesMonths[0]}-01`, -12))}-01`].sort()[0]!;

    const [orders, expenses, payments, factoryPaid, deals, revisions, firstOrders, targets] = await Promise.all([
      // Flat rows from the database: years of orders stay quick. Their costing is read just after.
      this.prisma.db.$queryRaw<OrderRow[]>`
        select o.id, o.currency, o.main_currency as "mainCurrency", o.main_rate::text as "mainRate", (o.total * 100)::float8 as "totalMinor",
               to_char(o.ordered_on, 'YYYY-MM-DD') as "orderedOn", to_char(o.ship_by, 'YYYY-MM-DD') as "shipBy", to_char(o.shipped_on, 'YYYY-MM-DD') as "shippedOn",
               o.customer_id as "customerId", c.name as "customerName", c.country, i.category, i.channel::text as channel, i.assignee_id as "assigneeId"
        from orders o
        join customers c on c.id = o.customer_id
        join inquiries i on i.id = o.inquiry_id
        where o.status <> 'cancelled' and o.ordered_on between ${loadFrom}::date and ${to}::date`,
      // Amounts in minor units and days as text straight from the database (no Decimal or Date objects to build).
      seeExpenses
        ? this.prisma.db.$queryRaw<{ id: string; orderId: string | null; category: string; on: ISODate; minor: number; rate: number }[]>`
            select id, order_id as "orderId", category, to_char(spent_on, 'YYYY-MM-DD') as "on", (amount * 100)::float8 as minor, rate::float8 as rate
            from expenses where voided_at is null and spent_on between ${loadFrom}::date and ${to}::date`
        : Promise.resolve([]),
      // What arrived (bank charges apart), at the order's own rate.
      this.prisma.db.$queryRaw<
        {
          on: ISODate;
          minor: number;
          charges: number;
          currency: string;
          orderCurrency: string;
          mainCurrency: string | null;
          mainRate: string | null;
        }[]
      >`
        select to_char(p.paid_on, 'YYYY-MM-DD') as "on", (p.amount * 100)::float8 as minor, (p.bank_charges * 100)::float8 as charges, p.currency,
               o.currency as "orderCurrency", o.main_currency as "mainCurrency", o.main_rate::text as "mainRate"
        from payments p join orders o on o.id = p.order_id
        where p.voided_at is null and p.paid_on between ${loadFrom}::date and ${to}::date`,
      seeMoney
        ? this.prisma.db.$queryRaw<
            { on: ISODate; minor: number; rate: number; currency: string; mainCurrency: string | null; mainRate: string | null }[]
          >`
            select to_char(fp.paid_on, 'YYYY-MM-DD') as "on", (fp.amount * 100)::float8 as minor, fp.rate::float8 as rate,
                   o.currency, o.main_currency as "mainCurrency", o.main_rate::text as "mainRate"
            from factory_payments fp join orders o on o.id = fp.order_id
            where fp.voided_at is null and fp.paid_on between ${loadFrom}::date and ${to}::date`
        : Promise.resolve([]),
      // Deals received or closed in the span, with the day their first quotation went out. Days are the
      // company's (APP_TIME_ZONE), as in Reports: a deal at 05:00 on 1 November in Shanghai is November's.
      this.prisma.db.$queryRaw<DealRow[]>`
        select i.id, to_char(i.created_at at time zone ${tz}, 'YYYY-MM-DD') as "createdOn", to_char(i.closed_at at time zone ${tz}, 'YYYY-MM-DD') as "closedOn",
               i.stage::text as stage, i.lost_reason::text as "lostReason",
               i.channel::text as channel, i.category, i.assignee_id as "assigneeId",
               (select to_char(min(r.sent_on), 'YYYY-MM-DD') from quotations q join quotation_revisions r on r.quotation_id = q.id
                 where q.inquiry_id = i.id and r.deleted_at is null and r.sent_on is not null) as "firstSent"
        from inquiries i
        where i.deleted_at is null
          and ((i.created_at >= ${startOfDayIn(loadFrom, tz)} and i.created_at < ${startOfDayIn(addDays(to, 1), tz)})
            or (i.closed_at >= ${startOfDayIn(loadFrom, tz)} and i.closed_at < ${startOfDayIn(addDays(to, 1), tz)}))`,
      this.prisma.db.$queryRaw<{ on: ISODate; minor: number; currency: string }[]>`
        select to_char(sent_on, 'YYYY-MM-DD') as "on", (total * 100)::float8 as minor, currency
        from quotation_revisions where deleted_at is null and status <> 'draft' and sent_on between ${loadFrom}::date and ${to}::date`,
      this.prisma.db.order.groupBy({ by: ["customerId"], where: { status: { not: "cancelled" } }, _min: { orderedOn: true } }),
      this.prisma.db.salesTarget.findMany({ where: { month: { in: seriesMonths } } }),
    ]);
    const firstOrder = new Map(firstOrders.map((f) => [f.customerId, fromDbDate(f._min.orderedOn!)]));
    const inRange = (d: ISODate, r: { from: ISODate; to: ISODate }) => d >= r.from && d <= r.to;

    // Per order, once, in the main currency at its own rate: value, the part with a cost, and that cost
    // (goods and the costs to reach the basis it was sold on).
    const costings = await costingsOf(
      this.prisma.db,
      orders.map((o) => ({ id: o.id, totalMinor: Math.round(o.totalMinor) })),
    );
    const orderMoney = orders.map((o) => {
      const c = costings.get(o.id)!;
      const profit = orderProfit({ ...c, receivedMinor: 0, factoryPaidMinor: 0, expensesMinor: 0 });
      return {
        o,
        on: o.orderedOn,
        revenue: fx.order(c.revenueMinor, o),
        costedRevenue: fx.order(c.costedRevenueMinor, o),
        cost: fx.order(c.costedRevenueMinor - profit.earnedMinor, o),
      };
    });
    // Freight and the like paid on an order pay for its planned costs to reach the basis first (counted there once).
    const basis = await basisOfOrders(
      this.prisma.db,
      expenses.map((e) => e.orderId).filter((id): id is string => !!id),
      fx,
    );
    const counted = countedExpenses(
      expenses.map((e) => ({ id: e.id, orderId: e.orderId, category: e.category, spentOn: e.on, mainMinor: convert(e.minor, e.rate) })),
      basis,
    );

    // Every record once as a dated event that adds to the figures (dates turned into ISO once),
    // so a period, the one before and each month of the series are cheap to add up.
    type Event = { on: ISODate; add: (f: Figures) => void };
    const events: Event[] = [];
    for (const x of orderMoney) {
      const first = firstOrder.get(x.o.customerId);
      events.push({
        on: x.on,
        add: (f) => {
          f.revenue += x.revenue;
          f.costedRevenue += x.costedRevenue;
          f.goodsCost += x.cost;
          f.orders += 1;
          if (first === x.on) f.newCustomers += 1;
          if (first && first < x.on) f.repeatOrders += 1;
        },
      });
      const shipped = x.o.shippedOn;
      const by = x.o.shipBy;
      if (shipped && by)
        events.push({
          on: shipped,
          add: (f) => {
            f.shippedWithDate += 1;
            if (shipped <= by) f.shippedOnTime += 1;
          },
        });
    }
    for (const e of expenses) {
      const v = convert(e.minor, e.rate);
      const cost = counted.get(e.id) ?? v;
      events.push({
        on: e.on,
        add: (f) => {
          // Money out is all of it; as a cost, only what is not already in the order's planned costs.
          f.cashOut += v;
          f.expenses += cost;
        },
      });
    }
    for (const p of payments) {
      const order = { currency: p.orderCurrency, mainCurrency: p.mainCurrency, mainRate: p.mainRate };
      const same = p.currency === p.orderCurrency;
      const v = same ? fx.order(Math.round(p.minor), order) : toMain(Math.round(p.minor), p.currency);
      const charges = same ? fx.order(Math.round(p.charges), order) : toMain(Math.round(p.charges), p.currency);
      events.push({
        on: p.on,
        add: (f) => {
          f.cashIn += v;
          f.bankCharges += charges;
        },
      });
    }
    for (const p of factoryPaid) {
      const v = fx.order(convert(p.minor, p.rate), p);
      events.push({ on: p.on, add: (f) => (f.cashOut += v) });
    }
    for (const d of deals) {
      const created = d.createdOn;
      events.push({ on: created, add: (f) => (f.received += 1) });
      const closed = d.closedOn;
      if (closed && d.stage === "won") {
        const days = daysBetween(created, closed);
        events.push({
          on: closed,
          add: (f) => {
            f.won += 1;
            f.closeDays.push(days);
          },
        });
      } else if (closed && d.stage === "lost") events.push({ on: closed, add: (f) => (f.lost += 1) });
      const sent = d.firstSent;
      if (sent) {
        const days = daysBetween(created, sent);
        events.push({ on: sent, add: (f) => f.quoteDays.push(days) });
      }
    }
    for (const q of revisions) {
      const v = toMain(q.minor, q.currency);
      events.push({
        on: q.on,
        add: (f) => {
          f.quotesSent += 1;
          f.quotesValue += v;
        },
      });
    }
    const done = (f: Figures) => f;
    const figuresFor = (r: { from: ISODate; to: ISODate }): Figures => {
      const f = empty();
      for (const e of events) if (inRange(e.on, r)) e.add(f);
      return done(f);
    };
    // Month by month in one pass (the series and the same months a year before).
    const byMonth = new Map<string, Figures>();
    for (const e of events) {
      // A deal received in the period can close after it: the series stops at the period's end.
      if (e.on > to) continue;
      const m = e.on.slice(0, 7);
      let f = byMonth.get(m);
      if (!f) byMonth.set(m, (f = empty()));
      e.add(f);
    }
    for (const f of byMonth.values()) done(f);
    const monthFigures = (m: string) => byMonth.get(m) ?? empty();
    const cur = figuresFor({ from, to });
    const before = figuresFor(prev);

    /* ----- right now: cash, what customers owe (by age), what we owe factories, the pipeline */
    const openOrders = await this.prisma.db.order.findMany({
      where: { status: { in: ["open", "closed"] }, id: { in: await ordersWithMoneyDue(this.prisma) } },
      select: {
        currency: true,
        mainCurrency: true,
        mainRate: true,
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
        o.payments
          .filter((p) => p.currency === o.currency)
          .map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })),
      );
      if (settled.outstandingMinor <= 0) continue;
      toReceive += fx.order(settled.outstandingMinor, o);
      const plan = planStatus(
        o.planItems.map((p) => ({ id: p.id, label: p.label, amountMinor: decimalToMinor(p.amount), dueOn: fromDbDateOrNull(p.dueOn) })),
        settled.settledMinor,
        today,
        0,
      );
      for (const p of plan) {
        if (p.openMinor <= 0) continue;
        const v = fx.order(p.openMinor, o);
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
      // What is in our accounts: the cash book, a plan feature.
      const accounts = cashBookOn ? ((await this.cash.accounts(user)) as { archived: boolean; currency: string; balance?: string }[]) : [];
      cashInHand = !cashBookOn
        ? null
        : accounts
            .filter((a) => !a.archived && a.balance !== undefined)
            .reduce((t, a) => t + toMain(Math.round(Number(a.balance) * 100), a.currency), 0);
      const payables = await this.money.payables(user, false);
      toPay = payables.reduce((t, p) => t + toMain(Math.round(Number(p.toPay) * 100), p.currency), 0);
    }
    const quoted = await this.prisma.db.inquiry.findMany({
      where: { deletedAt: null, stage: "quoted" },
      select: {
        quotation: {
          select: {
            revisions: {
              where: { deletedAt: null, status: "sent" },
              orderBy: { number: "desc" },
              take: 1,
              select: { total: true, currency: true },
            },
          },
        },
      },
    });
    const pipeline = quoted.reduce((t, d) => {
      const r = d.quotation?.revisions[0];
      return t + (r ? toMain(decimalToMinor(r.total), r.currency) : 0);
    }, 0);
    const winRate = pct(cur.won, cur.won + cur.lost);

    /* ----- month by month */
    const series = seriesMonths.map((m) => {
      // Nothing after `to` is loaded, so the month so far is the month's bucket.
      const f = monthFigures(m);
      const ly = monthFigures(ymOf(addMonths(`${m}-01`, -12)));
      const target = targets.find((t) => t.month === m);
      return {
        month: m,
        revenue: fromMinor(f.revenue),
        grossProfit: fromMinor(gross(f)),
        /** Revenue without a cost recorded (left out of profit). */
        uncostedRevenue: fromMinor(f.revenue - f.costedRevenue),
        expenses: seeExpenses ? fromMinor(f.expenses) : null,
        netProfit: seeExpenses ? fromMinor(net(f)) : null,
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
      const m = new Map<K, { revenue: number; costed: number; cost: number; orders: number; customers: Set<string> }>();
      for (const x of inCur) {
        const k = key(x);
        if (k === null) continue;
        const g = m.get(k) ?? { revenue: 0, costed: 0, cost: 0, orders: 0, customers: new Set<string>() };
        g.revenue += x.revenue;
        g.costed += x.costedRevenue;
        g.cost += x.cost;
        g.orders += 1;
        g.customers.add(x.o.customerId);
        m.set(k, g);
      }
      return [...m.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
    };
    const customerNames = new Map(inCur.map((x) => [x.o.customerId, { id: x.o.customerId, name: x.o.customerName, country: x.o.country }]));
    const topCustomers = group((x) => x.o.customerId)
      .slice(0, 10)
      .map(([id, g]) => ({
        customer: customerNames.get(id)!,
        revenue: fromMinor(g.revenue),
        grossProfit: fromMinor(g.costed - g.cost),
        uncostedRevenue: fromMinor(g.revenue - g.costed),
        orders: g.orders,
        isNew: (() => {
          const f = firstOrder.get(id);
          return !!f && inRange(f, { from, to });
        })(),
      }));
    const categories = group((x) => x.o.category)
      .slice(0, 10)
      .map(([category, g]) => ({
        category,
        revenue: fromMinor(g.revenue),
        grossProfit: fromMinor(g.costed - g.cost),
        uncostedRevenue: fromMinor(g.revenue - g.costed),
        orders: g.orders,
      }));
    const countries = group((x) => x.o.country).map(([country, g]) => ({
      country,
      revenue: fromMinor(g.revenue),
      orders: g.orders,
      customers: g.customers.size,
    }));

    const dealsCur = deals.filter((d) => inRange(d.createdOn, { from, to }));
    const closedCur = deals.filter((d) => d.closedOn && inRange(d.closedOn, { from, to }));
    const funnel = {
      received: dealsCur.length,
      quoted: dealsCur.filter((d) => d.firstSent).length,
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
    for (const d of closedCur.filter((x) => x.stage === "lost"))
      lostReasons.set(d.lostReason ?? "not_said", (lostReasons.get(d.lostReason ?? "not_said") ?? 0) + 1);

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
      const sent = d.firstSent;
      if (sent) p.quoteDays.push(daysBetween(d.createdOn, sent));
    }
    for (const d of closedCur) {
      if (d.stage === "won") person(d.assigneeId).won += 1;
      else if (d.stage === "lost") person(d.assigneeId).lost += 1;
    }
    for (const x of inCur) person(x.o.assigneeId).revenue += x.revenue;

    // Who we buy from: the goods cost of the period's orders by the factory frozen on each line (only those
    // orders' lines are read), each line's cost × quantity exactly as multiplyMinor does.
    const factories = new Map<string, { factory: { id: string; name: string }; spend: number; orders: Set<string> }>();
    const curOrder = new Map(inCur.map((x) => [x.o.id, x.o]));
    const spendRows = curOrder.size
      ? await this.prisma.db.$queryRaw<{ orderId: string; id: string; name: string; costMinor: string }[]>`
          select ol.order_id as "orderId", f.id, f.name, sum(round(ol.unit_cost * 100 * ol.quantity))::text as "costMinor"
          from order_lines ol
          join factories f on f.id = ol.factory_id
          where ol.unit_cost is not null and ol.order_id = any(${[...curOrder.keys()]}::uuid[])
          group by 1, 2, 3`
      : [];
    for (const r of spendRows) {
      const g = factories.get(r.id) ?? { factory: { id: r.id, name: r.name }, spend: 0, orders: new Set<string>() };
      g.spend += fx.order(Number(r.costMinor), curOrder.get(r.orderId)!);
      g.orders.add(r.orderId);
      factories.set(r.id, g);
    }

    const monthTarget = targets.find((t) => t.month === ymOf(today));
    const monthRevenue = figuresFor({ from: `${ymOf(today)}-01`, to: today }).revenue;

    /** A figure now and before, with the change in percent (null when there is nothing to compare). */
    const kpi = (now: number | null, then: number | null, money = true) => ({
      value: now === null ? null : money ? fromMinor(now) : now,
      previous: then === null ? null : money ? fromMinor(then) : then,
      change: now === null || then === null || then === 0 ? null : roundHalfAway(((now - then) / Math.abs(then)) * 1000) / 10,
    });

    return {
      range: { from, to },
      previous: prev,
      currency: main,
      seeMoney,
      /** Expenses and profit after them (managers, with the expenses feature). */
      seeExpenses,
      kpis: {
        revenue: kpi(cur.revenue, before.revenue),
        grossProfit: kpi(gross(cur), gross(before)),
        /** Gross profit ÷ the revenue that has a cost. */
        margin: kpi(pct(gross(cur), cur.costedRevenue), pct(gross(before), before.costedRevenue), false),
        netProfit: seeExpenses ? kpi(net(cur), net(before)) : null,
        /** Revenue with no cost recorded: left out of profit and margin, shown apart. */
        uncostedRevenue: kpi(cur.revenue - cur.costedRevenue, before.revenue - before.costedRevenue),
        expenses: seeExpenses ? kpi(cur.expenses, before.expenses) : null,
        cashIn: kpi(cur.cashIn, before.cashIn),
        cashOut: seeMoney ? kpi(cur.cashOut, before.cashOut) : null,
        orders: kpi(cur.orders, before.orders, false),
        avgOrder: kpi(
          cur.orders ? Math.round(cur.revenue / cur.orders) : null,
          before.orders ? Math.round(before.revenue / before.orders) : null,
        ),
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
        percent:
          monthTarget && Number(monthTarget.amount) > 0
            ? Math.round((monthRevenue / toMain(decimalToMinor(monthTarget.amount), monthTarget.currency)) * 100)
            : null,
        canSet: can(user, "expenses.manage"),
      },
      series,
      funnel,
      aging: {
        notDue: fromMinor(aging.notDue),
        d30: fromMinor(aging.d30),
        d60: fromMinor(aging.d60),
        d90: fromMinor(aging.d90),
        older: fromMinor(aging.older),
      },
      topCustomers,
      categories,
      countries,
      channels: [...channels.entries()]
        .map(([channel, c]) => ({ channel, ...c, winRate: pct(c.won, c.received) }))
        .sort((a, b) => b.received - a.received),
      lostReasons: [...lostReasons.entries()]
        .map(([reason, count]) => ({
          reason,
          label: reason === "not_said" ? "No reason given" : LOST_REASON_LABEL[reason as LostReason],
          count,
        }))
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
        .sort((a, b) => Number(b.spend) - Number(a.spend) || a.factory.name.localeCompare(b.factory.name))
        .slice(0, 10),
      missingRates: fx.missingRates,
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
      where: { companyId_month: { companyId: user.companyId, month } },
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
      where: { status: { in: ["open", "closed"] }, id: { in: await ordersWithMoneyDue(this.prisma) } },
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
          o.payments
            .filter((p) => p.currency === o.currency)
            .map((p) => ({ amountMinor: decimalToMinor(p.amount), bankChargesMinor: decimalToMinor(p.bankCharges) })),
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
        const lastPaid =
          o.payments
            .map((p) => fromDbDate(p.paidOn))
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
    return {
      rows,
      totals: [...totals.entries()].map(([currency, t]) => ({ currency, due: fromMinor(t.due), overdue: fromMinor(t.overdue) })),
    };
  }
}
