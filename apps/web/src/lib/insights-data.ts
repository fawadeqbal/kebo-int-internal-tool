import "server-only";
import { api } from "./api";
import { countryName } from "./countries";
import { can, type Permission } from "@kebo/shared";
import { addDays, todayIn } from "@kebo/utils";
import { lastMonths, monthEnd, monthStart, periodOf, SECTIONS, type Period, type Section } from "./insights-period";
import type { SheetSpec } from "./sheet-spec";
import type { Receivables } from "./types-insights";
import type { OpenBills, ToPayList } from "./types-money";
import type {
  CashFacts,
  CashReport,
  FactoryGroups,
  FactOrders,
  Funnel,
  InquiryGroups,
  OrderGroupRow,
  OrderGroups,
} from "./types-facts";
import { TZ } from "@/lib/format";

/*
 * What each Insights section shows, read from the Insights tables (GET /insights/facts/*) — never worked
 * out again here, only added up and compared. Each loader also gives its tables as sheets, so "Excel" is
 * exactly what the section shows.
 */

const facts = <T>(path: string, q: Record<string, string | number | undefined> = {}) => api.get<T>(`/insights/facts/${path}`, q);
const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const xl = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/** One company row (period "all") of a grouping, or zeros. */
const totalOf = (g: OrderGroups) => g.rows[0] ?? null;

/* ------------------------------------------------------------------------------------------- Overview */

