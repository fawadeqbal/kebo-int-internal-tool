import "server-only";
import { api } from "./api";
import { countryName } from "./countries";
import { can, type Permission } from "@kebo/shared";
import { todayIn } from "@kebo/utils";
import { lastMonths, monthEnd, monthStart, periodOf, SECTIONS, type Period, type Section } from "./insights-period";
import type { SheetSpec } from "./sheet-spec";
import type {
  Aging,
  AgeBucket,
  CashFacts,
  FactoryGroups,
  FactOrders,
  FactsNow,
  Funnel,
  InquiryGroups,
  OrderGroupRow,
  OrderGroups,
} from "./types-facts";

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

export const BUCKETS: { key: AgeBucket | "over60"; label: string }[] = [
  { key: "notDue", label: "Not due yet" },
  { key: "d30", label: "1–30 days" },
  { key: "d60", label: "31–60 days" },
  { key: "over60", label: "Over 60" },
];
export const bucketValue = (a: Aging, k: AgeBucket | "over60") => n(k === "over60" ? a.over60 : a[k]);

/* ------------------------------------------------------------------------------------------- Overview */

export async function loadOverview(p: Period, money: boolean, month?: string) {
  const span = { from: p.from, to: p.to };
  const prev = { from: p.prevFrom, to: p.prevTo };
  const twelve = { from: monthStart(p.to, -11), to: p.to };
  const drill = month && /^\d{4}-\d{2}$/.test(month) ? { from: `${month}-01`, to: monthEnd(`${month}-01`) } : null;
  const [cur, before, cashNow, cashBefore, now, recv, pay, funnelNow, funnelBefore, monthly, customers, factories, owing, monthOrders] =
    await Promise.all([
      facts<OrderGroups>("orders/groups", { ...span, period: "all" }),
      facts<OrderGroups>("orders/groups", { ...prev, period: "all" }),
      facts<CashFacts>("cash", span),
      facts<CashFacts>("cash", prev),
      facts<FactsNow>("now", span),
      facts<Aging>("aging", { side: "receivable" }),
      money ? facts<Aging>("aging", { side: "payable" }) : Promise.resolve(null),
      facts<Funnel>("funnel", span),
      facts<Funnel>("funnel", prev),
      facts<OrderGroups>("orders/groups", { ...twelve, period: "month" }),
      facts<OrderGroups>("orders/groups", { ...span, period: "all", by: "customer" }),
      facts<FactoryGroups>("factories/groups", { ...span, period: "all", by: "factory" }),
      money ? facts<FactoryGroups>("factories/groups", { period: "all", by: "factory" }) : Promise.resolve(null),
      drill ? facts<FactOrders>("orders", { ...drill, limit: 200 }) : Promise.resolve(null),
    ]);
  const c = cur.currency;
  const t = totalOf(cur);
  const b = totalOf(before);
  const cashIn = sum(cashNow.months, (m) => n(m.in));
  const cashInBefore = sum(cashBefore.months, (m) => n(m.in));
  const cashOut = cashNow.seeMoney ? sum(cashNow.months, (m) => n(m.out)) : null;
  const cashOutBefore = cashBefore.seeMoney ? sum(cashBefore.months, (m) => n(m.out)) : null;
  const months = lastMonths(p.to).map((m) => {
    const r = monthly.rows.find((x) => x.period === m);
    return { month: m, sales: n(r?.sales), profit: n(r?.profitQuote), orders: r?.orders ?? 0, margin: r?.marginQuote ?? null };
  });
  const owingFactories = owing?.rows.filter((r) => n(r.toPay) > 0) ?? [];
  const own = new Map<string, number>();
  for (const r of owingFactories) for (const o of r.own ?? []) own.set(o.currency, (own.get(o.currency) ?? 0) + n(o.toPay));
  const topCustomers = [...customers.rows].sort((x, y) => n(y.sales) - n(x.sales)).slice(0, 5);
  const topFactories = [...factories.rows.filter((r) => r.orders > 0)]
    .sort((x, y) => (money ? n(y.spend) - n(x.spend) : y.orders - x.orders))
    .slice(0, 5);
  const data = {
    currency: c,
    seeMoney: cur.seeMoney,
    seeExpenses: cur.seeExpenses,
    sales: { now: n(t?.sales), before: n(b?.sales), orders: t?.orders ?? 0, ordersBefore: b?.orders ?? 0 },
    profit: { now: n(t?.profitQuote), before: n(b?.profitQuote), margin: t?.marginQuote ?? null, marginBefore: b?.marginQuote ?? null },
    shipped: t?.shipped ?? null,
    cashIn: { now: cashIn, before: cashInBefore },
    cashOut: cashOut === null ? null : { now: cashOut, before: cashOutBefore ?? 0 },
    receivable: recv,
    payable: pay,
    payOwn: [...own.entries()].sort((x, y) => y[1] - x[1]),
    payFactories: owingFactories.length,
    now,
    winRate: { now: funnelNow.winRate, before: funnelBefore.winRate, won: funnelNow.won, lost: funnelNow.lost },
    months,
    topCustomers,
    topFactories,
    month: drill ? { month: month!, orders: monthOrders!.rows } : null,
    missingRates: cashNow.missingRates,
    missingRateOrders: t?.missingRate ?? 0,
  };
  const sheets: SheetSpec[] = [
    {
      name: `Insights overview ${p.from} to ${p.to}`,
      title: "Overview",
      columns: [
        { header: "Figure", width: 28 },
        { header: `${p.label}`, kind: "number", width: 18 },
        { header: `Before (${p.vsLabel})`, kind: "number", width: 18 },
      ],
      rows: [
        [`Sales (${c})`, xl(data.sales.now), xl(data.sales.before)],
        ["Orders", data.sales.orders, data.sales.ordersBefore],
        [`Gross profit (${c})`, xl(data.profit.now), xl(data.profit.before)],
        ["Gross margin %", xl(data.profit.margin), xl(data.profit.marginBefore)],
        [`Cash in (${c})`, xl(cashIn), xl(cashInBefore)],
        ...(data.cashOut ? [[`Cash out (${c})`, xl(data.cashOut.now), xl(data.cashOut.before)] as (string | number | null)[]] : []),
        [`To receive today (${c})`, xl(n(recv.total)), null],
        ...(pay ? [[`To pay factories today (${c})`, xl(n(pay.total)), null] as (string | number | null)[]] : []),
        [`Open quotations (${c})`, xl(n(now.openQuotes.value)), null],
        ["Win rate %", xl(funnelNow.winRate), xl(funnelBefore.winRate)],
      ],
    },
    {
      name: "Sales by month",
      title: "Sales by month",
      columns: [
        { header: "Month", width: 12 },
        { header: "Orders", kind: "number" },
        { header: `Sales (${c})`, kind: "number", width: 16 },
        { header: `Gross profit (${c})`, kind: "number", width: 16 },
        { header: "Margin %", kind: "number" },
      ],
      rows: months.map((m) => [m.month, m.orders, xl(m.sales), xl(m.profit), xl(m.margin)]),
    },
    {
      name: "Top customers",
      title: "Top customers",
      columns: [
        { header: "Customer", width: 30 },
        { header: "Orders", kind: "number" },
        { header: `Sales (${c})`, kind: "number", width: 16 },
        { header: "Margin %", kind: "number" },
      ],
      rows: topCustomers.map((r) => [r.label, r.orders, xl(n(r.sales)), xl(r.marginQuote)]),
    },
    {
      name: "Top factories",
      title: "Top factories",
      columns: [
        { header: "Factory", width: 30 },
        { header: "Orders", kind: "number" },
        ...(money ? [{ header: `Spend (${c})`, kind: "number" as const, width: 16 }] : []),
        { header: "Ready on time %", kind: "number" },
      ],
      rows: topFactories.map((r) => [r.label, r.orders, ...(money ? [xl(n(r.spend))] : []), xl(r.ready.percent)]),
    },
  ];
  return { ...data, sheets };
}

