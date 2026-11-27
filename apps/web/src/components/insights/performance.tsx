import { can, type Permission } from "@kebo/shared";
import { api } from "@/lib/api";
import { date, plural, companyToday } from "@/lib/format";
import { bigMoney, percent } from "@/lib/insights-period";
import { hasFeature } from "@/lib/session";
import type { Aging, SupplierGroups, FactOrders, InquiryGroups, OrderGroups } from "@/lib/types-facts";
import type { PersonSpending } from "@/lib/types-money";
import { PerformanceView, type PerfFigure } from "./performance-view";
import { isFailed, part } from "@/lib/part";
import { CouldNotLoad } from "@/components/common/could-not-load";
import { optional } from "@/components/print/data";

const facts = <T,>(path: string, q: Record<string, string | number | undefined>) => api.get<T>(`/insights/facts/${path}`, q);
const sinceMonth = (d: string | null | undefined) =>
  d ? `since ${new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}` : "none yet";
const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

type Kind = "customer" | "factory" | "user";

/**
 * Performance (design system: Record frame): how a customer, a supplier or a person has done, this year or
 * all time, from the Insights tables — the same figures Insights shows. For people who may see Insights.
 */
export async function PerformanceCard({
  kind,
  id,
  me,
  name,
  balances = true,
}: {
  kind: Kind;
  id: string;
  me: { permissions: Permission[] };
  name?: string;
  /** Show what is owed now (Still owed, To pay); off where the record's header already tells it. */
  balances?: boolean;
}) {
  if (!can(me, "reports.view") || !(await hasFeature("insights"))) return null;
  const today = companyToday();
  const yearFrom = `${today.slice(0, 4)}-01-01`;
  // A person's spending, for managers with expenses: Spent, Profit after all costs, Owed back.
  const spend = kind === "user" && can(me, "expenses.manage") && (await hasFeature("expenses"));
  // Insights could not be read: the card says so, and the rest of the page works.
  const both = await part("the performance figures", () => Promise.all([figures(kind, id, { from: yearFrom, to: today }, today, spend), figures(kind, id, {}, today, spend)]));
  if (isFailed(both)) return <CouldNotLoad what={both.what} />;
  if (!both) return null;
  const [year, all] = balances ? both : both.map((f) => f.filter((t) => !t.now));
  const description =
    kind === "customer"
      ? "what they ordered, earned us and how they pay · from Reports"
      : kind === "factory"
        ? "what we bought, how they deliver and win our orders · from Reports"
        : "the inquiries they handle, how fast and how well they sell · from Reports";
  return (
    <PerformanceView
      title={name ? `Performance · ${name}` : "Performance"}
      description={description}
      year={year}
      all={all}
      yearLabel={today.slice(0, 4)}
    />
  );
}