export async function loadOverview(p: Period, money: boolean, month?: string) {
  const span = { from: p.from, to: p.to };
  const prev = { from: p.prevFrom, to: p.prevTo };
  const twelve = { from: monthStart(p.to, -11), to: p.to };
  const drill = month && /^\d{4}-\d{2}$/.test(month) ? { from: `${month}-01`, to: monthEnd(`${month}-01`) } : null;
  /** A list that is only there for some people or plans: without it, its card is left out. */
  const maybe = <T>(get: () => Promise<T>) => get().catch(() => null);
  const [cur, before, cashNow, cashBefore, monthly, monthlyCash, orders, owed, toPay, bills, report, reportBefore, funnelNow, funnelBefore, monthOrders] = await Promise.all([
    facts<OrderGroups>("orders/groups", { ...span, period: "all" }),
    facts<OrderGroups>("orders/groups", { ...prev, period: "all" }),
    facts<CashFacts>("cash", span),
    facts<CashFacts>("cash", prev),
    facts<OrderGroups>("orders/groups", { ...twelve, period: "month" }),
    facts<CashFacts>("cash", twelve),
    facts<FactOrders>("orders", { ...span, limit: 1000 }),
    maybe(() => api.get<Receivables>("/money/receivables")),
    money ? maybe(() => api.get<ToPayList>("/billing/to-pay")) : null,
    money ? maybe(() => api.get<OpenBills>("/money/bills")) : null,
    money ? maybe(() => api.get<CashReport>("/money/cash-report", span)) : null,
    money ? maybe(() => api.get<CashReport>("/money/cash-report", prev)) : null,
    facts<Funnel>("funnel", span),
    facts<Funnel>("funnel", prev),
    drill ? facts<FactOrders>("orders", { ...drill, limit: 200 }) : Promise.resolve(null),
  ]);
  const c = cur.currency;
  const t = totalOf(cur);
  const b = totalOf(before);
  const seeProfit = cur.seeExpenses;
  // Profit is the company's: what the orders make now, less the company's own costs of the same days.
  const company = (x: CashFacts) => sum(x.months, (m) => n(m.company));
  const profitOf = (g: OrderGroupRow | null, x: CashFacts) => (seeProfit ? n(g?.profitExpected) - company(x) : n(g?.profitQuote));
  // Managers: the money that moved (Reports › Cash). Others: what was paid on orders.
  const collected = { now: report ? n(report.in.amount) : sum(cashNow.months, (m) => n(m.in)), before: reportBefore ? n(reportBefore.in.amount) : sum(cashBefore.months, (m) => n(m.in)) };
  const paidOut = report ? { now: n(report.out.amount), before: reportBefore ? n(reportBefore.out.amount) : 0 } : null;
  const months = lastMonths(p.to).map((m) => {
    const r = monthly.rows.find((x) => x.period === m);
    const own = n(monthlyCash.months.find((x) => x.month === m)?.company);
    return { month: m, sales: n(r?.sales), profit: seeProfit ? n(r?.profitExpected) - own : n(r?.profitQuote), orders: r?.orders ?? 0, margin: seeProfit ? (r?.margin ?? null) : (r?.marginQuote ?? null) };
  });

  // Customers owe us: late first (the oldest first), then by the day the next part is due.
  const owe = (owed?.rows ?? [])
    .filter((r) => n(r.due) > 0)
    .sort((x, y) => y.daysLate - x.daysLate || (x.next?.dueOn ?? "9999").localeCompare(y.next?.dueOn ?? "9999"));
  const oweTotals = (owed?.totals ?? []).filter((x) => n(x.due) > 0);

  // To pay in the next 7 days: the factories' parts late or due by then, and the bills that wait.
  const soon = addDays(todayIn(TZ), 7);
  const pay = [
    ...(toPay?.rows ?? [])
      .filter((r) => n(r.open) > 0 && r.dueOn !== null && r.dueOn <= soon)
      .map((r) => ({ key: `f-${r.key}`, name: r.supplier.name, what: `Goods · ${r.part === "deposit" ? "advance" : "balance"} · ${r.order.refNo}`, dueOn: r.dueOn, late: r.late, amount: n(r.open), currency: r.currency, side: "suppliers" })),
    ...(bills?.rows ?? []).map((r) => ({
      key: `b-${r.id}`,
      name: r.owedTo ?? r.description,
      what: [r.kind === "repay" ? "To pay back" : r.owedTo ? r.description : "Bill", r.order?.refNo].filter(Boolean).join(" · "),
      dueOn: r.on as string | null,
      late: r.days,
      amount: n(r.amount),
      currency: r.currency,
      side: "suppliers",
    })),
  ].sort((x, y) => y.late - x.late || (x.dueOn ?? "").localeCompare(y.dueOn ?? ""));
  const payTotals = new Map<string, number>();
  for (const x of pay) payTotals.set(x.currency, (payTotals.get(x.currency) ?? 0) + x.amount);

  // Thin or no profit: orders of the period still running whose profit now is under 10% of what was sold.
  const thin = seeProfit
    ? orders.rows
        .filter((r) => r.status === "open" && r.margin !== null && r.margin < 10)
        .sort((x, y) => (x.margin ?? 0) - (y.margin ?? 0))
        .map((r) => ({ orderId: r.orderId, refNo: r.refNo, customer: r.customer, sales: n(r.sales), profit: n(r.profitExpected), margin: r.margin }))
    : null;

  const data = {
    currency: c,
    seeMoney: cur.seeMoney,
    seeProfit,
    sold: { now: n(t?.sales), before: n(b?.sales), orders: t?.orders ?? 0, ordersBefore: b?.orders ?? 0 },
    collected,
    paidOut,
    profit: {
      now: profitOf(t, cashNow),
      before: profitOf(b, cashBefore),
      margin: seeProfit ? pct(profitOf(t, cashNow), n(t?.costed)) : (t?.marginQuote ?? null),
      company: seeProfit ? company(cashNow) : null,
    },
    winRate: { now: funnelNow.winRate, before: funnelBefore.winRate, won: funnelNow.won, lost: funnelNow.lost },
    months,
    cash: report ? { total: n(report.cashNow), byCurrency: report.byCurrency } : null,
    owe: owed ? { rows: owe.slice(0, 4), count: owe.length, totals: oweTotals } : null,
    pay: toPay || bills ? { rows: pay.slice(0, 4), count: pay.length, totals: [...payTotals.entries()].sort((x, y) => y[1] - x[1]) } : null,
    thin: thin ? { rows: thin.slice(0, 4), count: thin.length } : null,
    month: drill ? { month: month!, orders: monthOrders!.rows } : null,
    missingRates: [...new Set([...cur.missingRates, ...cashNow.missingRates, ...(report?.missingRates ?? [])])].sort(),
  };
  const profitName = seeProfit ? "Profit" : "Gross profit";
  const sheets: SheetSpec[] = [
    {
      name: `Reports overview ${p.from} to ${p.to}`,
      title: "Overview",
      columns: [
        { header: "Figure", width: 28 },
        { header: `${p.label}`, kind: "number", width: 18 },
        { header: `Before (${p.vsLabel})`, kind: "number", width: 18 },
      ],
      rows: [
        [`Sold (${c})`, xl(data.sold.now), xl(data.sold.before)],
        ["Orders", data.sold.orders, data.sold.ordersBefore],
        [`Collected (${c})`, xl(collected.now), xl(collected.before)],
        ...(paidOut ? [[`Paid out (${c})`, xl(paidOut.now), xl(paidOut.before)] as (string | number | null)[]] : []),
        [`${profitName} (${c})`, xl(data.profit.now), xl(data.profit.before)],
        ...(data.cash ? [[`Cash now (${c})`, xl(data.cash.total), null] as (string | number | null)[]] : []),
        ["Win rate %", xl(funnelNow.winRate), xl(funnelBefore.winRate)],
      ],
    },
    {
      name: "Sold and profit by month",
      title: "Sold and profit by month",
      columns: [
        { header: "Month", width: 12 },
        { header: "Orders", kind: "number" },
        { header: `Sold (${c})`, kind: "number", width: 16 },
        { header: `${profitName} (${c})`, kind: "number", width: 16 },
      ],
      rows: months.map((m) => [m.month, m.orders, xl(m.sales), xl(m.profit)]),
    },
    ...(owed
      ? [
          {
            name: "Customers owe us",
            title: "Customers owe us",
            columns: [
              { header: "Customer", width: 30 },
              { header: "Order", width: 16 },
              { header: "Days late", kind: "number" as const },
              { header: "Currency", width: 10 },
              { header: "Still to pay", kind: "number" as const, width: 16 },
            ],
            rows: owe.map((r) => [r.customer.name, r.refNo, r.daysLate, r.currency, xl(n(r.due))]),
          },
        ]
      : []),
    ...(data.pay
      ? [
          {
            name: "To pay in 7 days",
            title: "To pay in the next 7 days",
            columns: [
              { header: "Who", width: 30 },
              { header: "What for", width: 34 },
              { header: "Due", width: 12 },
              { header: "Currency", width: 10 },
              { header: "Amount", kind: "number" as const, width: 16 },
            ],
            rows: pay.map((r) => [r.name, r.what, r.dueOn, r.currency, xl(r.amount)]),
          },
        ]
      : []),
  ];
  return { ...data, sheets };
}

