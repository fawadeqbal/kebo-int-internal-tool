import Link from "next/link";
import { buildHref, Card, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import type { OrderGroups } from "@/lib/types-facts";
import { saveTargetRowAction } from "@/app/(app)/money/actions";
import { TargetsGrid, type TargetRow } from "./targets-grid";

/**
 * Reports › People & targets › Set targets: the company's and each person's monthly sales targets for a year, and how
 * each month went (sales from the Insights tables). Home and Reports measure against these.
 */
export async function TargetsView({ year, today, back }: { year: number; today: string; back: string }) {
  const [company, people, sold] = await Promise.all([
    api.get<{ month: string; amount: string }[]>("/insights/targets", { year }),
    api.get<{ people: { id: string; name: string }[]; targets: { month: string; userId: string; amount: string }[] }>(
      "/insights/targets/people",
      { year },
    ),
    api.get<OrderGroups>("/insights/facts/orders/groups", { from: `${year}-01-01`, to: `${year}-12-31`, period: "month" }),
  ]);
  const currency = sold.currency;
  const thisMonth = today.slice(0, 7);
  const rows: TargetRow[] = Array.from({ length: 12 }, (_, m) => {
    const month = `${year}-${String(m + 1).padStart(2, "0")}`;
    const values: Record<string, string> = { company: company.find((t) => t.month === month)?.amount ?? "" };
    for (const p of people.people) values[`p:${p.id}`] = people.targets.find((t) => t.month === month && t.userId === p.id)?.amount ?? "";
    const s = sold.rows.find((x) => x.period === month);
    const done = month <= thisMonth ? (s?.sales ?? "0.00") : null;
    const target = Number(values.company || 0);
    return {
      month,
      label: new Date(Date.UTC(year, m, 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }),
      values,
      sold: done,
      percent: done !== null && target > 0 ? Math.round((Number(done) / target) * 100) : null,
      current: month === thisMonth,
      past: month < thisMonth,
    };
  });
  return (
    <Card>
      <CardHeader
        title={`Targets ${year}`}
        description={`Monthly sales targets in ${currency}, for the company and each person. Home and Reports measure against these.`}
        actions={
          <span className="flex items-center gap-1">
            <Link
              href={buildHref("/reports/people/targets", {}, { year: String(year - 1) })}
              className="rounded-md px-2 py-1 text-xs text-text-2 hover:bg-surface-2"
            >
              ← {year - 1}
            </Link>
            <Link
              href={buildHref("/reports/people/targets", {}, { year: String(year + 1) })}
              className="rounded-md px-2 py-1 text-xs text-text-2 hover:bg-surface-2"
            >
              {year + 1} →
            </Link>
            <Link href={back} className="ml-1 rounded-md px-2 py-1 text-sm font-medium text-text-2 hover:bg-surface-2 hover:text-text">
              Done
            </Link>
          </span>
        }
      />
      <TargetsGrid
        rows={rows}
        people={people.people}
        currency={currency}
        actions={Object.fromEntries(rows.map((r) => [r.month, saveTargetRowAction.bind(null, r.month, r.values)]))}
      />
    </Card>
  );
}
