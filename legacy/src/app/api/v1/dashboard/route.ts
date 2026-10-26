import { apiUser, handle, json } from "@/lib/api/http";
import { can } from "@/lib/auth/permissions";
import { todayISO } from "@/lib/utils/dates";
import { listQueries } from "@/modules/queries/repository";
import { expiringQuotations, finance, overdueQueries, rangeSummary, staleQueries, statusCounts, unpaidInvoices, workload } from "@/modules/reports/repository";
import { getSettings } from "@/modules/settings/service";

export const runtime = "nodejs";

const SAMPLE = 6;

/** The same cards as the web dashboard, scoped to the person's role. */
export const GET = handle(async () => {
  const user = await apiUser();
  const settings = await getSettings();
  const today = todayISO();
  const monthRange = { from: `${today.slice(0, 8)}01`, to: today };
  const isManager = can(user.role, "reports.view");
  const money = can(user.role, "invoices.manage");
  const [counts, month, fresh, overdue, stale, expiring, mine] = await Promise.all([
    statusCounts(user),
    rangeSummary(user, monthRange),
    listQueries(user, { status: "pending", sort: "newest", pageSize: SAMPLE }),
    overdueQueries(user, SAMPLE),
    staleQueries(user, settings.reminderPendingDays, SAMPLE),
    expiringQuotations(user, settings.reminderDueSoonDays, SAMPLE),
    listQueries(user, { status: "open", assignee: "me", sort: "required", pageSize: SAMPLE }),
  ]);
  const [fin, unpaid, team] = await Promise.all([money ? finance(monthRange) : null, money ? unpaidInvoices(SAMPLE) : [], isManager ? workload(monthRange) : []]);
  return json({
    currency: settings.currency,
    month: { ...monthRange, ...month },
    counts,
    newInquiries: fresh.rows,
    mine: mine.rows,
    overdue,
    stale,
    expiringQuotations: expiring,
    finance: fin,
    unpaidInvoices: unpaid,
    team,
    pendingDays: settings.reminderPendingDays,
  });
});