/* ------------------------------------------------------------------------------------------- Profit */

export const PROFIT_SORTS = ["low", "high", "big"] as const;
export type ProfitSort = (typeof PROFIT_SORTS)[number];
export const PROFIT_SORT_LABEL: Record<ProfitSort, string> = { low: "Lowest profit first", high: "Highest profit first", big: "Biggest orders first" };

/**
 * Reports › Profit: what was sold in the period, what those orders cost so far, the company's own costs of the
 * same months, and what is left. By month and by order. An order counts in the month it was ordered; its costs
 * are the ones known today (as on its Costs tab).
 */
export async function loadProfit(p: Period, sort: ProfitSort = "low") {
  const span = { from: p.from, to: p.to };
  const prev = { from: p.prevFrom, to: p.prevTo };
  const [cur, before, monthly, cash, cashBefore, orders] = await Promise.all([
    facts<OrderGroups>("orders/groups", { ...span, period: "all" }),
    facts<OrderGroups>("orders/groups", { ...prev, period: "all" }),
    facts<OrderGroups>("orders/groups", { ...span, period: "month" }),
    facts<CashFacts>("cash", span),
    facts<CashFacts>("cash", prev),
    facts<FactOrders>("orders", { ...span, limit: 1000 }),
  ]);
  const c = cur.currency;
  /** One line of the table: an order's "costs" are what takes its sold-with-a-cost down to its profit now. */
  const line = (g: { orders: number; sales: string; costed: string; profitExpected: string | null } | null | undefined, company: number) => {
    const sold = n(g?.sales);
    const costed = n(g?.costed);
    const fromOrders = n(g?.profitExpected);
    const profit = fromOrders - company;
    return { orders: g?.orders ?? 0, sold, uncosted: sold - costed, costs: costed - fromOrders, fromOrders, company, profit, margin: pct(profit, costed) };
  };
  const companyOf = (x: CashFacts, m?: string) => sum(x.months.filter((y) => !m || y.month === m), (y) => n(y.company));
  const today = todayIn(TZ);
  const lastMonth = (p.to < today ? p.to : today).slice(0, 7);
  const monthKeys: string[] = [];
  for (let d = monthStart(p.from); d.slice(0, 7) <= lastMonth; d = monthStart(d, 1)) monthKeys.push(d.slice(0, 7));
  const months = monthKeys.map((m) => ({ month: m, ...line(monthly.rows.find((x) => x.period === m), companyOf(cash, m)) }));
  const total = line(totalOf(cur), companyOf(cash));
  const totalBefore = line(totalOf(before), companyOf(cashBefore));
  const rows = orders.rows
    .filter((r) => r.status !== "cancelled")
    .map((r) => ({
      orderId: r.orderId,
      refNo: r.refNo,
      customer: r.customer,
      customerId: r.customerId,
      status: r.status,
      stage: r.stage,
      orderedOn: r.orderedOn,
      sold: n(r.sales),
      costs: n(r.costed) - n(r.profitExpected),
      profit: n(r.profitExpected),
      margin: r.margin,
      uncosted: n(r.sales) - n(r.costed),
    }))
    .sort((x, y) => (sort === "big" ? y.sold - x.sold : sort === "high" ? (y.margin ?? -Infinity) - (x.margin ?? -Infinity) : (x.margin ?? Infinity) - (y.margin ?? Infinity)) || x.refNo.localeCompare(y.refNo));
  const data = { currency: c, months, total, totalBefore, orders: rows, missingRates: [...new Set([...cur.missingRates, ...cash.missingRates])].sort() };
  const sheets: SheetSpec[] = [
    {
      name: `Profit ${p.from} to ${p.to}`,
      title: "Profit by month",
      columns: [
        { header: "Month", width: 12 },
        { header: "Orders", kind: "number" },
        { header: `Sold (${c})`, kind: "number", width: 16 },
        { header: `Costs of the orders (${c})`, kind: "number", width: 22 },
        { header: `Profit from orders (${c})`, kind: "number", width: 22 },
        { header: `Company costs (${c})`, kind: "number", width: 18 },
        { header: `Profit (${c})`, kind: "number", width: 16 },
        { header: "%", kind: "number" },
      ],
      rows: [...months.map((m) => [m.month, m.orders, xl(m.sold), xl(m.costs), xl(m.fromOrders), xl(m.company), xl(m.profit), xl(m.margin)]), ["Total", total.orders, xl(total.sold), xl(total.costs), xl(total.fromOrders), xl(total.company), xl(total.profit), xl(total.margin)]],
    },
    {
      name: "Profit by order",
      title: "Profit by order",
      columns: [
        { header: "Order", width: 16 },
        { header: "Customer", width: 30 },
        { header: "Ordered", width: 12 },
        { header: `Sold (${c})`, kind: "number", width: 16 },
        { header: `Costs so far (${c})`, kind: "number", width: 18 },
        { header: `Profit now (${c})`, kind: "number", width: 16 },
        { header: "%", kind: "number" },
      ],
      rows: rows.map((r) => [r.refNo, r.customer, r.orderedOn, xl(r.sold), xl(r.costs), xl(r.profit), xl(r.margin)]),
    },
  ];
  return { ...data, sheets };
}

