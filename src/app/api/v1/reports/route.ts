import { apiUser, handle, json, searchParams } from "@/lib/api/http";
import { isUuid } from "@/lib/utils/ids";
import { resolveRange } from "@/modules/reports/range";
import { breakdown, finance, monthlyTrend, pipeline, rangeSummary, statusCounts, workload } from "@/modules/reports/repository";

export const runtime = "nodejs";

/** ?range=this_month|last_month|…|custom&from&to&staff=<user id> — same figures as the Reports page. */
export const GET = handle(async (request: Request) => {
  const user = await apiUser("reports.view");
  const sp = searchParams(request);
  const range = resolveRange(sp.range, sp.from, sp.to);
  const staffId = isUuid(sp.staff) ? sp.staff : undefined;
  const [summary, counts, funnel, money, trend, bySource, byCategory, team] = await Promise.all([
    rangeSummary(user, range, staffId),
    statusCounts(user, staffId),
    pipeline(user, range, staffId),
    finance(range),
    monthlyTrend(user, 12, staffId),
    breakdown(user, range, "source", staffId),
    breakdown(user, range, "category", staffId),
    workload(range),
  ]);
  return json({ range, staffId: staffId ?? null, summary, counts, funnel, finance: money, trend, bySource, byCategory, team });
});