/* ------------------------------------------------------------------------------------------- Money */

export interface AccountRow {
  currency: string;
  archived: boolean;
  balance?: string;
}

export async function loadMoney(p: Period, age?: { side: "receivable" | "payable"; bucket: AgeBucket | "over60" }) {
  const span = { from: p.from, to: p.to };
  const prev = { from: p.prevFrom, to: p.prevTo };
  const six = { from: monthStart(p.to, -5), to: p.to };
  const twelve = { from: monthStart(p.to, -11), to: p.to };
  const buckets: AgeBucket[] = age ? (age.bucket === "over60" ? ["d90", "older"] : [age.bucket]) : [];
  const [cur, before, cashNow, cashBefore, cash12, recv, pay, monthly, now, accounts, orders, ...lists] = await Promise.all([
    facts<OrderGroups>("orders/groups", { ...span, period: "all" }),
    facts<OrderGroups>("orders/groups", { ...prev, period: "all" }),
    facts<CashFacts>("cash", span),
    facts<CashFacts>("cash", prev),
    facts<CashFacts>("cash", twelve),
    facts<Aging>("aging", { side: "receivable" }),
    facts<Aging>("aging", { side: "payable" }),
    facts<OrderGroups>("orders/groups", { ...six, period: "month" }),
    facts<FactsNow>("now", span),
    api.get<AccountRow[]>("/money/accounts").catch(() => [] as AccountRow[]),
    facts<FactOrders>("orders", { ...span, limit: 1000 }),
    ...buckets.map((bucket) => facts<Aging>("aging", { side: age!.side, bucket })),
  ]);
  const c = cur.currency;
  const t = totalOf(cur);
  const b = totalOf(before);
  const net = (x: CashFacts) => sum(x.months, (m) => n(m.net));
  const inOf = (x: CashFacts) => sum(x.months, (m) => n(m.in));
  const outOf = (x: CashFacts) => sum(x.months, (m) => n(m.out));
  const cashMonths = lastMonths(p.to).map((m) => {
    const r = cash12.months.find((x) => x.month === m);
    return { month: m, in: n(r?.in), out: n(r?.out), net: n(r?.net) };
  });
  const profitMonths = lastMonths(p.to, 6).map((m) => {
    const r = monthly.rows.find((x) => x.period === m);
    return { month: m, a: n(r?.profitQuote), b: n(r?.profitExpected) };
  });
  const inHand = new Map<string, number>();
  for (const a of accounts)
    if (!a.archived && a.balance !== undefined) inHand.set(a.currency, (inHand.get(a.currency) ?? 0) + n(a.balance));
  const currencies = [...new Set([...(now.byCurrency ?? []).map((x) => x.currency), ...inHand.keys()])].map((cur) => {
    const x = now.byCurrency?.find((y) => y.currency === cur);
    return { currency: cur, toReceive: n(x?.toReceive), toPay: n(x?.toPay), inHand: inHand.has(cur) ? inHand.get(cur)! : null };
  });
  const leaks = orders.rows
    .filter((r) => n(r.costsOverPlan) > 0)
    .sort((x, y) => n(y.costsOverPlan) - n(x.costsOverPlan))
    .slice(0, 5)
    .map((r) => ({
      orderId: r.orderId,
      refNo: r.refNo,
      customer: r.customer,
      planned: n(r.cost),
      actual: n(r.cost) + n(r.costsOverPlan),
      over: n(r.costsOverPlan),
      margin: r.margin,
    }));
  const ageList = age ? lists.flatMap((l) => l.orders ?? []).sort((x, y) => n(y.amount) - n(x.amount)) : null;
  const data = {
    currency: c,
    netCash: { now: net(cashNow), before: net(cashBefore), in: inOf(cashNow), out: outOf(cashNow) },
    profitExpected: { now: n(t?.profitExpected), before: n(b?.profitExpected), margin: t?.margin ?? null },
    profitDone: { now: n(t?.profitDone), before: n(b?.profitDone) },
    overPlan: { now: n(t?.costsOverPlan), before: n(b?.costsOverPlan), orders: t?.ordersOverPlan ?? 0 },
    cashMonths,
    receivable: recv,
    payable: pay,
    age: age ? { ...age, orders: ageList ?? [] } : null,
    profitMonths,
    byKind: cashNow.byKind ?? [],
    currencies,
    leaks,
    missingRates: [...new Set([...cashNow.missingRates, ...cash12.missingRates])],
  };
  const sheets: SheetSpec[] = [
    {
      name: `Insights money ${p.from} to ${p.to}`,
      title: "Cash by month",
      columns: [
        { header: "Month", width: 12 },
        { header: `Cash in (${c})`, kind: "number", width: 16 },
        { header: `Cash out (${c})`, kind: "number", width: 16 },
        { header: `Net (${c})`, kind: "number", width: 16 },
      ],
      rows: cashMonths.map((m) => [m.month, xl(m.in), xl(m.out), xl(m.net)]),
    },
    {
      name: "Owed by age",
      title: "Owed by age",
      columns: [
        { header: "Age", width: 16 },
        { header: `Owed to us (${c})`, kind: "number", width: 18 },
        { header: `We owe factories (${c})`, kind: "number", width: 20 },
      ],
      rows: BUCKETS.map((k) => [k.label, xl(bucketValue(recv, k.key)), xl(bucketValue(pay, k.key))]),
    },
    {
      name: "Profit by month",
      title: "Profit by month",
      columns: [
        { header: "Month", width: 12 },
        { header: `Expected at order (${c})`, kind: "number", width: 20 },
        { header: `Now (${c})`, kind: "number", width: 16 },
      ],
      rows: profitMonths.map((m) => [m.month, xl(m.a), xl(m.b)]),
    },
    {
      name: "Costs by kind",
      title: "Costs by kind",
      columns: [
        { header: "Kind", width: 22 },
        { header: `Amount (${c})`, kind: "number", width: 16 },
        { header: "Orders", kind: "number" },
      ],
      rows: data.byKind.map((k) => [k.category, xl(n(k.amount)), k.orders]),
    },
    {
      name: "Money by currency",
      title: "By currency",
      columns: [
        { header: "Currency", width: 10 },
        { header: "To receive", kind: "number", width: 16 },
        { header: "To pay", kind: "number", width: 16 },
        { header: "In hand", kind: "number", width: 16 },
      ],
      rows: currencies.map((x) => [x.currency, xl(x.toReceive), xl(x.toPay), xl(x.inHand)]),
    },
    {
      name: "Where money leaks",
      title: "Costs over plan",
      columns: [
        { header: "Order", width: 16 },
        { header: "Customer", width: 28 },
        { header: `Planned cost (${c})`, kind: "number", width: 16 },
        { header: `Cost now (${c})`, kind: "number", width: 16 },
        { header: `Over (${c})`, kind: "number" },
        { header: "Margin now %", kind: "number" },
      ],
      rows: leaks.map((l) => [l.refNo, l.customer, xl(l.planned), xl(l.actual), xl(l.over), xl(l.margin)]),
    },
  ];
  return { ...data, sheets };
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

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

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
      return (await loadMoney(p)).sheets;
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