/* ------------------------------------------------------------------------------------------- Cash */

/** Reports › Cash: the money that moved in the period, by month and by account (GET /money/cash-report). */
export async function loadCash(p: Period) {
  const report = await api.get<CashReport>("/money/cash-report", { from: p.from, to: p.to }).catch(() => null);
  if (!report) return { report: null, sheets: [] as SheetSpec[] };
  const c = report.currency;
  const sheets: SheetSpec[] = [
    {
      name: `Cash ${report.from} to ${report.to}`,
      title: "In and out by month",
      columns: [
        { header: "Month", width: 12 },
        { header: `From customers (${c})`, kind: "number", width: 20 },
        { header: `To suppliers (${c})`, kind: "number", width: 18 },
        { header: `Freight and other bills (${c})`, kind: "number", width: 24 },
        { header: `Company costs (${c})`, kind: "number", width: 18 },
        { header: `Net (${c})`, kind: "number", width: 16 },
        { header: `Cash at the end (${c})`, kind: "number", width: 20 },
      ],
      rows: [
        ...report.months.map((m) => [m.month, xl(n(m.customers)), xl(n(m.suppliers)), xl(n(m.bills)), xl(n(m.company)), xl(n(m.net)), xl(n(m.cashEnd))]),
        ["Total", xl(n(report.total.customers)), xl(n(report.total.suppliers)), xl(n(report.total.bills)), xl(n(report.total.company)), xl(n(report.total.net)), null],
      ],
    },
    {
      name: "By account",
      title: "By account",
      columns: [
        { header: "Account", width: 28 },
        { header: "Currency", width: 10 },
        { header: "At the start", kind: "number", width: 16 },
        { header: "In", kind: "number", width: 16 },
        { header: "Out", kind: "number", width: 16 },
        { header: "At the end", kind: "number", width: 16 },
      ],
      rows: report.accounts.map((a) => [a.name, a.currency, xl(n(a.start)), xl(n(a.in)), xl(n(a.out)), xl(n(a.end))]),
    },
  ];
  return { report, sheets };
}

