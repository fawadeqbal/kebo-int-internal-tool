import { Download } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { breakdown, finance, monthlyTrend, pipeline, rangeSummary, statusCounts, workload } from "@/modules/reports/repository";
import { resolveRange } from "@/modules/reports/range";
import { ReportFilters } from "./filters";
import { listActiveUsers } from "@/modules/users/repository";
import { getSettings } from "@/modules/settings/service";
import { buttonClass, Card, CardBody, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui";
import { PrintButton } from "@/components/ui/client";
import { BarList, StatTile } from "@/components/stats";
import { TrendChart } from "@/components/charts";
import { buildHref } from "@/components/ui/pagination";
import { SOURCE_LABEL } from "@/lib/labels";
import { formatDate, formatDuration } from "@/lib/utils/dates";
import { formatMoney, toCents } from "@/lib/utils/money";
import { isUuid } from "@/lib/utils/ids";
import type { QuerySource } from "@/lib/db/schema";

export const metadata = { title: "Reports" };

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string; staff?: string }> }) {
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
  const staffName = people.find((p) => p.id === staffId)?.name;
  const params = { range: range.preset, from: range.preset === "custom" ? range.from : undefined, to: range.preset === "custom" ? range.to : undefined, staff: staffId };

  return (
    <>
      <PageHeader
        title="Reports"
        description={
          <>
            {formatDate(range.from)} – {formatDate(range.to)}
            {staffName && ` · ${staffName}`}
          </>
        }
        actions={
          <div className="no-print flex gap-2">
            <a href={buildHref("/api/reports/export", params, {})} className={buttonClass("secondary")}>
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
            <PrintButton label="Print / PDF" />
          </div>
        }
      />

      <Card className="no-print mb-6">
        <ReportFilters key={`${range.preset}${range.from}${range.to}${staffId}`} preset={range.preset} from={range.from} to={range.to} staffId={staffId} people={people} />
      </Card>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Inquiries received" value={summary.received} />
        <StatTile label="Completed" value={summary.completed} tone="good" />
        <StatTile label="Not completed" value={summary.notCompleted} />
        <StatTile label="Avg. turnaround" value={formatDuration(summary.avgTurnaroundMs)} hint="Received → completed" />
        <StatTile label="Open right now" value={counts.pending + counts.processing} hint={`${counts.overdue} overdue`} tone={counts.overdue ? "alert" : "default"} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Conversion" description="What happened to the inquiries received in this period" />
          <CardBody>
            <BarList
              items={[
                { label: "Received", value: funnel.received },
                { label: "Quoted", value: funnel.quoted, hint: pct(funnel.quoted, funnel.received) },
                { label: "Buyer accepted", value: funnel.accepted, hint: pct(funnel.accepted, funnel.received) },
                { label: "Invoiced", value: funnel.invoiced, hint: pct(funnel.invoiced, funnel.received) },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Money" description="All buyers in this period. Outstanding is as of today." />
          <CardBody>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              {[
                ["Quotations sent", money.quotedSent],
                ["Quotations accepted", money.quotedAccepted],
                ["Invoiced", money.invoiced],
                ["Payments received", money.received],
                ["Outstanding", money.outstanding],
                ["Overdue", money.overdue],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
                  <dd className={`mt-1 text-lg font-semibold tabular-nums ${label === "Overdue" && toCents(value) > 0 ? "text-red-700" : ""}`}>{formatMoney(value, settings.currency)}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Inquiries per month" description="Received vs completed, last 12 months" />
        <CardBody>
          <TrendChart data={trend} />
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Where RFQs come from" />
          <CardBody>
            <BarList items={bySource.map((s) => ({ label: SOURCE_LABEL[s.key as QuerySource] ?? s.key, value: s.n }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="By sourcing category" />
          <CardBody>
            <BarList items={byCategory.map((s) => ({ label: s.key, value: s.n }))} />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Staff performance" description="Open now, and closed in this period" />
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th className="text-right">Open</Th>
              <Th className="text-right">Overdue</Th>
              <Th className="text-right">Completed</Th>
              <Th className="text-right">Not completed</Th>
              <Th className="text-right">Avg. completion time</Th>
            </tr>
          </thead>
          <tbody>
            {team.map((p) => (
              <tr key={p.id} className={p.id === staffId ? "bg-brand-50/50" : undefined}>
                <Td className="font-medium">{p.name}</Td>
                <Td className="text-right tabular-nums">{p.open}</Td>
                <Td className={`text-right tabular-nums ${p.overdue ? "font-semibold text-red-700" : ""}`}>{p.overdue}</Td>
                <Td className="text-right tabular-nums">{p.completed}</Td>
                <Td className="text-right tabular-nums">{p.notCompleted}</Td>
                <Td className="text-right tabular-nums">{formatDuration(p.avgMs)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
