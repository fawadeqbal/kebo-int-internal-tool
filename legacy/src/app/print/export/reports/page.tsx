import { requirePagePermission } from "@/lib/auth/session";
import { breakdown, finance, monthlyTrend, pipeline, rangeSummary, statusCounts, workload } from "@/modules/reports/repository";
import { PRESETS, resolveRange } from "@/modules/reports/range";
import { listActiveUsers } from "@/modules/users/repository";
import { getSettings } from "@/modules/settings/service";
import { SOURCE_LABEL } from "@/lib/labels";
import { formatDate, formatDuration } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";
import { profitReport } from "@/modules/reports/profit";
import type { ProfitGroup } from "@/modules/reports/profit-math";
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
  const settings = await getSettings();
  const [people, summary, counts, funnel, money, trend, bySource, byCategory, team, profit] = await Promise.all([
    listActiveUsers(),
    rangeSummary(user, range, staffId),
    statusCounts(user, staffId),
    pipeline(user, range, staffId),
    finance(range),
    monthlyTrend(user, 12, staffId),
    breakdown(user, range, "source", staffId),
    breakdown(user, range, "category", staffId),
    workload(range),
    profitReport(range, settings.currency, staffId),
  ]);
  const target = settings.defaultMarginPercent;
  const inv = profit.invoiced;
  const profitMax = Math.max(1, ...profit.trend.map((t) => Math.max(t.revenue, t.profit)));
  const marginCell = (m: number | null) => (m === null ? "—" : <span className={m < 0 ? "font-semibold text-red-700" : m < target ? "text-amber-700" : undefined}>{m}%</span>);
  const groupRows = (rows: ProfitGroup[]) =>
    rows.map((g) => [g.key, formatCents(g.revenueCents, c), g.costedRevenueCents > 0 ? formatCents(g.profitCents, c) : "No cost", marginCell(g.marginPercent)]);
  const groupColumns = (name: string) => [{ header: name }, { header: "Invoiced", align: "right" as const }, { header: "Profit", align: "right" as const }, { header: "Margin", align: "right" as const, className: "w-[16mm]" }];
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
      filters={
        (staffName ? `Inquiries and profit for ${staffName}'s inquiries. The Money table covers all customers.` : "All staff and all customers.") +
        ` Profit is after discounts and before tax; costs include the factory's VAT. Target margin ${target}%.`
      }
      generatedAt={generatedNow()}
      generatedBy={user.name}
      kpis={[
        { label: "Gross profit", value: formatCents(inv.profitCents, c), hint: inv.marginPercent === null ? "No costs yet" : `${inv.marginPercent}% margin`, tone: inv.profitCents < 0 ? "bad" : "ok" },
        { label: "Invoiced", value: formatCents(inv.revenueCents, c), hint: `${inv.documents} ${inv.documents === 1 ? "invoice" : "invoices"} · cost ${formatCents(inv.costCents, c)}` },
        { label: "Booked profit", value: formatCents(profit.booked.profitCents, c), hint: `${profit.booked.documents} accepted ${profit.booked.documents === 1 ? "quotation" : "quotations"}` },
        { label: "Waiting on customers", value: formatCents(profit.waiting.profitCents, c), hint: `${profit.waiting.documents} ${profit.waiting.documents === 1 ? "quotation" : "quotations"} sent` },
        { label: "Inquiries received", value: summary.received, hint: `${summary.completed} completed · ${counts.overdue} overdue now`, tone: counts.overdue ? "bad" : undefined },
      ]}
    >
      {(inv.uncostedRevenueCents !== 0 || profit.otherCurrencyInvoices > 0) && (
        <p className="mb-4 rounded border border-stone-300 bg-stone-50 px-3 py-2 text-[9pt] text-stone-700">
          {inv.uncostedRevenueCents !== 0 &&
            `${formatCents(inv.uncostedRevenueCents, c)} of what was invoiced has no recorded cost (freight, inspection, items priced by hand) and is not counted in the profit${inv.coveragePercent !== null ? ` (${inv.coveragePercent}% of revenue is costed)` : ""}. `}
          {profit.otherCurrencyInvoices > 0 && `${profit.otherCurrencyInvoices} invoice(s) in other currencies are left out of the profit figures.`}
        </p>
      )}

      <ReportSection title={`Profit per month (${c})`} description="Last 12 months: invoiced after discounts, cost incl. VAT, gross profit">
        <ReportTable
          columns={[
            { header: "Month", className: "w-[18mm]" },
            { header: "Invoiced", align: "right", className: "w-[26mm]" },
            { header: "Our cost", align: "right", className: "w-[26mm]" },
            { header: "Profit", align: "right", className: "w-[26mm]" },
            { header: "" },
            { header: "Margin", align: "right", className: "w-[14mm]" },
          ]}
          rows={profit.trend.map((t) => [
            t.label,
            formatMoney(t.revenue, c).replace(`${c} `, ""),
            formatMoney(t.cost, c).replace(`${c} `, ""),
            <span key="p" className={t.profit < 0 ? "font-semibold text-red-700" : undefined}>{formatMoney(t.profit, c).replace(`${c} `, "")}</span>,
            <Bar key="b" value={Math.max(0, t.profit)} max={profitMax} className="bg-emerald-600" />,
            marginCell(t.margin),
          ])}
          footer={[
            "12 months",
            formatMoney(profit.trend.reduce((s, t) => s + t.revenue, 0), c).replace(`${c} `, ""),
            formatMoney(profit.trend.reduce((s, t) => s + t.cost, 0), c).replace(`${c} `, ""),
            formatMoney(profit.trend.reduce((s, t) => s + t.profit, 0), c).replace(`${c} `, ""),
            "",
            "",
          ]}
        />
      </ReportSection>

      <div className="grid grid-cols-2 gap-5">
        <ReportSection title="Profit by customer">
          <ReportTable empty="Nothing invoiced in this period." columns={groupColumns("Customer")} rows={groupRows(profit.byCustomer)} />
        </ReportSection>
        <ReportSection title="Profit by factory" description="On the goods bought from each factory">
          <ReportTable empty="Nothing invoiced in this period." columns={groupColumns("Factory")} rows={groupRows(profit.byFactory)} />
        </ReportSection>
        <ReportSection title="Profit by category">
          <ReportTable empty="Nothing invoiced in this period." columns={groupColumns("Category")} rows={groupRows(profit.byCategory)} />
        </ReportSection>
        <ReportSection title={staffName ? "Thinnest margins" : "Profit by person"} description={staffName ? "Invoices to look at" : "Who handled the inquiry"}>
          {staffName ? (
            <ReportTable
              empty="No costed invoices in this period."
              columns={[{ header: "Invoice" }, { header: "Customer" }, { header: "Profit", align: "right" }, { header: "Margin", align: "right", className: "w-[16mm]" }]}
              rows={profit.thinnest.map((d) => [d.no, d.customer, formatCents(d.profitCents, c), marginCell(d.marginPercent)])}
            />
          ) : (
            <ReportTable empty="Nothing invoiced in this period." columns={groupColumns("Person")} rows={groupRows(profit.byPerson)} />
          )}
        </ReportSection>
      </div>

      {!staffName && (
        <ReportSection title="Thinnest margins" description="Invoices to look at">
          <ReportTable
            empty="No costed invoices in this period."
            columns={[{ header: "Invoice", className: "w-[34mm]" }, { header: "Customer" }, { header: "Invoiced (costed)", align: "right" }, { header: "Profit", align: "right" }, { header: "Margin", align: "right", className: "w-[16mm]" }]}
            rows={profit.thinnest.map((d) => [d.no, d.customer, formatCents(d.costedRevenueCents, c), formatCents(d.profitCents, c), marginCell(d.marginPercent)])}
          />
        </ReportSection>
      )}
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