/* ------------------------------------------------------------------------------------------- Customers */

export const CUSTOMER_CHIPS = ["all", "new", "repeat", "sleeping", "owe"] as const;
export type CustomerChip = (typeof CUSTOMER_CHIPS)[number];
export const CUSTOMER_CHIP_LABEL: Record<CustomerChip, string> = {
  all: "All",
  new: "New",
  repeat: "Repeat",
  sleeping: "Sleeping",
  owe: "Owe money",
};

export interface CustomerRow {
  id: string;
  name: string;
  country: string | null;
  orders: number;
  sales: number;
  margin: number | null;
  paidOnTime: number | null;
  owed: number;
  overdue: number;
  spark: number[];
  kinds: Set<CustomerChip>;
  allSales: number;
}

export async function loadCustomers(p: Period, today: string) {
  const span = { from: p.from, to: p.to };
  const prev = { from: p.prevFrom, to: p.prevTo };
  const six = { from: monthStart(p.to, -5), to: p.to };
  const [period, before, ever, monthly, count] = await Promise.all([
    facts<OrderGroups>("orders/groups", { ...span, period: "all", by: "customer" }),
    facts<OrderGroups>("orders/groups", { ...prev, period: "all", by: "customer" }),
    facts<OrderGroups>("orders/groups", { period: "all", by: "customer" }),
    facts<OrderGroups>("orders/groups", { ...six, period: "month", by: "customer" }),
    api.get<{ total: number }>("/customers", { pageSize: 1 }).catch(() => ({ total: 0 })),
  ]);
  const c = period.currency;
  const firstOf = new Map(ever.rows.map((r) => [r.key, r.firstOrderedOn]));
  const sleepFrom = monthStart(today, -6);
  const repeatOrders = (rows: OrderGroupRow[], from: string) =>
    sum(
      rows.filter((r) => (firstOf.get(r.key) ?? from) < from),
      (r) => r.orders,
    );
  const orders = sum(period.rows, (r) => r.orders);
  const ordersBefore = sum(before.rows, (r) => r.orders);
  const sales = sum(period.rows, (r) => n(r.sales));
  const salesBefore = sum(before.rows, (r) => n(r.sales));
  const sleeping = ever.rows.filter((r) => r.lastOrderedOn < sleepFrom);
  const months = lastMonths(p.to, 6);
  const rows: CustomerRow[] = ever.rows.map((e) => {
    const r = period.rows.find((x) => x.key === e.key);
    const kinds = new Set<CustomerChip>(["all"]);
    if (r && e.firstOrderedOn >= p.from) kinds.add("new");
    if (r && e.firstOrderedOn < p.from) kinds.add("repeat");
    if (e.lastOrderedOn < sleepFrom) kinds.add("sleeping");
    if (n(e.due) > 0) kinds.add("owe");
    return {
      id: e.key,
      name: e.label,
      country: e.country ?? null,
      orders: r?.orders ?? 0,
      sales: n(r?.sales),
      margin: r?.marginQuote ?? null,
      paidOnTime: e.paid.percent,
      owed: n(e.due),
      overdue: n(e.overdue),
      spark: months.map((m) => n(monthly.rows.find((x) => x.key === e.key && x.period === m)?.sales)),
      kinds,
      allSales: n(e.sales),
    };
  });
  rows.sort((x, y) => y.sales - x.sales || y.owed - x.owed || y.allSales - x.allSales || x.name.localeCompare(y.name));
  const data = {
    currency: c,
    total: count.total,
    ordered: { now: period.rows.length, before: before.rows.length, new: rows.filter((r) => r.kinds.has("new")).length },
    repeat: { now: pct(repeatOrders(period.rows, p.from), orders), before: pct(repeatOrders(before.rows, p.prevFrom), ordersBefore) },
    average: { now: orders ? sales / orders : null, before: ordersBefore ? salesBefore / ordersBefore : null, orders },
    sleeping: { count: sleeping.length, sales: sum(sleeping, (r) => n(r.sales)) },
    rows,
    counts: Object.fromEntries(CUSTOMER_CHIPS.map((k) => [k, rows.filter((r) => r.kinds.has(k)).length])) as Record<CustomerChip, number>,
  };
  const sheets: SheetSpec[] = [
    {
      name: `Insights customers ${p.from} to ${p.to}`,
      title: "Customers",
      columns: [
        { header: "Customer", width: 30 },
        { header: "Country", width: 14 },
        { header: "Orders", kind: "number" },
        { header: `Sales (${c})`, kind: "number", width: 16 },
        { header: "Margin %", kind: "number" },
        { header: "Paid on time %", kind: "number" },
        { header: `Still owed (${c})`, kind: "number", width: 16 },
        { header: `Overdue (${c})`, kind: "number", width: 16 },
      ],
      rows: rows.map((r) => [
        r.name,
        r.country ? countryName(r.country) : null,
        r.orders,
        xl(r.sales),
        xl(r.margin),
        xl(r.paidOnTime),
        xl(r.owed),
        xl(r.overdue),
      ]),
    },
  ];
  return { ...data, sheets };
}

