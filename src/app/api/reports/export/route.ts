import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { finance, pipeline, rangeSummary, workload } from "@/modules/reports/repository";
import { resolveRange } from "@/modules/reports/range";
import { toCsv } from "@/lib/utils/csv";
import { formatDuration } from "@/lib/utils/dates";
import { isUuid } from "@/lib/utils/ids";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "reports.view")) return new Response("Forbidden", { status: 403 });
  const sp = new URL(request.url).searchParams;
  const range = resolveRange(sp.get("range") ?? undefined, sp.get("from") ?? undefined, sp.get("to") ?? undefined);
  const staff = sp.get("staff");
  const staffId = isUuid(staff) ? staff : undefined;
  const [summary, funnel, money, team] = await Promise.all([rangeSummary(user, range, staffId), pipeline(user, range, staffId), finance(range), workload(range)]);

  const rows: (string | number | null)[][] = [
    ["Period", `${range.from} to ${range.to}`, "", "", "", ""],
    [],
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
