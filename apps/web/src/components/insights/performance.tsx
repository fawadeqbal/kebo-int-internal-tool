import { can, type Permission } from "@kebo/shared";
import { api } from "@/lib/api";
import { bigMoney, percent } from "@/lib/insights-period";
import { hasFeature } from "@/lib/session";
import type { InquiryGroups, OrderGroups } from "@/lib/types-facts";
import { PerformanceView, type PerfFigure } from "./performance-view";

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";
const facts = <T,>(path: string, q: Record<string, string | number | undefined>) => api.get<T>(`/insights/facts/${path}`, q);
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

type Kind = "user";

/**
 * Performance on a person's page: how they have done, this year or all time, from the Reports tables (the same
 * figures Reports shows). For people who may see Reports. Customers and factories show theirs in their tiles
 * and on their Payments and Profit tabs.
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
  return (
    <PerformanceView
      title={name ? `Performance · ${name}` : "Performance"}
      description="Inquiries they handle, and the sales orders won"
      year={year}
      all={all}
      yearLabel={today.slice(0, 4)}
    />
  );
}

async function figures(kind: Kind, id: string, span: { from?: string; to?: string }, today: string): Promise<PerfFigure[]> {
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
      sub: target ? `${Math.round((n(r?.sales) / target) * 100)}% of ${bigMoney(target, c)} to date` : plural(r?.orders ?? 0, "sales order"),
    },
    { label: "Quoted profit", value: bigMoney(n(r?.profitQuote), c), sub: `margin ${percent(r?.marginQuote)}` },
  ];
}