/* ------------------------------------------------------------------------------------------- Factories */

export async function loadFactories(p: Period) {
  const span = { from: p.from, to: p.to };
  const [period, ever, orders, count] = await Promise.all([
    facts<FactoryGroups>("factories/groups", { ...span, period: "all", by: "factory" }),
    facts<FactoryGroups>("factories/groups", { period: "all", by: "factory" }),
    facts<OrderGroups>("orders/groups", { ...span, period: "all" }),
    api.get<{ total: number }>("/factories", { pageSize: 1 }).catch(() => ({ total: 0 })),
  ]);
  const c = period.currency;
  const keys = new Set([
    ...period.rows.filter((r) => r.orders > 0 || r.offersSent > 0).map((r) => r.key),
    ...ever.rows.filter((r) => n(r.toPay) > 0).map((r) => r.key),
  ]);
  const rows = [...keys]
    .map((k) => {
      const r = period.rows.find((x) => x.key === k);
      const e = ever.rows.find((x) => x.key === k)!;
      return {
        id: k,
        name: (r ?? e).label,
        orders: r?.orders ?? 0,
        spend: r?.spend === null || r?.spend === undefined ? (period.seeMoney ? 0 : null) : n(r.spend),
        ready: r?.ready ?? { known: 0, onTime: 0, percent: null },
        daysLate: r?.daysLate ?? null,
        offersSent: r?.offersSent ?? 0,
        offersWon: r?.offersWon ?? 0,
        toPay: e.toPay === null ? null : n(e.toPay),
        claims: r?.claims ?? 0,
      };
    })
    .sort((x, y) => n(y.spend) - n(x.spend) || y.orders - x.orders || n(y.toPay) - n(x.toPay) || x.name.localeCompare(y.name));
  const t = totalOf(orders);
  const data = { currency: c, seeMoney: period.seeMoney, total: count.total, rows, shipped: t?.shipped ?? null };
  const sheets: SheetSpec[] = [
    {
      name: `Insights factories ${p.from} to ${p.to}`,
      title: "Factories",
      columns: [
        { header: "Factory", width: 30 },
        { header: "Orders", kind: "number" },
        ...(data.seeMoney ? [{ header: `Spend (${c})`, kind: "number" as const, width: 16 }] : []),
        { header: "Ready on time %", kind: "number" },
        { header: "Avg days late", kind: "number" },
        { header: "Offers won", kind: "number" },
        { header: "Offers sent", kind: "number" },
        ...(data.seeMoney ? [{ header: `To pay (${c})`, kind: "number" as const, width: 16 }] : []),
        { header: "Claims", kind: "number" },
      ],
      rows: rows.map((r) => [
        r.name,
        r.orders,
        ...(data.seeMoney ? [xl(r.spend)] : []),
        xl(r.ready.percent),
        xl(r.daysLate),
        r.offersWon,
        r.offersSent,
        ...(data.seeMoney ? [xl(r.toPay)] : []),
        r.claims,
      ]),
    },
  ];
  return { ...data, sheets };
}

