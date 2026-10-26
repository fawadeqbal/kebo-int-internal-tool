import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { finance, pipeline, rangeSummary, workload } from "@/modules/reports/repository";
import { resolveRange } from "@/modules/reports/range";
import { toCsv } from "@/lib/utils/csv";
import { profitReport } from "@/modules/reports/profit";
import type { ProfitGroup } from "@/modules/reports/profit-math";
import { getSettings } from "@/modules/settings/service";
import { formatDuration } from "@/lib/utils/dates";
import { isUuid } from "@/lib/utils/ids";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "reports.view")) return new Response("Forbidden", { status: 403 });
  const sp = new URL(request.url).searchParams;
  const range = resolveRange(sp.get("range") ?? undefined, sp.get("from") ?? undefined, sp.get("to") ?? undefined);
  const staff = sp.get("staff");
  const staffId = isUuid(staff) ? staff : undefined;
  const settings = await getSettings();
  const [summary, funnel, money, team, profit] = await Promise.all([
    rangeSummary(user, range, staffId),
    pipeline(user, range, staffId),
    finance(range),
    workload(range),
    profitReport(range, settings.currency, staffId),
  ]);
  const amt = (cents: number) => (cents / 100).toFixed(2);
  const pctCell = (m: number | null) => (m === null ? "" : `${m}%`);
  const group = (title: string, rows: ProfitGroup[]) => [
    [title, "Invoiced", "Our cost", "Profit", "Margin", ""],
    ...rows.map((g) => [g.key, amt(g.revenueCents), amt(g.costCents), g.costedRevenueCents > 0 ? amt(g.profitCents) : "", pctCell(g.marginPercent), ""]),
    [],
  ];
  const inv = profit.invoiced;

  const rows: (string | number | null)[][] = [
    ["Period", `${range.from} to ${range.to}`, "", "", "", ""],
    [],
    [`Profit (${settings.currency}, after discounts, before tax)`, ""],
    ["Invoiced", amt(inv.revenueCents)],
    ["Our cost (incl. VAT)", amt(inv.costCents)],
    ["Gross profit", amt(inv.profitCents)],
    ["Margin", pctCell(inv.marginPercent)],
    ["Invoiced with no recorded cost", amt(inv.uncostedRevenueCents)],
    ["Booked profit (accepted quotations)", amt(profit.booked.profitCents)],
    ["Profit waiting on customers (quotations sent)", amt(profit.waiting.profitCents)],
    [],
    ["Month", "Invoiced", "Our cost", "Profit", "Margin", ""],
    ...profit.trend.map((t) => [t.month, t.revenue.toFixed(2), t.cost.toFixed(2), t.profit.toFixed(2), pctCell(t.margin), ""]),
    [],
    ...group("Customer", profit.byCustomer),
    ...group("Factory", profit.byFactory),
    ...group("Category", profit.byCategory),
    ...group("Person", profit.byPerson),
    ["Summary", "", "", "", "", ""],
    ["Inquiries received", summary.received],
    ["Completed", summary.completed],
    ["Not completed", summary.notCompleted],
    ["Average turnaround", formatDuration(summary.avgTurnaroundMs)],
    ["Quoted", funnel.quoted],
    ["Customer accepted", funnel.accepted],
    ["Invoiced", funnel.invoiced],
    [],
    ["Money", ""],
    ["Quotations sent", money.quotedSent],
    ["Quotations accepted", money.quotedAccepted],
    ["Invoiced", money.invoiced],
    ["Payments received", money.received],
    ["Outstanding (today)", money.outstanding],
    ["Overdue (today)", money.overdue],
    [],
    ["Staff", "Open", "Overdue", "Completed", "Not completed", "Avg. completion time"],
    ...team.map((p) => [p.name, p.open, p.overdue, p.completed, p.notCompleted, formatDuration(p.avgMs)]),
  ];
  const csv = toCsv(["Report", "Value", "", "", "", ""], rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="report-${range.from}-to-${range.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
