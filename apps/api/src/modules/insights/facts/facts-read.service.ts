import { Injectable } from "@nestjs/common";
import { Prisma } from "@kebo/database";
import { fromMinor, roundHalfAway, toMinor } from "@kebo/money";
import { can, LOST_REASON_LABEL, type LostReason } from "@kebo/shared";
import { ForbiddenError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../../database/prisma.service";
import { Clock } from "../../../common/time/clock.service";
import { LimitsService } from "../../../common/company/limits.service";
import type { SessionUser } from "../../../common/auth/session-user";
import { convert, MainMoney } from "../../money/order-money";
import { positionsSql } from "../../money/due";
import { factsCtxOf } from "./compute";
import { FactsService } from "./facts.service";

export const PERIODS = ["month", "quarter", "year", "all"] as const;
export type Period = (typeof PERIODS)[number];
export const ORDER_GROUPS = ["company", "customer", "person", "channel", "country", "category"] as const;
export const FACTORY_GROUPS = ["company", "factory"] as const;
export type OrderGroup = (typeof ORDER_GROUPS)[number];
export type FactoryGroup = (typeof FACTORY_GROUPS)[number];

/** Narrowing a read to one customer, person, channel, country, category or factory. */
export interface FactsFilter {
  customerId?: string;
  personId?: string;
  channel?: string;
  country?: string;
  category?: string;
  factoryId?: string;
}

export interface Span {
  from?: ISODate;
  to?: ISODate;
}

const pct = (part: number, whole: number) => (whole > 0 ? roundHalfAway((part / whole) * 1000) / 10 : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const amount = (v: unknown) => (v === null || v === undefined ? "0.00" : fromMinor(toMinor(String(v))));
const days = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

/** The period a date falls in: "2026-11", "2026-Q4", "2026", or "all". */
const periodSql = (period: Period, column: string) => {
  const c = Prisma.raw(column);
  switch (period) {
    case "month":
      return Prisma.sql`to_char(${c}, 'YYYY-MM')`;
    case "quarter":
      return Prisma.sql`to_char(${c}, 'YYYY-"Q"Q')`;
    case "year":
      return Prisma.sql`to_char(${c}, 'YYYY')`;
    default:
      return Prisma.sql`'all'`;
  }
};

const groupSql = (by: OrderGroup | FactoryGroup) => {
  switch (by) {
    case "customer":
      return Prisma.sql`f.customer_id::text`;
    case "person":
      return Prisma.sql`coalesce(f.handled_by::text, 'nobody')`;
    case "channel":
      return Prisma.sql`f.channel::text`;
    case "country":
      return Prisma.sql`f.country::text`;
    case "category":
      return Prisma.sql`f.category`;
    case "factory":
      return Prisma.sql`f.factory_id::text`;
    default:
      return Prisma.sql`'company'`;
  }
};

/** What is still open on `open_parts`, by how late it is on `today` (main currency, numeric). */
const openSql = (today: ISODate, from: number | null, to: number | null) =>
  Prisma.sql`(select coalesce(sum((p ->> 'open')::numeric), 0) from jsonb_array_elements(f.open_parts) p
              where ${
                from === null
                  ? Prisma.sql`(p ->> 'dueOn' is null or (p ->> 'dueOn')::date >= ${today}::date)`
                  : Prisma.sql`(p ->> 'dueOn')::date <= ${today}::date - ${from}::int ${to === null ? Prisma.empty : Prisma.sql`and (p ->> 'dueOn')::date > ${today}::date - ${to}::int - 1`}`
              })`;

/**
 * Insights read from its three calculated tables (order_facts, inquiry_facts, factory_order_facts) and,
 * for money over time, straight from payments, factory payments and expenses (one row per event, indexed
 * by date). Every figure is a sum of rows the shared rules wrote: one formula, here only added up.
 * The queue of changes is worked off first, so a read always includes every change made before it.
 * Money (costs, expected profit, expenses, factory money, cash out) only for people who may see money
 * (expenses.manage), as Insights shows it; expenses only with the expenses module.
 */
@Injectable()
export class FactsReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facts: FactsService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
  ) {}

  /**
   * Work the queue off and read the settings. `trusted`: the caller (Home, Reports, Leaks, targets) already
   * checked who may see its figures, with its own permission as before; Insights' own endpoints never pass it.
   */
  private async open(user: SessionUser, trusted = false) {
    if (!trusted && !can(user, "reports.view")) throw new ForbiddenError("Only managers can see insights.");
    await this.facts.drain(5);
    const seeMoney = can(user, "expenses.manage");
    const expensesOn = await this.limits.allows("expenses");
    const ctx = await factsCtxOf(this.prisma.db, this.clock.timeZone, this.clock.today(), expensesOn);
    return { seeMoney, seeExpenses: seeMoney && expensesOn, today: this.clock.today(), currency: ctx.fx.main, ctx };
  }

  private span(q: Span, column: string) {
    const c = Prisma.raw(column);
    return Prisma.sql`${q.from ? Prisma.sql`and ${c} >= ${q.from}::date` : Prisma.empty} ${q.to ? Prisma.sql`and ${c} <= ${q.to}::date` : Prisma.empty}`;
  }

  private filter(f: FactsFilter, table: "order" | "inquiry" | "factory") {
    const parts: Prisma.Sql[] = [];
    if (f.customerId) parts.push(table === "factory" ? Prisma.sql`exists (select 1 from orders o where o.id = f.order_id and o.customer_id = ${f.customerId}::uuid)` : Prisma.sql`f.customer_id = ${f.customerId}::uuid`);
    if (table !== "factory") {
      if (f.personId) parts.push(f.personId === "nobody" ? Prisma.sql`f.handled_by is null` : Prisma.sql`f.handled_by = ${f.personId}::uuid`);
      if (f.channel) parts.push(Prisma.sql`f.channel::text = ${f.channel}`);
      if (f.country) parts.push(Prisma.sql`f.country = ${f.country}`);
      if (f.category) parts.push(Prisma.sql`f.category = ${f.category}`);
    }
    if (f.factoryId)
      parts.push(
        table === "order"
          ? Prisma.sql`exists (select 1 from factory_order_facts x where x.order_id = f.order_id and x.factory_id = ${f.factoryId}::uuid)`
          : table === "factory"
            ? Prisma.sql`f.factory_id = ${f.factoryId}::uuid`
            : Prisma.sql`exists (select 1 from factory_quotes x where x.inquiry_id = f.inquiry_id and x.factory_id = ${f.factoryId}::uuid and x.deleted_at is null)`,
      );
    return parts.length ? Prisma.sql`and ${Prisma.join(parts, " and ")}` : Prisma.empty;
  }

  /** Names for the keys of a grouping (customers, people, factories); the others are their own label. */
  private async labels(by: string, keys: string[]): Promise<Map<string, string>> {
    const ids = keys.filter((k) => /^[0-9a-f-]{36}$/.test(k));
    if (!ids.length) return new Map(by === "person" ? [["nobody", "Nobody"]] : []);
    const db = this.prisma.db;
    const rows =
      by === "customer"
        ? await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : by === "person"
          ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
          : by === "factory"
            ? await db.factory.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
            : [];
    return new Map([...rows.map((r) => [r.id, r.name] as [string, string]), ["nobody", "Nobody"]]);
  }

  /** Customers' countries, for a grouping by customer. */
  private async countries(keys: string[]): Promise<Map<string, string>> {
    const ids = keys.filter((k) => /^[0-9a-f-]{36}$/.test(k));
    if (!ids.length) return new Map();
    const rows = await this.prisma.db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, country: true } });
    return new Map(rows.map((r) => [r.id, r.country]));
  }

  /**
   * Orders (not cancelled) by when they were ordered, added up per period × group: sales, profit, margin, what
   * came in and is still due (overdue on today), shipping on time and speed, paying in full and on time.
   */
  async orderGroups(user: SessionUser, q: Span & FactsFilter & { period: Period; by: OrderGroup }, trusted = false) {
    const { seeMoney, seeExpenses, today, currency } = await this.open(user, trusted);
    const rows = await this.prisma.db.$queryRaw<Record<string, unknown>[]>`
      select ${periodSql(q.period, "f.ordered_on")} as period, ${groupSql(q.by)} as key,
             count(*)::int as orders, count(distinct f.customer_id)::int as customers,
             sum(f.total_main)::text as sales, sum(f.costed_main)::text as costed, sum(f.cost_main)::text as cost,
             sum(f.profit_quote_main)::text as "profitQuote", sum(f.profit_expected_main)::text as "profitExpected",
             sum(f.expenses_main)::text as expenses, sum(f.costs_over_plan_main)::text as "costsOverPlan",
             coalesce(sum(f.profit_expected_main) filter (where f.shipped_on is not null and f.paid_in_full_on is not null), 0)::text as "profitDone",
             count(*) filter (where f.costs_over_plan_main > 0)::int as "ordersOverPlan",
             sum(f.received_main)::text as received, sum(f.due_main)::text as due,
             sum(${openSql(today, 1, null)})::text as overdue,
             count(*) filter (where f.on_time is not null)::int as "shippedWithDate", count(*) filter (where f.on_time)::int as "shippedOnTime",
             avg(f.days_to_ship)::float8 as "daysToShip", avg(f.days_quote_to_order)::float8 as "daysQuoteToOrder",
             count(*) filter (where f.paid_in_full_on is not null)::int as "paidInFull", count(*) filter (where f.paid_on_time)::int as "paidOnTime",
             avg(f.paid_in_full_on - f.ordered_on) filter (where f.paid_in_full_on is not null)::float8 as "daysToPay",
             to_char(min(f.ordered_on), 'YYYY-MM-DD') as "firstOrderedOn", to_char(max(f.ordered_on), 'YYYY-MM-DD') as "lastOrderedOn",
             count(*) filter (where not f.rate_known)::int as "missingRate"
      from order_facts f
      where f.status <> 'cancelled' ${this.span(q, "f.ordered_on")} ${this.filter(q, "order")}
      group by 1, 2 order by 1, 2`;
    const names = await this.labels(q.by, rows.map((r) => String(r.key)));
    const countries = q.by === "customer" ? await this.countries(rows.map((r) => String(r.key))) : null;
    const missing = await this.prisma.db.$queryRaw<{ currency: string }[]>`
      select distinct f.currency from order_facts f
      where f.status <> 'cancelled' and not f.rate_known ${this.span(q, "f.ordered_on")} ${this.filter(q, "order")} order by 1`;
    return {
      currency,
      seeMoney,
      seeExpenses,
      period: q.period,
      by: q.by,
      /** Currencies of these orders with no rate to the main currency (their money counts 0). */
      missingRates: missing.map((m) => m.currency),
      rows: rows.map((r) => {
        const costed = toMinor(String(r.costed));
        return {
          period: r.period as string,
          key: r.key as string,
          label: names.get(String(r.key)) ?? String(r.key),
          /** By customer: the customer's country. */
          country: countries ? (countries.get(String(r.key)) ?? null) : undefined,
          orders: r.orders as number,
          customers: r.customers as number,
          sales: amount(r.sales),
          /** Sales whose lines have a cost: profit and margin are on it alone. */
          costed: amount(r.costed),
          /** Profit on the quote (gross) and its margin. */
          profitQuote: amount(r.profitQuote),
          marginQuote: pct(toMinor(String(r.profitQuote)), costed),
          cost: seeMoney ? amount(r.cost) : null,
          profitExpected: seeExpenses ? amount(r.profitExpected) : null,
          margin: seeExpenses ? pct(toMinor(String(r.profitExpected)), costed) : null,
          expenses: seeExpenses ? amount(r.expenses) : null,
          costsOverPlan: seeExpenses ? amount(r.costsOverPlan) : null,
          ordersOverPlan: seeExpenses ? (r.ordersOverPlan as number) : null,
          /** Expected profit on the orders already shipped and paid in full: profit made so far. */
          profitDone: seeExpenses ? amount(r.profitDone) : null,
          received: amount(r.received),
          due: amount(r.due),
          overdue: amount(r.overdue),
          shipped: { withDate: r.shippedWithDate as number, onTime: r.shippedOnTime as number, percent: pct(r.shippedOnTime as number, r.shippedWithDate as number) },
          daysToShip: days(r.daysToShip),
          daysQuoteToOrder: days(r.daysQuoteToOrder),
          paid: { inFull: r.paidInFull as number, onTime: r.paidOnTime as number, percent: pct(r.paidOnTime as number, r.paidInFull as number) },
          /** From the order date to paid in full, on average. */
          daysToPay: days(r.daysToPay),
          firstOrderedOn: r.firstOrderedOn as ISODate,
          lastOrderedOn: r.lastOrderedOn as ISODate,
          /** Orders without a rate to the main currency (their money counts 0). */
          missingRate: r.missingRate as number,
        };
      }),
    };
  }

  /**
   * Inquiries per period × group, dated by when they came in (`on` = received: the funnel's cohort) or
   * were decided (`on` = closed): in, got prices, quoted (and worth), won (and the orders' value), lost, open,
   * speed to the first quote and to the decision.
   */
  async inquiryGroups(user: SessionUser, q: Span & FactsFilter & { period: Period; by: OrderGroup; on?: "received" | "closed" }, trusted = false) {
    const { currency } = await this.open(user, trusted);
    const column = q.on === "closed" ? "f.closed_on" : "f.received_on";
    const rows = await this.prisma.db.$queryRaw<Record<string, unknown>[]>`
      select ${periodSql(q.period, column)} as period, ${groupSql(q.by)} as key,
             count(*)::int as inquiries, count(*) filter (where f.got_prices)::int as "gotPrices",
             count(*) filter (where f.first_quote_on is not null)::int as quoted, coalesce(sum(f.quoted_value_main), 0)::text as "quotedValue",
             count(*) filter (where f.outcome = 'won')::int as won, count(*) filter (where f.outcome = 'lost')::int as lost,
             count(*) filter (where f.outcome = 'open')::int as open,
             coalesce(sum(o.total_main) filter (where f.outcome = 'won'), 0)::text as "wonValue",
             avg(f.days_to_first_quote)::float8 as "daysToFirstQuote",
             percentile_cont(0.5) within group (order by f.days_to_first_quote) as "medianDaysToFirstQuote",
             avg(f.days_to_close) filter (where f.outcome = 'won')::float8 as "daysToWin",
             avg(f.days_to_close) filter (where f.outcome = 'lost')::float8 as "daysToLose",
             percentile_cont(0.5) within group (order by f.days_to_close) as "medianDaysToClose"
      from inquiry_facts f
      left join order_facts o on o.inquiry_id = f.inquiry_id and o.status <> 'cancelled'
      where ${Prisma.raw(column)} is not null ${this.span(q, column)} ${this.filter(q, "inquiry")}
      group by 1, 2 order by 1, 2`;
    const names = await this.labels(q.by, rows.map((r) => String(r.key)));
    return {
      currency,
      period: q.period,
      by: q.by,
      on: q.on ?? "received",
      rows: rows.map((r) => ({
        period: r.period as string,
        key: r.key as string,
        label: names.get(String(r.key)) ?? String(r.key),
        inquiries: r.inquiries as number,
        gotPrices: r.gotPrices as number,
        quoted: r.quoted as number,
        /** The quotations that went out, each at its accepted option or its lowest (today's rates). */
        quotedValue: amount(r.quotedValue),
        won: r.won as number,
        lost: r.lost as number,
        open: r.open as number,
        /** Won ÷ decided. */
        winRate: pct(r.won as number, (r.won as number) + (r.lost as number)),
        /** What the won ones were ordered for (main currency at each order's rate). */
        wonValue: amount(r.wonValue),
        daysToFirstQuote: days(r.daysToFirstQuote),
        medianDaysToFirstQuote: days(r.medianDaysToFirstQuote),
        daysToWin: days(r.daysToWin),
        daysToLose: days(r.daysToLose),
        medianDaysToClose: days(r.medianDaysToClose),
      })),
    };
  }

  /** The funnel for a span (inquiries that came in then): the stages, why we lose, and the medians. */
  async funnel(user: SessionUser, q: Span & FactsFilter, trusted = false) {
    const totals = (await this.inquiryGroups(user, { ...q, period: "all", by: "company" }, trusted)).rows[0];
    const reasons = await this.prisma.db.$queryRaw<{ reason: string | null; count: number }[]>`
      select f.lost_reason::text as reason, count(*)::int as count from inquiry_facts f
      where f.outcome = 'lost' ${this.span(q, "f.received_on")} ${this.filter(q, "inquiry")}
      group by 1 order by 2 desc, 1`;
    return {
      inquiries: totals?.inquiries ?? 0,
      gotPrices: totals?.gotPrices ?? 0,
      quoted: totals?.quoted ?? 0,
      quotedValue: totals?.quotedValue ?? "0.00",
      won: totals?.won ?? 0,
      wonValue: totals?.wonValue ?? "0.00",
      lost: totals?.lost ?? 0,
      open: totals?.open ?? 0,
      winRate: totals?.winRate ?? null,
      medianDaysToFirstQuote: totals?.medianDaysToFirstQuote ?? null,
      medianDaysToClose: totals?.medianDaysToClose ?? null,
      lostReasons: reasons.map((r) => ({
        reason: r.reason ?? "not_said",
        label: r.reason ? LOST_REASON_LABEL[r.reason as LostReason] : "No reason given",
        count: r.count,
      })),
    };
  }

  /**
   * Factories per period × group (orders dated by when they were ordered): orders, spend, paid and still to
   * pay (main currency, and per own currency), ready on time and days late, offers won of offers sent, claims.
   */
  async factoryGroups(user: SessionUser, q: Span & { factoryId?: string; period: Period; by: FactoryGroup }) {
    const { seeMoney, currency } = await this.open(user);
    const rows = await this.prisma.db.$queryRaw<Record<string, unknown>[]>`
      select ${periodSql(q.period, "f.ordered_on")} as period, ${groupSql(q.by)} as key,
             count(distinct f.order_id)::int as orders, sum(f.owed_main)::text as spend, sum(f.paid_main)::text as paid, sum(f.to_pay_main)::text as "toPay",
             count(*) filter (where f.on_time is not null)::int as "readyKnown", count(*) filter (where f.on_time)::int as "readyOnTime",
             avg(f.days_late)::float8 as "daysLate", avg(f.days_late) filter (where f.days_late > 0)::float8 as "daysLateWhenLate",
             count(*) filter (where f.offer_won)::int as "offersWon", coalesce(sum(f.claims), 0)::int as claims,
             to_char(min(f.ordered_on), 'YYYY-MM-DD') as "firstOrderedOn", to_char(max(f.ordered_on), 'YYYY-MM-DD') as "lastOrderedOn"
      from factory_order_facts f
      where f.status <> 'cancelled' ${this.span(q, "f.ordered_on")} ${this.filter(q, "factory")}
      group by 1, 2 order by 1, 2`;
    const own = await this.prisma.db.$queryRaw<{ period: string; key: string; currency: string; owed: string; toPay: string }[]>`
      select ${periodSql(q.period, "f.ordered_on")} as period, ${groupSql(q.by)} as key, f.currency, sum(f.owed)::text as owed, sum(f.to_pay)::text as "toPay"
      from factory_order_facts f
      where f.status <> 'cancelled' and f.currency is not null ${this.span(q, "f.ordered_on")} ${this.filter(q, "factory")}
      group by 1, 2, 3 order by 1, 2, 3`;
    // Offers sent, straight from the offers (dated by when they came in).
    const sent = await this.prisma.db.$queryRaw<{ period: string; key: string; n: number }[]>`
      select ${periodSql(q.period, "f.received_on")} as period, ${groupSql(q.by)} as key, count(*)::int as n
      from factory_quotes f
      where f.deleted_at is null ${this.span(q, "f.received_on")} ${q.factoryId ? Prisma.sql`and f.factory_id = ${q.factoryId}::uuid` : Prisma.empty}
      group by 1, 2`;
    const keys = new Set([...rows.map((r) => `${r.period}|${r.key}`), ...sent.map((r) => `${r.period}|${r.key}`)]);
    const names = await this.labels(q.by, [...keys].map((k) => k.split("|")[1]!));
    return {
      currency,
      seeMoney,
      period: q.period,
      by: q.by,
      rows: [...keys].sort().map((k) => {
        const [period, key] = k.split("|") as [string, string];
        const r = rows.find((x) => x.period === period && x.key === key) ?? {};
        const offersSent = sent.find((x) => x.period === period && x.key === key)?.n ?? 0;
        return {
          period,
          key,
          label: names.get(key) ?? key,
          orders: (r.orders as number) ?? 0,
          spend: seeMoney ? amount(r.spend) : null,
          paid: seeMoney ? amount(r.paid) : null,
          toPay: seeMoney ? amount(r.toPay) : null,
          /** In the factories' own currencies. */
          own: seeMoney ? own.filter((x) => x.period === period && x.key === key).map((x) => ({ currency: x.currency, owed: amount(x.owed), toPay: amount(x.toPay) })) : null,
          ready: { known: (r.readyKnown as number) ?? 0, onTime: (r.readyOnTime as number) ?? 0, percent: pct((r.readyOnTime as number) ?? 0, (r.readyKnown as number) ?? 0) },
          daysLate: days(r.daysLate),
          daysLateWhenLate: days(r.daysLateWhenLate),
          offersSent,
          offersWon: (r.offersWon as number) ?? 0,
          claims: (r.claims as number) ?? 0,
          firstOrderedOn: (r.firstOrderedOn as ISODate) ?? null,
          lastOrderedOn: (r.lastOrderedOn as ISODate) ?? null,
        };
      }),
    };
  }

  /**
   * What customers owe us (receivable) or we owe factories (payable) by how late it is today, from the open
   * parts of each plan: not due yet (or undated), 1–30, 31–60, 61–90 and over 90 days. `bucket` lists the orders.
   */
  async aging(
    user: SessionUser,
    q: { side: "receivable" | "payable"; bucket?: "notDue" | "d30" | "d60" | "d90" | "older"; customerId?: string; factoryId?: string },
    trusted = false,
  ) {
    const { seeMoney, today, currency } = await this.open(user, trusted);
    if (q.side === "payable" && !seeMoney) throw new ForbiddenError("Only people who may see money see what we owe factories.");
    const table = Prisma.raw(q.side === "receivable" ? "order_facts" : "factory_order_facts");
    const scope =
      q.side === "receivable"
        ? Prisma.sql`f.status <> 'cancelled' ${q.customerId ? Prisma.sql`and f.customer_id = ${q.customerId}::uuid` : Prisma.empty}`
        : Prisma.sql`f.status <> 'cancelled' ${q.factoryId ? Prisma.sql`and f.factory_id = ${q.factoryId}::uuid` : Prisma.empty}`;
    const buckets = {
      notDue: openSql(today, null, null),
      d30: openSql(today, 1, 30),
      d60: openSql(today, 31, 60),
      d90: openSql(today, 61, 90),
      older: openSql(today, 91, null),
    };
    const [t] = await this.prisma.db.$queryRaw<Record<string, string>[]>`
      select ${Prisma.join(Object.entries(buckets).map(([k, s]) => Prisma.sql`coalesce(sum(${s}), 0)::text as ${Prisma.raw(`"${k}"`)}`))},
             count(*) filter (where jsonb_array_length(f.open_parts) > 0)::int as "rows"
      from ${table} f where ${scope}`;
    const total = Object.keys(buckets).reduce((s, k) => s + toMinor(t![k]!), 0);
    let rows: { orderId: string; refNo: string; customer: string; factory: string | null; amount: string }[] | null = null;
    if (q.bucket) {
      const list = await this.prisma.db.$queryRaw<{ orderId: string; refNo: string; customer: string; factory: string | null; amount: string }[]>`
        select f.order_id as "orderId", o.ref_no as "refNo", c.name as customer,
               ${q.side === "payable" ? Prisma.sql`(select x.name from factories x where x.id = f.factory_id)` : Prisma.sql`null::text`} as factory,
               ${buckets[q.bucket]}::text as amount
        from ${table} f join orders o on o.id = f.order_id join customers c on c.id = o.customer_id
        where ${scope} and ${buckets[q.bucket]} > 0
        order by ${buckets[q.bucket]} desc, o.ref_no limit 200`;
      rows = list.map((r) => ({ ...r, amount: amount(r.amount) }));
    }
    return {
      side: q.side,
      currency,
      today,
      total: fromMinor(total),
      notDue: amount(t!.notDue),
      d30: amount(t!.d30),
      d60: amount(t!.d60),
      d90: amount(t!.d90),
      older: amount(t!.older),
      /** Over 60 days (the design's last bucket). */
      over60: fromMinor(toMinor(t!.d90!) + toMinor(t!.older!)),
      orders: rows,
    };
  }

  /**
   * Money in and out by month, straight from the money itself: what customers paid (at each order's rate),
   * what we paid factories and every expense (each at its own rate), and the expenses by kind.
   */
  async cash(user: SessionUser, q: Span, trusted = false) {
    const { seeMoney, seeExpenses, ctx, currency, today } = await this.open(user, trusted);
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 4)}-01-01`;
    const fx = new MainMoney(ctx.fx.main, ctx.fx.rates);
    const db = this.prisma.db;
    const [payments, factoryPaid, expenses] = await Promise.all([
      db.$queryRaw<{ m: string; minor: string; currency: string; mainCurrency: string | null; mainRate: string | null }[]>`
        select to_char(p.paid_on, 'YYYY-MM') as m, (p.amount * 100)::text as minor, o.currency, o.main_currency as "mainCurrency", o.main_rate::text as "mainRate"
        from payments p join orders o on o.id = p.order_id
        where p.voided_at is null and p.paid_on between ${from}::date and ${to}::date`,
      seeMoney
        ? db.$queryRaw<{ m: string; minor: string; rate: string; currency: string; mainCurrency: string | null; mainRate: string | null }[]>`
            select to_char(fp.paid_on, 'YYYY-MM') as m, (fp.amount * 100)::text as minor, fp.rate::text as rate, o.currency, o.main_currency as "mainCurrency", o.main_rate::text as "mainRate"
            from factory_payments fp join orders o on o.id = fp.order_id
            where fp.voided_at is null and fp.paid_on between ${from}::date and ${to}::date`
        : Promise.resolve([]),
      seeExpenses
        ? db.$queryRaw<{ m: string; minor: string; rate: string; category: string; orderId: string | null }[]>`
            select to_char(e.spent_on, 'YYYY-MM') as m, (e.amount * 100)::text as minor, e.rate::text as rate, e.category, e.order_id as "orderId"
            from expenses e where e.voided_at is null and e.spent_on between ${from}::date and ${to}::date`
        : Promise.resolve([]),
    ]);
    const months = new Map<string, { in: number; factories: number; expenses: number }>();
    const month = (m: string) => {
      let x = months.get(m);
      if (!x) months.set(m, (x = { in: 0, factories: 0, expenses: 0 }));
      return x;
    };
    for (const p of payments) month(p.m).in += fx.order(Math.round(Number(p.minor)), p);
    for (const p of factoryPaid) month(p.m).factories += fx.order(convert(Math.round(Number(p.minor)), Number(p.rate)), p);
    const kinds = new Map<string, { minor: number; orders: Set<string> }>();
    for (const e of expenses) {
      const v = convert(Math.round(Number(e.minor)), Number(e.rate));
      month(e.m).expenses += v;
      const k = kinds.get(e.category) ?? { minor: 0, orders: new Set<string>() };
      k.minor += v;
      if (e.orderId) k.orders.add(e.orderId);
      kinds.set(e.category, k);
    }
    return {
      currency,
      from,
      to,
      seeMoney,
      seeExpenses,
      months: [...months.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([m, x]) => ({
          month: m,
          in: fromMinor(x.in),
          out: seeMoney ? fromMinor(x.factories + x.expenses) : null,
          factories: seeMoney ? fromMinor(x.factories) : null,
          expenses: seeExpenses ? fromMinor(x.expenses) : null,
          net: seeMoney ? fromMinor(x.in - x.factories - x.expenses) : null,
        })),
      byKind: seeExpenses
        ? [...kinds.entries()].map(([category, k]) => ({ category, amount: fromMinor(k.minor), orders: k.orders.size })).sort((a, b) => toMinor(b.amount) - toMinor(a.amount))
        : null,
      missingRates: fx.missingRates,
    };
  }

  /**
   * What stands today and needs attention (Insights › Overview and Money): quotations still open and what
   * they are likely to bring, quotations running out this week, customers overdue, factories late on their
   * ready dates, orders of the span under 10% margin, and (money) what is owed each way in its own currency.
   */
  async now(user: SessionUser, q: Span, trusted = false) {
    const { seeMoney, seeExpenses, today, currency, ctx } = await this.open(user, trusted);
    const db = this.prisma.db;
    const week = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const yearAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
    const [[quotes], [decided], [expiring], overdue, late, [low]] = await Promise.all([
      db.$queryRaw<{ count: number; value: string }[]>`
        select count(*)::int as count, coalesce(sum(f.quoted_value_main), 0)::text as value
        from inquiry_facts f where f.outcome = 'open' and f.first_quote_on is not null`,
      db.$queryRaw<{ won: number; lost: number }[]>`
        select count(*) filter (where f.outcome = 'won')::int as won, count(*) filter (where f.outcome = 'lost')::int as lost
        from inquiry_facts f where f.closed_on > ${yearAgo}::date`,
      // The latest quotation sent on each open inquiry, valid until within the next 7 days.
      db.$queryRaw<{ count: number; value: string }[]>`
        select count(*)::int as count, coalesce(sum(f.quoted_value_main), 0)::text as value
        from inquiry_facts f
        join quotations qn on qn.inquiry_id = f.inquiry_id
        join lateral (select r.valid_until from quotation_revisions r where r.quotation_id = qn.id and r.deleted_at is null and r.status = 'sent'
                      order by r.number desc limit 1) r on true
        where f.outcome = 'open' and r.valid_until between ${today}::date and ${week}::date`,
      db.$queryRaw<{ customerId: string; name: string; amount: string; days: number }[]>`
        select x.customer_id as "customerId", c.name, sum(x.overdue)::text as amount, max(x.days)::int as days
        from (select f.customer_id, ${openSql(today, 1, null)} as overdue,
                     (select max(${today}::date - (p ->> 'dueOn')::date) from jsonb_array_elements(f.open_parts) p
                      where (p ->> 'dueOn')::date < ${today}::date and (p ->> 'open')::numeric > 0) as days
              from order_facts f where f.status <> 'cancelled') x
        join customers c on c.id = x.customer_id
        where x.overdue > 0 group by 1, 2 order by max(x.days) desc, 2`,
      // Goods not ready yet, past the date the factory promised (open orders).
      db.$queryRaw<{ factoryId: string; name: string; days: number; orders: number }[]>`
        select f.factory_id as "factoryId", x.name, max(${today}::date - f.ready_promised)::int as days, count(*)::int as orders
        from factory_order_facts f join factories x on x.id = f.factory_id
        where f.status = 'open' and f.ready_actual is null and f.ready_promised < ${today}::date
        group by 1, 2 order by 3 desc, 2`,
      db.$queryRaw<{ count: number; over: string }[]>`
        select count(*)::int as count, coalesce(sum(f.costs_over_plan_main), 0)::text as over
        from order_facts f
        where f.status <> 'cancelled' and f.costed_main > 0 and ${seeExpenses ? Prisma.sql`f.margin` : Prisma.sql`f.margin_quote`} < 10
        ${this.span(q, "f.ordered_on")}`,
    ]);
    const won = decided!.won;
    const winRate = pct(won, won + decided!.lost);
    let byCurrency: { currency: string; toReceive: string; toPay: string }[] | null = null;
    if (seeMoney) {
      // As held: what customers owe in each order's currency (the shared position), what we owe factories in theirs.
      const due = (await positionsSql(db, ctx.fx)).filter((r) => r.dueMinor > 0);
      const cur = await db.order.findMany({ where: { id: { in: due.map((r) => r.id) } }, select: { id: true, currency: true } });
      const curOf = new Map(cur.map((o) => [o.id, o.currency]));
      const pay = await db.$queryRaw<{ currency: string; toPay: string }[]>`
        select f.currency, sum(f.to_pay)::text as "toPay" from factory_order_facts f
        where f.status <> 'cancelled' and f.currency is not null group by 1 having sum(f.to_pay) <> 0`;
      const map = new Map<string, { receive: number; pay: number }>();
      const at = (c: string) => map.get(c) ?? (map.set(c, { receive: 0, pay: 0 }), map.get(c)!);
      for (const r of due) at(curOf.get(r.id) ?? currency).receive += Math.round(r.dueMinor);
      for (const r of pay) at(r.currency).pay += toMinor(r.toPay);
      byCurrency = [...map.entries()]
        .sort((a, b) => (a[0] === currency ? -1 : b[0] === currency ? 1 : a[0].localeCompare(b[0])))
        .map(([c, v]) => ({ currency: c, toReceive: fromMinor(v.receive), toPay: fromMinor(v.pay) }));
    }
    return {
      currency,
      today,
      seeMoney,
      seeExpenses,
      openQuotes: {
        count: quotes!.count,
        value: amount(quotes!.value),
        /** Won ÷ decided over the last 12 months. */
        winRate,
        /** What they are likely to bring: their value × that win rate. */
        likely: winRate === null ? null : fromMinor(Math.round((toMinor(amount(quotes!.value)) * winRate) / 100)),
      },
      expiring: { count: expiring!.count, value: amount(expiring!.value) },
      overdue: {
        customers: overdue.length,
        amount: fromMinor(overdue.reduce((t, r) => t + toMinor(amount(r.amount)), 0)),
        /** The longest overdue first. */
        list: overdue.slice(0, 5).map((r) => ({ customerId: r.customerId, name: r.name, amount: amount(r.amount), days: r.days })),
      },
      lateFactories: late.map((r) => ({ factoryId: r.factoryId, name: r.name, days: r.days, orders: r.orders })),
      lowMargin: { orders: low!.count, costsOverPlan: seeExpenses ? amount(low!.over) : null },
      byCurrency,
    };
  }

  /**
   * Open work right now (Home): open orders by stage, and open inquiries and orders per person handling them.
   * Callers check who may see it (Home: managers).
   */
  async work(user: SessionUser) {
    await this.open(user, true);
    const db = this.prisma.db;
    const [stages, orders, inquiries] = await Promise.all([
      db.$queryRaw<{ stage: string; n: number }[]>`
        select f.stage::text as stage, count(*)::int as n from order_facts f where f.status = 'open' group by 1`,
      db.$queryRaw<{ person: string | null; n: number }[]>`
        select f.handled_by as person, count(*)::int as n from order_facts f where f.status = 'open' group by 1`,
      db.$queryRaw<{ person: string | null; n: number }[]>`
        select f.handled_by as person, count(*)::int as n from inquiry_facts f where f.outcome = 'open' group by 1`,
    ]);
    return {
      openOrders: stages.reduce((t, s) => t + s.n, 0),
      ordersByStage: Object.fromEntries(stages.map((s) => [s.stage, s.n])) as Record<string, number>,
      ordersOf: (id: string) => orders.find((o) => o.person === id)?.n ?? 0,
      inquiriesOf: (id: string) => inquiries.find((o) => o.person === id)?.n ?? 0,
    };
  }

  /**
   * Each order's money as the tables hold it, for Leaks (callers check the permission): the orders ordered in
   * the span (not cancelled) and every open one, with what we owe and paid their factories (main currency).
   */
  async orderMoney(user: SessionUser, q: Required<Span>) {
    const { currency } = await this.open(user, true);
    const rows = await this.prisma.db.$queryRaw<Record<string, unknown>[]>`
      select f.order_id as "orderId", o.ref_no as "refNo", f.customer_id as "customerId", c.name as customer, f.status::text as status,
             to_char(f.ordered_on, 'YYYY-MM-DD') as "orderedOn", f.rate_known as "rateKnown", f.currency,
             f.total_main::text as sales, f.costed_main::text as costed, f.profit_quote_main::text as "profitQuote",
             f.profit_expected_main::text as "profitExpected", f.costs_over_plan_main::text as "costsOverPlan", f.received_main::text as received,
             coalesce((select sum(x.owed_main) from factory_order_facts x where x.order_id = f.order_id), 0)::text as "factoryOwed",
             coalesce((select sum(x.paid_main) from factory_order_facts x where x.order_id = f.order_id), 0)::text as "factoryPaid"
      from order_facts f join orders o on o.id = f.order_id join customers c on c.id = f.customer_id
      where f.status <> 'cancelled' and (f.ordered_on between ${q.from}::date and ${q.to}::date or f.status = 'open')
      order by f.ordered_on, o.ref_no`;
    return {
      currency,
      rows: rows.map((r) => ({
        orderId: r.orderId as string,
        refNo: r.refNo as string,
        customer: { id: r.customerId as string, name: r.customer as string },
        status: r.status as string,
        orderedOn: r.orderedOn as ISODate,
        rateKnown: r.rateKnown as boolean,
        currency: r.currency as string,
        salesMinor: toMinor(amount(r.sales)),
        costedMinor: toMinor(amount(r.costed)),
        profitQuoteMinor: toMinor(amount(r.profitQuote)),
        profitExpectedMinor: toMinor(amount(r.profitExpected)),
        costsOverPlanMinor: toMinor(amount(r.costsOverPlan)),
        receivedMinor: toMinor(amount(r.received)),
        factoryOwedMinor: toMinor(amount(r.factoryOwed)),
        factoryPaidMinor: toMinor(amount(r.factoryPaid)),
      })),
    };
  }

  /** The order rows themselves (drill-down, Excel), newest first: what each figure above adds up. */
  async orders(user: SessionUser, q: Span & FactsFilter & { limit?: number }) {
    const { seeMoney, seeExpenses, today, currency } = await this.open(user);
    const rows = await this.prisma.db.$queryRaw<Record<string, unknown>[]>`
      select f.order_id as "orderId", o.ref_no as "refNo", f.customer_id as "customerId", c.name as customer, f.handled_by as "handledBy",
             f.country, f.channel::text as channel, f.category, f.status::text as status, f.stage::text as stage,
             to_char(f.ordered_on, 'YYYY-MM-DD') as "orderedOn", to_char(f.shipped_on, 'YYYY-MM-DD') as "shippedOn",
             to_char(f.delivered_on, 'YYYY-MM-DD') as "deliveredOn", to_char(f.closed_on, 'YYYY-MM-DD') as "closedOn",
             f.total_main::text as sales, f.costed_main::text as costed, f.cost_main::text as cost, f.profit_quote_main::text as "profitQuote",
             f.profit_expected_main::text as "profitExpected", f.margin_quote::float8 as "marginQuote", f.margin::float8 as margin,
             f.expenses_main::text as expenses, f.costs_over_plan_main::text as "costsOverPlan",
             f.received_main::text as received, f.due_main::text as due, ${openSql(today, 1, null)}::text as overdue,
             f.on_time as "onTime", f.days_to_ship as "daysToShip", f.days_quote_to_order as "daysQuoteToOrder",
             to_char(f.paid_in_full_on, 'YYYY-MM-DD') as "paidInFullOn", f.paid_on_time as "paidOnTime", f.computed_at as "computedAt"
      from order_facts f join orders o on o.id = f.order_id join customers c on c.id = f.customer_id
      where true ${this.span(q, "f.ordered_on")} ${this.filter(q, "order")}
      order by f.ordered_on desc, o.ref_no desc limit ${Math.min(Math.max(q.limit ?? 200, 1), 1000)}`;
    return {
      currency,
      seeMoney,
      rows: rows.map((r) => ({
        ...r,
        sales: amount(r.sales),
        costed: amount(r.costed),
        profitQuote: amount(r.profitQuote),
        received: amount(r.received),
        due: amount(r.due),
        overdue: amount(r.overdue),
        marginQuote: num(r.marginQuote),
        cost: seeMoney ? amount(r.cost) : null,
        profitExpected: seeExpenses ? amount(r.profitExpected) : null,
        margin: seeExpenses ? num(r.margin) : null,
        expenses: seeExpenses ? amount(r.expenses) : null,
        costsOverPlan: seeExpenses ? amount(r.costsOverPlan) : null,
      })),
    };
  }

  /** When the tables were last worked out, what is still queued, and how many rows they hold. */
  async status(user: SessionUser) {
    if (!can(user, "reports.view")) throw new ForbiddenError("Only managers can see insights.");
    const [r] = await this.prisma.db.$queryRaw<{ orders: number; inquiries: number; factories: number; computedAt: Date | null; pending: number }[]>`
      select (select count(*) from order_facts)::int as orders, (select count(*) from inquiry_facts)::int as inquiries,
             (select count(*) from factory_order_facts)::int as factories,
             greatest((select max(computed_at) from order_facts), (select max(computed_at) from inquiry_facts)) as "computedAt",
             (select count(*) from facts_queue)::int as pending`;
    return r!;
  }

  /** Work everything out again now and say what differed (managers who may see money). */
  async rebuild(user: SessionUser) {
    if (!can(user, "expenses.manage")) throw new ForbiddenError("Only managers can check the Insights tables.");
    return this.facts.rebuild(true);
  }
}