/* ------------------------------------------------------------------------------------------- People */

interface PeopleTargets {
  people: { id: string; name: string }[];
  targets: { month: string; userId: string; amount: string }[];
}

export async function loadPeople(p: Period, today: string) {
  const span = { from: p.from, to: p.to };
  const thisMonth = { from: `${today.slice(0, 7)}-01`, to: today };
  const year = today.slice(0, 4);
  const [inq, ord, month, company, targets, companyTargets] = await Promise.all([
    facts<InquiryGroups>("inquiries/groups", { ...span, period: "all", by: "person" }),
    facts<OrderGroups>("orders/groups", { ...span, period: "all", by: "person" }),
    facts<OrderGroups>("orders/groups", { ...thisMonth, period: "all", by: "person" }),
    facts<OrderGroups>("orders/groups", { ...thisMonth, period: "all" }),
    api.get<PeopleTargets>("/insights/targets/people", { year }).catch(() => ({ people: [], targets: [] }) as PeopleTargets),
    api.get<{ month: string; amount: string }[]>("/insights/targets", { year }).catch(() => []),
  ]);
  const c = ord.currency;
  const ym = today.slice(0, 7);
  const keys = new Set([
    ...inq.rows.map((r) => r.key),
    ...ord.rows.map((r) => r.key),
    ...targets.targets.filter((t) => t.month === ym).map((t) => t.userId),
  ]);
  const nameOf = (k: string) =>
    inq.rows.find((r) => r.key === k)?.label ??
    ord.rows.find((r) => r.key === k)?.label ??
    targets.people.find((x) => x.id === k)?.name ??
    k;
  const rows = [...keys]
    .map((k) => {
      const i = inq.rows.find((r) => r.key === k);
      const o = ord.rows.find((r) => r.key === k);
      const sold = n(month.rows.find((r) => r.key === k)?.sales);
      const target = targets.targets.find((t) => t.month === ym && t.userId === k);
      return {
        id: k,
        name: nameOf(k),
        inquiries: i?.inquiries ?? 0,
        daysToQuote: i?.medianDaysToFirstQuote ?? null,
        winRate: i?.winRate ?? null,
        sales: n(o?.sales),
        profit: n(o?.profitQuote),
        target: target
          ? { amount: n(target.amount), sold, percent: n(target.amount) > 0 ? Math.round((sold / n(target.amount)) * 100) : null }
          : null,
      };
    })
    .sort((x, y) => (x.id === "nobody" ? 1 : y.id === "nobody" ? -1 : y.sales - x.sales || y.inquiries - x.inquiries));
  const companyTarget = companyTargets.find((t) => t.month === ym);
  const companySold = n(totalOf(company)?.sales);
  const data = {
    currency: c,
    rows,
    company: companyTarget
      ? {
          amount: n(companyTarget.amount),
          sold: companySold,
          percent: n(companyTarget.amount) > 0 ? Math.round((companySold / n(companyTarget.amount)) * 100) : null,
        }
      : null,
  };
  const sheets: SheetSpec[] = [
    {
      name: `Insights people ${p.from} to ${p.to}`,
      title: "People",
      columns: [
        { header: "Person", width: 24 },
        { header: "Inquiries", kind: "number" },
        { header: "Days to first quote", kind: "number" },
        { header: "Win rate %", kind: "number" },
        { header: `Sales (${c})`, kind: "number", width: 16 },
        { header: `Target this month (${c})`, kind: "number", width: 18 },
        { header: "Target reached %", kind: "number" },
        { header: `Gross profit (${c})`, kind: "number", width: 16 },
      ],
      rows: rows.map((r) => [
        r.name,
        r.inquiries,
        xl(r.daysToQuote),
        xl(r.winRate),
        xl(r.sales),
        xl(r.target?.amount),
        xl(r.target?.percent),
        xl(r.profit),
      ]),
    },
  ];
  return { ...data, sheets };
}

