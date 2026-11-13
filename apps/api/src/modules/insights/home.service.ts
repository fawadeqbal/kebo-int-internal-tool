import { Injectable } from "@nestjs/common";
import { convert, fromMinor, roundHalfAway, toMinor, type Minor } from "@kebo/money";
import { can, EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from "@kebo/shared";
import { ForbiddenError, type ISODate } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { CashReportService } from "../treasury/cash-report.service";
import { FactsService } from "./facts/facts.service";
import { addDays, costSentence, lateSentence, monthStart, quotesSentence, salesSentence, standoutOf, supplierSentence, weeksAhead } from "./home-rules";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1]!;
const pct = (part: Minor, whole: Minor) => (whole > 0 ? roundHalfAway((part / whole) * 1000) / 10 : null);
const m = (v: string | null | undefined) => (v ? toMinor(v) : 0);

/**
 * Home for people who see the reports (design "money, simple", board Home): this month's four figures,
 * "What stands out" (sentences worked out from the numbers: each is a comparison with a rule, none is typed
 * and none comes from a language model), the cash of the next four weeks, sold and profit by month, the
 * orders and inquiries that are open now, and the orders that make too little.
 *
 * Read from the Insights tables (order_facts, inquiry_facts, factory_order_facts), the expenses and the cash
 * report: nothing is worked out a second way here. Money in the main currency.
 */