async function figures(kind: Kind, id: string, span: { from?: string; to?: string }, today: string, spend = false): Promise<PerfFigure[]> {
  if (kind === "customer") {
    const [o, i, owed, last] = await Promise.all([
      facts<OrderGroups>("orders/groups", { ...span, period: "all", customerId: id }),
      facts<InquiryGroups>("inquiries/groups", { ...span, period: "all", customerId: id }),
      facts<Aging>("aging", { side: "receivable", customerId: id }),
      facts<FactOrders>("orders", { ...span, customerId: id, limit: 1 }),
    ]);
    const r = o.rows[0];
    const q = i.rows[0];
    const c = o.currency;
    const overdue = n(owed.d30) + n(owed.d60) + n(owed.d90) + n(owed.older);
    const late = r ? r.paid.inFull - r.paid.onTime : 0;
    return [
      { label: "Orders", value: String(r?.orders ?? 0), sub: r ? `first ${date(r.firstOrderedOn)}` : "none yet" },
      { label: "Sales", value: bigMoney(n(r?.sales), c), sub: r?.orders ? `avg ${bigMoney(n(r.sales) / r.orders, c)}` : "—" },
      { label: "Profit", value: bigMoney(n(r?.profitQuote), c), sub: `margin ${percent(r?.marginQuote)}` },
      {
        label: "Win rate",
        value: q && q.won + q.lost > 0 ? `${q.won} of ${q.won + q.lost}` : "—",
        sub: q ? `their inquiries · ${q.open} open` : "no inquiry yet",
      },
      {
        label: "Paid on time",
        value: percent(r?.paid.percent),
        sub: r?.paid.inFull ? (late ? plural(late, "late payment") : "every one") : "none paid in full yet",
      },
      {
        label: "Still owed",
        value: bigMoney(n(owed.total), c),
        sub: overdue > 0 ? `${bigMoney(overdue, c)} overdue` : "nothing overdue",
        meaning: overdue > 0 ? "bad" : undefined,
        now: true,
      },
      {
        label: "Last order",
        value: last.rows[0] ? date(last.rows[0].orderedOn) : "—",
        sub: last.rows[0]?.refNo ?? "none yet",
        href: last.rows[0] ? `/orders/${last.rows[0].orderId}` : undefined,
      },
      {
        label: "Days to pay",
        value: r?.daysToPay === null || r?.daysToPay === undefined ? "—" : String(Math.round(r.daysToPay)),
        sub: "on average, order to paid in full",
      },
    ];
  }
  if (kind === "factory") {
    const [f, last] = await Promise.all([
      facts<SupplierGroups>("factories/groups", { ...span, period: "all", by: "factory", supplierId: id }),
      facts<FactOrders>("orders", { ...span, supplierId: id, limit: 1 }),
    ]);
    const r = f.rows[0];
    const c = f.currency;
    const own = (k: "owed" | "toPay") => r?.own?.find((x) => x.currency !== c && n(x[k]) !== 0);
    const out: PerfFigure[] = [{ label: "Orders", value: String(r?.orders ?? 0), sub: sinceMonth(r?.firstOrderedOn) }];
    if (f.seeMoney) {
      const o = own("owed");
      out.push({
        label: "Spend",
        value: o ? bigMoney(n(o.owed), o.currency) : bigMoney(n(r?.spend), c),
        sub: o ? bigMoney(n(r?.spend), c) : "goods with tax",
      });
    }
    out.push(
      {
        label: "Ready on time",
        value: percent(r?.ready.percent),
        sub: r?.ready.known ? `${r.ready.onTime} of ${r.ready.known}` : "none ready yet",
      },
      {
        label: "Avg days late",
        value: r?.daysLateWhenLate === null || r?.daysLateWhenLate === undefined ? "0" : String(r.daysLateWhenLate),
        sub: "when late",
      },
      {
        label: "Offers won",
        value: r ? `${r.offersWon} of ${r.offersSent}` : "—",
        sub: r?.offersSent ? `${percent(Math.round((r.offersWon / r.offersSent) * 100))} of their offers` : "no offer yet",
      },
    );
    if (f.seeMoney) {
      const o = own("toPay");
      out.push({
        label: "To pay",
        value: o ? bigMoney(n(o.toPay), o.currency) : bigMoney(n(r?.toPay), c),
        sub: o ? bigMoney(n(r?.toPay), c) : "after factory-borne costs",
        now: true,
      });
    }
    out.push(
      { label: "Claims", value: String(r?.claims ?? 0), sub: "on their orders" },
      {
        label: "Last order",
        value: last.rows[0] ? date(last.rows[0].orderedOn) : "—",
        sub: last.rows[0]?.refNo ?? "none yet",
        href: last.rows[0] ? `/orders/${last.rows[0].orderId}` : undefined,
      },
    );
    return out;
  }
  const year = today.slice(0, 4);
  const [i, o, t, s] = await Promise.all([
    facts<InquiryGroups>("inquiries/groups", { ...span, period: "all", personId: id }),
    facts<OrderGroups>("orders/groups", { ...span, period: "all", personId: id }),
    span.from
      ? optional(() => api.get<{ targets: { month: string; userId: string; amount: string }[] }>("/insights/targets/people", { year }))
      : Promise.resolve(null),
    // Not theirs to see: left out; any other failure is the card's ("Could not load the performance figures").
    spend ? optional(() => api.get<PersonSpending>(`/people/${id}/spending`, { from: span.from ?? "2000-01-01", to: span.to ?? today })) : Promise.resolve(null),
  ]);
  const q = i.rows[0];
  const r = o.rows[0];
  const c = o.currency;
  const target = t ? t.targets.filter((x) => x.userId === id && x.month <= today.slice(0, 7)).reduce((s, x) => s + n(x.amount), 0) : 0;
  return [
    { label: "Inquiries", value: String(q?.inquiries ?? 0), sub: q ? `${q.open} open · ${q.won} won · ${q.lost} lost` : "none yet" },
    {
      label: "Days to first quotation",
      value: q?.medianDaysToFirstQuote === null || q?.medianDaysToFirstQuote === undefined ? "—" : String(q.medianDaysToFirstQuote),
      sub: "median, from the inquiry",
    },
    {
      label: "Win rate",
      value: percent(q?.winRate),
      sub: q && q.won + q.lost ? `${q.won} of ${q.won + q.lost} decided` : "none decided yet",
    },
    {
      label: target ? "Sales vs target" : "Sales",
      value: bigMoney(n(r?.sales), c),
      sub: target ? `${Math.round((n(r?.sales) / target) * 100)}% of ${bigMoney(target, c)} to date` : plural(r?.orders ?? 0, "order"),
    },
    { label: "Profit", value: bigMoney(n(r?.profitQuote), c), sub: `gross · margin ${percent(r?.marginQuote)}` },
    ...(s ? spendFigures(s, n(r?.sales), n(r?.profitQuote)) : []),
  ];
}

/** Spent, Profit after all costs (their orders' profit less what they spent outside orders) and Owed back, from their spending. */
function spendFigures(s: PersonSpending, sales: number, profit: number): PerfFigure[] {
  const c = s.currency;
  const spent = n(s.spent);
  const after = profit - n(s.outside);
  const owed = s.owed.rows.reduce((t, e) => t + n(e.inMain), 0);
  return [
    { label: "Spent", value: bigMoney(spent, c), sub: `${plural(s.count, "cost")}${sales > 0 ? ` · ${((spent / sales) * 100).toFixed(1)}% of sales` : ""}` },
    {
      label: "Profit after all costs",
      value: bigMoney(after, c),
      sub: `${sales > 0 ? `${((after / sales) * 100).toFixed(1)}% · ` : ""}less ${bigMoney(n(s.outside), c)} outside orders`,
      meaning: after < 0 ? "bad" : undefined,
    },
    { label: "Owed back", value: bigMoney(owed, c), sub: owed > 0 ? `their own money · ${plural(s.owed.rows.length, "cost")}` : "nothing owed", now: true },
  ];
}
