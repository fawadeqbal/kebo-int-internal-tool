import { can, type Permission } from "@kebo/shared";
import { api } from "@/lib/api";
import { date, TZ, plural } from "@/lib/format";
import { bigMoney, percent } from "@/lib/insights-period";
import { hasFeature } from "@/lib/session";
import type { Aging, FactoryGroups, FactOrders, InquiryGroups, OrderGroups } from "@/lib/types-facts";
import { PerformanceView, type PerfFigure } from "./performance-view";

const facts = <T,>(path: string, q: Record<string, string | number | undefined>) => api.get<T>(`/insights/facts/${path}`, q);
const sinceMonth = (d: string | null | undefined) =>
  d ? `since ${new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}` : "none yet";
const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

type Kind = "customer" | "factory" | "user";

/**
 * Performance (design system: Record frame): how a customer, a factory or a person has done, this year or
 * all time, from the Insights tables — the same figures Insights shows. For people who may see Insights.
 */
export async function PerformanceCard({
  kind,
  id,
  me,
  name,
}: {
  kind: Kind;
  id: string;
  me: { permissions: Permission[] };
  name?: string;
}) {
  if (!can(me, "reports.view") || !(await hasFeature("insights"))) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const yearFrom = `${today.slice(0, 4)}-01-01`;
  // Insights unreachable: the page works without it.
  const both = await Promise.all([figures(kind, id, { from: yearFrom, to: today }, today), figures(kind, id, {}, today)]).catch(() => null);
  if (!both) return null;
  const [year, all] = both;
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

async function figures(kind: Kind, id: string, span: { from?: string; to?: string }, today: string): Promise<PerfFigure[]> {
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
      facts<FactoryGroups>("factories/groups", { ...span, period: "all", by: "factory", factoryId: id }),
      facts<FactOrders>("orders", { ...span, factoryId: id, limit: 1 }),
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
  const [i, o, t] = await Promise.all([
    facts<InquiryGroups>("inquiries/groups", { ...span, period: "all", personId: id }),
    facts<OrderGroups>("orders/groups", { ...span, period: "all", personId: id }),
    span.from
      ? api.get<{ targets: { month: string; userId: string; amount: string }[] }>("/insights/targets/people", { year }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const q = i.rows[0];
  const r = o.rows[0];
  const c = o.currency;
  const target = t ? t.targets.filter((x) => x.userId === id && x.month <= today.slice(0, 7)).reduce((s, x) => s + n(x.amount), 0) : 0;
  return [
    { label: "Inquiries", value: String(q?.inquiries ?? 0), sub: q ? `${q.open} open · ${q.won} won · ${q.lost} lost` : "none yet" },
    {
      label: "Days to first quote",
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
  ];
}