@Injectable()
export class HomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facts: FactsService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
    private readonly settings: SettingsService,
    private readonly cashReport: CashReportService,
  ) {}

  async home(user: SessionUser) {
    if (!can(user, "reports.view")) throw new ForbiddenError("Only managers can see the company's figures.");
    await this.facts.drain(5);
    const seeMoney = can(user, "expenses.manage");
    const seeProfit = seeMoney && (await this.limits.allows("expenses"));
    const seeCash = seeMoney && (await this.limits.allows("cash_book"));
    const today = this.clock.today();
    const { sales } = await this.settings.get();
    const c = sales.currency;
    const db = this.prisma.db;
    const money = (minor: Minor) => `${c} ${Math.round(minor / 100).toLocaleString("en-US")}`;

    const thisMonth = monthStart(today);
    const lastMonth = monthStart(today, -1);
    // The same days of last month ("by the 14th"), so a month that is half over is not compared with a whole one.
    const lastMonthEnd = addDays(thisMonth, -1);
    const sameDay = (`${lastMonth.slice(0, 7)}-${today.slice(8, 10)}` > lastMonthEnd ? lastMonthEnd : `${lastMonth.slice(0, 7)}-${today.slice(8, 10)}`) as ISODate;
    const sixAgo = monthStart(today, -5);
    const week = addDays(today, -7);

    const [byMonth, soFarBefore, biggest, companyByMonth, kinds, overdue, lateAgain, quotes, stages, ready, inquiries, decided, thin, openMargins, comingIn, goingOut, bills, repeating] = await Promise.all([
      // Sold and the orders' profit now, by the month ordered (six months).
      db.$queryRaw<{ m: string; orders: number; sold: string; costed: string; profit: string; gross: string }[]>`
        select to_char(f.ordered_on, 'YYYY-MM') as m, count(*)::int as orders, sum(f.total_main)::text as sold, sum(f.costed_main)::text as costed,
               sum(f.profit_expected_main)::text as profit, sum(f.profit_quote_main)::text as gross
        from order_facts f where f.status <> 'cancelled' and f.ordered_on >= ${sixAgo}::date and f.ordered_on <= ${today}::date group by 1`,
      db.$queryRaw<{ orders: number; sold: string }[]>`
        select count(*)::int as orders, coalesce(sum(f.total_main), 0)::text as sold
        from order_facts f where f.status <> 'cancelled' and f.ordered_on between ${lastMonth}::date and ${sameDay}::date`,
      db.$queryRaw<{ refNo: string; customer: string; sold: string }[]>`
        select o.ref_no as "refNo", p.name as customer, f.total_main::text as sold
        from order_facts f join orders o on o.id = f.order_id join parties p on p.id = f.customer_id
        where f.status <> 'cancelled' and f.ordered_on >= ${thisMonth}::date and f.ordered_on <= ${today}::date
        order by f.total_main desc limit 1`,
      // The company's own costs (no order), by month, in the main currency at the rate they were spent at.
      seeProfit
        ? db.$queryRaw<{ m: string; minor: string; rate: string }[]>`
            select to_char(e.spent_on, 'YYYY-MM') as m, (e.amount * 100)::text as minor, e.rate::text as rate
            from expenses e where e.voided_at is null and e.order_id is null and e.spent_on >= ${sixAgo}::date and e.spent_on <= ${today}::date`
        : Promise.resolve([]),
      // Every cost we bear, by kind, this month and last.
      seeProfit
        ? db.$queryRaw<{ m: string; category: string; minor: string; rate: string }[]>`
            select to_char(e.spent_on, 'YYYY-MM') as m, e.category, (e.amount * 100)::text as minor, e.rate::text as rate
            from expenses e where e.voided_at is null and e.borne_by = 'us' and e.spent_on >= ${lastMonth}::date and e.spent_on <= ${today}::date`
        : Promise.resolve([]),
      // Customers with a part past its date: how much, and how long the oldest has waited.
      db.$queryRaw<{ customerId: string; name: string; amount: string; days: number; paidLate: number; paid: number }[]>`
        select x.customer_id as "customerId", p.name, sum(x.overdue)::text as amount, max(x.days)::int as days,
               (select count(*) from order_facts h where h.customer_id = x.customer_id and h.paid_on_time = false)::int as "paidLate",
               (select count(*) from order_facts h where h.customer_id = x.customer_id and h.paid_in_full_on is not null)::int as paid
        from (select f.customer_id,
                     (select coalesce(sum((q ->> 'open')::numeric), 0) from jsonb_array_elements(f.open_parts) q where (q ->> 'dueOn')::date < ${today}::date) as overdue,
                     (select max(${today}::date - (q ->> 'dueOn')::date) from jsonb_array_elements(f.open_parts) q
                      where (q ->> 'dueOn')::date < ${today}::date and (q ->> 'open')::numeric > 0) as days
              from order_facts f where f.status <> 'cancelled') x
        join parties p on p.id = x.customer_id
        where x.overdue > 0 group by x.customer_id, p.name order by max(x.days) desc, p.name`,
      // Each supplier's last three ready dates that are due: how many were missed, and what is late right now.
      db.$queryRaw<{ factoryId: string; name: string; judged: number; late: number; lateNow: string | null; daysNow: number | null }[]>`
        select r.factory_id as "factoryId", p.name, count(*)::int as judged, count(*) filter (where r.late)::int as late,
               (array_agg(r.ref_no order by r.days_now desc nulls last) filter (where r.days_now is not null))[1] as "lateNow",
               max(r.days_now)::int as "daysNow"
        from (select f.factory_id, o.ref_no,
                     (f.ready_actual is null or f.ready_actual > f.ready_promised) as late,
                     case when f.ready_actual is null and f.status = 'open' then ${today}::date - f.ready_promised end as days_now,
                     row_number() over (partition by f.factory_id order by f.ready_promised desc) as n
              from factory_order_facts f join orders o on o.id = f.order_id
              where f.status <> 'cancelled' and f.ready_promised is not null and (f.ready_actual is not null or f.ready_promised < ${today}::date)) r
        join parties p on p.id = r.factory_id
        where r.n <= 3 group by r.factory_id, p.name having count(*) filter (where r.late) >= 2
        order by max(r.days_now) desc nulls last, count(*) filter (where r.late) desc, p.name limit 1`,
      // Quotations with the customer: how many, what they are worth, how many were sent more than a week ago.
      db.$queryRaw<{ count: number; value: string; old: number }[]>`
        select count(*)::int as count, coalesce(sum(f.quoted_value_main), 0)::text as value,
               count(*) filter (where s.sent_on < ${week}::date)::int as old
        from inquiry_facts f
        left join lateral (select max(r.sent_on) as sent_on from quotations q join quotation_revisions r on r.quotation_id = q.id
                           where q.inquiry_id = f.inquiry_id and r.deleted_at is null and r.status = 'sent') s on true
        where f.outcome = 'open' and f.stage = 'quoted'`,
      // Open orders by stage: how many, their value, how many have a part past its date, how many still owe.
      db.$queryRaw<{ stage: string; n: number; value: string; late: number; owing: number }[]>`
        select f.stage::text as stage, count(*)::int as n, sum(f.total_main)::text as value,
               count(*) filter (where exists (select 1 from jsonb_array_elements(f.open_parts) q where (q ->> 'dueOn')::date < ${today}::date and (q ->> 'open')::numeric > 0))::int as late,
               count(*) filter (where f.due_main > 0)::int as owing
        from order_facts f where f.status = 'open' group by 1`,
      // Goods being made: past the promised day, or promised within the next 14 days.
      db.$queryRaw<{ late: number; soon: number }[]>`
        select count(distinct f.order_id) filter (where f.ready_promised < ${today}::date)::int as late,
               count(distinct f.order_id) filter (where f.ready_promised between ${today}::date and ${addDays(today, 14)}::date)::int as soon
        from factory_order_facts f where f.status = 'open' and f.ready_actual is null and f.ready_promised is not null`,
      db.$queryRaw<{ stage: string; n: number; value: string; old: number }[]>`
        select f.stage::text as stage, count(*)::int as n, coalesce(sum(f.quoted_value_main), 0)::text as value,
               count(*) filter (where f.received_on < ${week}::date)::int as old
        from inquiry_facts f where f.outcome = 'open' group by 1`,
      // Answered (won or lost) in the last three months, and in the three before.
      db.$queryRaw<{ won: number; lost: number; wonBefore: number; lostBefore: number }[]>`
        select count(*) filter (where f.outcome = 'won' and f.closed_on >= ${monthStart(today, -2)}::date)::int as won,
               count(*) filter (where f.outcome = 'lost' and f.closed_on >= ${monthStart(today, -2)}::date)::int as lost,
               count(*) filter (where f.outcome = 'won' and f.closed_on < ${monthStart(today, -2)}::date)::int as "wonBefore",
               count(*) filter (where f.outcome = 'lost' and f.closed_on < ${monthStart(today, -2)}::date)::int as "lostBefore"
        from inquiry_facts f where f.closed_on >= ${monthStart(today, -5)}::date and f.closed_on <= ${today}::date`,
      // Open orders that make under 10% of what was sold with a cost (the lowest first).
      seeProfit
        ? db.$queryRaw<{ orderId: string; refNo: string; customer: string; sold: string; costed: string; profit: string; margin: number }[]>`
            select f.order_id as "orderId", o.ref_no as "refNo", p.name as customer, f.total_main::text as sold, f.costed_main::text as costed,
                   f.profit_expected_main::text as profit, f.margin::float8 as margin
            from order_facts f join orders o on o.id = f.order_id join parties p on p.id = f.customer_id
            where f.status = 'open' and f.costed_main > 0 and f.margin < 10 order by f.margin, o.ref_no limit 50`
        : Promise.resolve([]),
      seeProfit
        ? db.$queryRaw<{ n: number; lowest: number | null }[]>`
            select count(*)::int as n, min(f.margin)::float8 as lowest from order_facts f where f.status = 'open' and f.costed_main > 0 and f.margin >= 10`
        : Promise.resolve([]),
      // What customers still have to pay, part by part, with a date (the next four weeks are read from it).
      db.$queryRaw<{ dueOn: string; open: string }[]>`
        select q ->> 'dueOn' as "dueOn", (q ->> 'open') as open
        from order_facts f, jsonb_array_elements(f.open_parts) q
        where f.status <> 'cancelled' and q ->> 'dueOn' is not null and (q ->> 'open')::numeric > 0`,
      seeMoney
        ? db.$queryRaw<{ dueOn: string; open: string }[]>`
            select q ->> 'dueOn' as "dueOn", (q ->> 'open') as open
            from factory_order_facts f, jsonb_array_elements(f.open_parts) q
            where f.status <> 'cancelled' and q ->> 'dueOn' is not null and (q ->> 'open')::numeric > 0`
        : Promise.resolve([]),
      // Bills known and not paid, and people to pay back: they wait now.
      seeProfit
        ? db.$queryRaw<{ minor: string; rate: string }[]>`
            select (e.amount * 100)::text as minor, e.rate::text as rate from expenses e
            where e.voided_at is null and e.repaid_on is null and (e.pay_later or (e.own_money and e.paid_by is not null))`
        : Promise.resolve([]),
      // The company's costs that come every month: the latest of each chain says the day and the amount.
      seeProfit
        ? db.$queryRaw<{ spentOn: string; minor: string; rate: string; skip: string | null; repeats: boolean }[]>`
            select distinct on (e.repeat_key) to_char(e.spent_on, 'YYYY-MM-DD') as "spentOn", (e.amount * 100)::text as minor, e.rate::text as rate,
                   e.repeat_skip as skip, e.repeats
            from expenses e where e.voided_at is null and e.repeat_key is not null
            order by e.repeat_key, e.spent_on desc, e.created_at desc`
        : Promise.resolve([]),
    ]);
    const spent = (e: { minor: string; rate: string }) => convert(Math.round(Number(e.minor)), Number(e.rate));

    /* ---------------------------------------------------------------- the month */
    const month = (ym: string) => byMonth.find((r) => r.m === ym);
    const company = new Map<string, Minor>();
    for (const e of companyByMonth) company.set(e.m, (company.get(e.m) ?? 0) + spent(e));
    const profitOf = (ym: string) => (seeProfit ? m(month(ym)?.profit) - (company.get(ym) ?? 0) : m(month(ym)?.gross));
    const ym = today.slice(0, 7);
    const ymBefore = lastMonth.slice(0, 7);
    const soldNow = m(month(ym)?.sold);
    const soldBefore = m(soFarBefore[0]?.sold);
    const cash = seeCash
      ? await Promise.all([this.cashReport.report(user, { from: thisMonth, to: today }), this.cashReport.report(user, { from: lastMonth, to: sameDay })]).catch(() => null)
      : null;

    /* ---------------------------------------------------------------- what stands out */
    const q = quotes[0];
    const byKind = new Map<string, { now: Minor; before: Minor }>();
    for (const e of kinds) {
      const k = byKind.get(e.category) ?? { now: 0, before: 0 };
      if (e.m === ym) k.now += spent(e);
      else k.before += spent(e);
      byKind.set(e.category, k);
    }
    const top = biggest[0];
    const standout = standoutOf([
      salesSentence({ now: soldNow, before: soldBefore, biggest: top ? { refNo: top.refNo, customer: top.customer, sold: m(top.sold) } : null, lastMonth: monthName(ymBefore), money }),
      lateSentence(
        overdue.map((o) => ({ name: o.name, amount: m(o.amount), days: o.days, paidLate: o.paidLate, paid: o.paid })),
        money,
      ),
      seeProfit
        ? costSentence({
            kinds: [...byKind.entries()].map(([category, k]) => ({ label: EXPENSE_CATEGORY_LABEL[category as ExpenseCategory] ?? category, ...k })),
            soldNow,
            soldBefore: m(month(ymBefore)?.sold),
            lastMonth: monthName(ymBefore),
          })
        : null,
      supplierSentence(lateAgain[0]),
      quotesSentence(q ? { count: q.count, value: m(q.value), old: q.old } : null, money),
    ]);

    /* ---------------------------------------------------------------- the next four weeks */
    const weeks = cash
      ? weeksAhead({
          today,
          cashNow: m(cash[0].cashNow),
          comingIn: comingIn.map((p) => ({ dueOn: p.dueOn, minor: m(p.open) })),
          goingOut: goingOut.map((p) => ({ dueOn: p.dueOn, minor: m(p.open) })),
          waiting: bills.reduce((t, b) => t + spent(b), 0),
          // A chain goes on while its latest cost says it repeats.
          repeating: repeating.filter((r) => r.repeats).map((r) => ({ lastOn: r.spentOn, minor: spent(r), skip: r.skip })),
        }).map((w) => ({ from: w.from, to: w.to, in: fromMinor(w.in), out: fromMinor(w.out), after: fromMinor(w.after) }))
      : null;

    /* ---------------------------------------------------------------- orders and inquiries now */
    const stage = (s: string) => stages.find((x) => x.stage === s);
    const r = ready[0] ?? { late: 0, soon: 0 };
    const note = (text: string, level?: "bad" | "warn") => ({ note: text, level: level ?? null });
    const orderStages = [
      { key: "confirmed", label: "Confirmed", ...(stage("confirmed")?.late ? note(`${stage("confirmed")!.late} late to pay`, "bad") : note("waiting for the deposit")) },
      { key: "in_production", label: "In production", ...(r.late ? note(`${r.late} past the ready date`, "bad") : r.soon ? note(`${r.soon} ready in the next 14 days`) : note("being made")) },
      { key: "shipped", label: "Shipped", ...(stage("shipped")?.late ? note(`${stage("shipped")!.late} late to pay`, "bad") : stage("shipped")?.owing ? note(`${stage("shipped")!.owing} still to be paid`) : note("on the way")) },
      { key: "done", label: "Delivered", ...(stage("done")?.owing ? note(`${stage("done")!.owing} still to be paid`, "warn") : note("paid, to close")) },
    ].map((s) => ({ ...s, count: stage(s.key)?.n ?? 0, value: fromMinor(m(stage(s.key)?.value)) }));
    const inq = (s: string) => inquiries.find((x) => x.stage === s);
    const d = decided[0] ?? { won: 0, lost: 0, wonBefore: 0, lostBefore: 0 };

    return {
      currency: c,
      today,
      seeMoney,
      seeProfit,
      month: {
        name: monthName(ym),
        before: monthName(ymBefore),
        sold: { now: fromMinor(soldNow), before: fromMinor(soldBefore), orders: month(ym)?.orders ?? 0 },
        collected: cash ? { now: cash[0].in.amount, before: cash[1].in.amount, payments: cash[0].in.entries } : null,
        profit: {
          now: fromMinor(profitOf(ym)),
          margin: pct(profitOf(ym), m(month(ym)?.costed)),
          /** Last month's, whole: what this month is heading against. */
          marginBefore: pct(profitOf(ymBefore), m(month(ymBefore)?.costed)),
          afterCompanyCosts: seeProfit,
        },
        cash: cash ? { total: cash[0].cashNow, byCurrency: cash[0].byCurrency } : null,
      },
      standout,
      weeks,
      months: Array.from({ length: 6 }, (_, i) => monthStart(today, i - 5).slice(0, 7)).map((k) => ({
        month: k,
        orders: month(k)?.orders ?? 0,
        sold: fromMinor(m(month(k)?.sold)),
        profit: fromMinor(profitOf(k)),
      })),
      orders: {
        open: stages.reduce((t, s) => t + s.n, 0),
        value: fromMinor(stages.reduce((t, s) => t + m(s.value), 0)),
        stages: orderStages,
      },
      thin: seeProfit
        ? {
            count: thin.length,
            rows: thin.slice(0, 4).map((t) => ({ orderId: t.orderId, refNo: t.refNo, customer: t.customer, sold: fromMinor(m(t.sold)), costs: fromMinor(m(t.costed) - m(t.profit)), profit: fromMinor(m(t.profit)), margin: t.margin })),
            /** The open orders that make 10% or more, and the lowest among them. */
            others: openMargins[0]?.n ?? 0,
            othersFrom: openMargins[0]?.lowest ?? null,
          }
        : null,
      inquiries: {
        open: inquiries.reduce((t, s) => t + s.n, 0),
        stages: [
          { key: "new", label: "New", count: inq("new")?.n ?? 0, value: null, ...(inq("new")?.old ? note(`${inq("new")!.old} waiting more than 7 days`, "warn") : note("not asked from factories yet")) },
          { key: "sourcing", label: "Waiting for prices", count: inq("sourcing")?.n ?? 0, value: null, ...(inq("sourcing")?.old ? note(`${inq("sourcing")!.old} waiting more than 7 days`, "warn") : note("asked, prices not in yet")) },
          { key: "quoted", label: "Quoted", count: q?.count ?? 0, value: fromMinor(m(q?.value)), ...(q?.old ? note(`${q.old} sent more than 7 days ago`, "warn") : note("with the customer")) },
        ],
        /** Answered in the last three months, and the rate of the three before. */
        won: { won: d.won, answered: d.won + d.lost, rate: pct(d.won, d.won + d.lost), rateBefore: pct(d.wonBefore, d.wonBefore + d.lostBefore) },
      },
    };
  }
}

