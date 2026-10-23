import { requirePagePermission } from "@/lib/auth/session";
import { breakdown, finance, monthlyTrend, pipeline, rangeSummary, statusCounts, workload } from "@/modules/reports/repository";
import { PRESETS, resolveRange } from "@/modules/reports/range";
import { listActiveUsers } from "@/modules/users/repository";
import { getSettings } from "@/modules/settings/service";
import { SOURCE_LABEL } from "@/lib/labels";
import { formatDate, formatDuration } from "@/lib/utils/dates";
import { formatMoney, toCents } from "@/lib/utils/money";
import { isUuid } from "@/lib/utils/ids";
import type { QuerySource } from "@/lib/db/schema";
import { Bar, ReportSection, ReportSheet, ReportTable } from "@/components/documents/report-sheet";
import { generatedNow } from "../shared";

export const metadata = { title: "Business report" };

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

export default async function ReportExport({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string; staff?: string }> }) {
  const user = await requirePagePermission("reports.view");
  const sp = await searchParams;
  const range = resolveRange(sp.range, sp.from, sp.to);
  const staffId = isUuid(sp.staff) ? sp.staff : undefined;
  const [settings, people, summary, counts, funnel, money, trend, bySource, byCategory, team] = await Promise.all([
    getSettings(),
    listActiveUsers(),
    rangeSummary(user, range, staffId),
    statusCounts(user, staffId),
    pipeline(user, range, staffId),
    finance(range),
    monthlyTrend(user, 12, staffId),
    breakdown(user, range, "source", staffId),
    breakdown(user, range, "category", staffId),
    workload(range),
  ]);
  const c = settings.currency;
  const staffName = people.find((p) => p.id === staffId)?.name;
  const trendMax = Math.max(1, ...trend.map((t) => Math.max(t.received, t.completed)));
  const share = (rows: { n: number }[]) => rows.reduce((s, r) => s + r.n, 0);

  return (
    <ReportSheet
      settings={settings}
      title="Business report"
      kind={PRESETS[range.preset as keyof typeof PRESETS] ?? "Report"}
      period={`${formatDate(range.from)} – ${formatDate(range.to)}`}
      filters={staffName ? `Inquiries handled by ${staffName}. Money figures cover all customers.` : "All staff and all customers."}
      generatedAt={generatedNow()}
      generatedBy={user.name}
      kpis={[
        { label: "Inquiries received", value: summary.received },
        { label: "Completed", value: summary.completed, hint: `${pct(summary.completed, summary.received)} of received`, tone: "ok" },
        { label: "Not completed", value: summary.notCompleted },
        { label: "Avg. turnaround", value: formatDuration(summary.avgTurnaroundMs), hint: "Received → completed" },
        { label: "Open now", value: counts.pending + counts.processing, hint: `${counts.overdue} overdue`, tone: counts.overdue ? "bad" : undefined },
      ]}
    >
      <div className="grid grid-cols-2 gap-5">
        <ReportSection title="Conversion" description="Inquiries received in the period">
          <ReportTable
            columns={[{ header: "Stage" }, { header: "Count", align: "right", className: "w-[16mm]" }, { header: "Share", align: "right", className: "w-[14mm]" }]}
            rows={[
              ["Received", funnel.received, "100%"],
              ["Quoted", funnel.quoted, pct(funnel.quoted, funnel.received)],
              ["Customer accepted", funnel.accepted, pct(funnel.accepted, funnel.received)],
              ["Invoiced", funnel.invoiced, pct(funnel.invoiced, funnel.received)],
            ]}
          />
        </ReportSection>
        <ReportSection title={`Money (${c})`} description="Outstanding and overdue as of today">
          <ReportTable
            columns={[{ header: "Item" }, { header: "Amount", align: "right" }]}
            rows={[
              ["Quotations sent", formatMoney(money.quotedSent, c)],
              ["Quotations accepted", formatMoney(money.quotedAccepted, c)],
              ["Invoiced", formatMoney(money.invoiced, c)],
              ["Payments received", formatMoney(money.received, c)],
              ["Outstanding", formatMoney(money.outstanding, c)],
              ["Overdue", <span key="o" className={toCents(money.overdue) > 0 ? "font-semibold text-red-700" : undefined}>{formatMoney(money.overdue, c)}</span>],
            ]}
          />
        </ReportSection>
      </div>

      <ReportSection title="Inquiries per month" description="Last 12 months, received and completed">
        <ReportTable
          columns={[{ header: "Month", className: "w-[22mm]" }, { header: "Received", align: "right", className: "w-[18mm]" }, { header: "" }, { header: "Completed", align: "right", className: "w-[18mm]" }, { header: "" }]}
          rows={trend.map((t) => [
            t.label,
            t.received,
            <Bar key="r" value={t.received} max={trendMax} />,
            t.completed,
            <Bar key="c" value={t.completed} max={trendMax} className="bg-emerald-600" />,
          ])}
          footer={["Total", trend.reduce((s, t) => s + t.received, 0), "", trend.reduce((s, t) => s + t.completed, 0), ""]}
        />
      </ReportSection>

      <div className="grid grid-cols-2 gap-5">
        <ReportSection title="Where RFQs come from">
          <ReportTable
            empty="No inquiries in this period."
            columns={[{ header: "Channel" }, { header: "Inquiries", align: "right", className: "w-[18mm]" }, { header: "Share", align: "right", className: "w-[14mm]" }]}
            rows={bySource.map((s) => [SOURCE_LABEL[s.key as QuerySource] ?? s.key, s.n, pct(s.n, share(bySource))])}
          />
        </ReportSection>
        <ReportSection title="By sourcing category">
          <ReportTable
            empty="No inquiries in this period."
            columns={[{ header: "Category" }, { header: "Inquiries", align: "right", className: "w-[18mm]" }, { header: "Share", align: "right", className: "w-[14mm]" }]}
            rows={byCategory.map((s) => [s.key, s.n, pct(s.n, share(byCategory))])}
          />
        </ReportSection>
      </div>

      <ReportSection title="Staff performance" description="Open now, and closed in the period">
        <ReportTable
          columns={[
            { header: "Person" },
            { header: "Open", align: "right" },
            { header: "Overdue", align: "right" },
            { header: "Completed", align: "right" },
            { header: "Not completed", align: "right" },
            { header: "Avg. completion time", align: "right" },
          ]}
          rows={team.map((p) => [
            <span key="n" className={p.id === staffId ? "font-semibold text-stone-900" : undefined}>{p.name}</span>,
            p.open,
            <span key="o" className={p.overdue ? "font-semibold text-red-700" : undefined}>{p.overdue}</span>,
            p.completed,
            p.notCompleted,
            formatDuration(p.avgMs),
          ])}
          footer={["Team", team.reduce((s, p) => s + p.open, 0), team.reduce((s, p) => s + p.overdue, 0), team.reduce((s, p) => s + p.completed, 0), team.reduce((s, p) => s + p.notCompleted, 0), ""]}
        />
      </ReportSection>
    </ReportSheet>
  );
}