/* ------------------------------------------------------------------------------------------- Funnel */

export async function loadFunnel(p: Period) {
  const span = { from: p.from, to: p.to };
  const [f, channels, countries, categories, margins] = await Promise.all([
    facts<Funnel>("funnel", span),
    facts<InquiryGroups>("inquiries/groups", { ...span, period: "all", by: "channel" }),
    facts<InquiryGroups>("inquiries/groups", { ...span, period: "all", by: "country" }),
    facts<InquiryGroups>("inquiries/groups", { ...span, period: "all", by: "category" }),
    facts<OrderGroups>("orders/groups", { ...span, period: "all", by: "category" }),
  ]);
  const c = channels.currency;
  const by = (g: InquiryGroups) => [...g.rows].sort((x, y) => y.inquiries - x.inquiries);
  const data = {
    currency: c,
    funnel: f,
    channels: by(channels),
    countries: by(countries),
    categories: by(categories).map((r) => ({ ...r, margin: margins.rows.find((m) => m.key === r.key)?.marginQuote ?? null })),
  };
  const table = (
    title: string,
    head: string,
    rows: { label: string; inquiries: number; winRate: number | null; wonValue: string }[],
  ): SheetSpec => ({
    name: title,
    title,
    columns: [
      { header: head, width: 24 },
      { header: "Inquiries", kind: "number" },
      { header: "Win rate %", kind: "number" },
      { header: `Won (${c})`, kind: "number", width: 16 },
    ],
    rows: rows.map((r) => [r.label, r.inquiries, xl(r.winRate), xl(n(r.wonValue))]),
  });
  const sheets: SheetSpec[] = [
    {
      name: `Insights funnel ${p.from} to ${p.to}`,
      title: "Funnel",
      columns: [
        { header: "Stage", width: 22 },
        { header: "Inquiries", kind: "number" },
        { header: `Value (${c})`, kind: "number", width: 16 },
      ],
      rows: [
        ["Inquiries in", f.inquiries, null],
        ["Got factory prices", f.gotPrices, null],
        ["Quoted", f.quoted, xl(n(f.quotedValue))],
        ["Won", f.won, xl(n(f.wonValue))],
        ["Lost", f.lost, null],
        ["Still open", f.open, null],
      ],
    },
    {
      name: "Why we lose",
      title: "Why we lose",
      columns: [
        { header: "Reason", width: 28 },
        { header: "Inquiries", kind: "number" },
      ],
      rows: f.lostReasons.map((r) => [r.label, r.count]),
    },
    table("By channel", "Channel", data.channels),
    table(
      "By country",
      "Country",
      data.countries.map((r) => ({ ...r, label: countryName(r.label) })),
    ),
    table("By product", "Product", data.categories),
  ];
  return { ...data, sheets };
}

/* ------------------------------------------------------------------------------------------- Excel */

/** "Excel" on an Insights section: the tables that section shows, for the same period (one tab each). */
export async function insightsSheets(q: Record<string, string | undefined>): Promise<SheetSpec[]> {
  const me = await api.get<{ permissions: Permission[] }>("/auth/me");
  const today = todayIn(TZ);
  const p = periodOf(q, today);
  const section: Section = (SECTIONS as readonly string[]).includes(q.section ?? "") ? (q.section as Section) : "overview";
  const money = can(me, "expenses.manage");
  switch (section) {
    case "overview":
      return (await loadOverview(p, money)).sheets;
    case "money":
      return (await loadProfit(p)).sheets;
    case "cash":
      return (await loadCash(p)).sheets;
    case "customers":
      return (await loadCustomers(p, today)).sheets;
    case "factories":
      return (await loadFactories(p)).sheets;
    case "people":
      return (await loadPeople(p, today)).sheets;
    case "funnel":
      return (await loadFunnel(p)).sheets;
  }
}
