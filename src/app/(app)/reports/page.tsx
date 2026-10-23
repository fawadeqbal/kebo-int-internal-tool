import { AlertTriangle, Banknote, CheckCircle2, FileCheck2, FileText, Hourglass, Inbox, Receipt, Timer, Wallet, XCircle } from "lucide-react";
import { Download } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { breakdown, finance, monthlyTrend, pipeline, rangeSummary, statusCounts, workload } from "@/modules/reports/repository";
import { resolveRange } from "@/modules/reports/range";
import { ReportFilters } from "./filters";
import { listActiveUsers } from "@/modules/users/repository";
import { getSettings } from "@/modules/settings/service";
import { Avatar, buttonClass, Card, CardBody, CardHeader, PageHeader, Table, THead, Td, Th, Tr } from "@/components/ui";
import { PrintButton } from "@/components/ui/client";
import { BarList, Metric, StatCard } from "@/components/stats";
import { cn } from "@/lib/utils/cn";
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
    <div className="space-y-5">
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
            <a href={buildHref("/api/reports/export", params, {})} className={buttonClass("secondary", "sm")}>
              <Download aria-hidden /> Export CSV
            </a>
            <PrintButton label="Print / PDF" size="sm" variant="secondary" />
          </div>
        }
      />

      <Card className="no-print">
        <ReportFilters key={`${range.preset}${range.from}${range.to}${staffId}`} preset={range.preset} from={range.from} to={range.to} staffId={staffId} people={people} />
      </Card>

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Inquiries received" icon={Inbox} tone="primary" value={summary.received} />
        <StatCard label="Completed" icon={CheckCircle2} tone="ok" value={summary.completed} hint={pct(summary.completed, summary.received) + " of received"} />
        <StatCard label="Not completed" icon={XCircle} value={summary.notCompleted} hint="Closed without an order" />
        <StatCard label="Avg. turnaround" icon={Timer} tone="info" value={formatDuration(summary.avgTurnaroundMs)} hint="Received → completed" />
        <StatCard
          label="Open right now"
          icon={counts.overdue ? AlertTriangle : Hourglass}
          tone={counts.overdue ? "bad" : "neutral"}
          emphasis={counts.overdue > 0}
          value={counts.pending + counts.processing}
          hint={`${counts.overdue} overdue`}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Conversion" description="What happened to the inquiries received in this period" />
          <CardBody>
            <BarList
              items={[
                { label: "Received", value: funnel.received },
                { label: "Quoted", value: funnel.quoted, hint: pct(funnel.quoted, funnel.received) },
                { label: "Customer accepted", value: funnel.accepted, hint: pct(funnel.accepted, funnel.received) },
                { label: "Invoiced", value: funnel.invoiced, hint: pct(funnel.invoiced, funnel.received) },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Money" description="All customers in this period. Outstanding is as of today." />
          <CardBody className="divide-y divide-line py-1">
            <Metric icon={FileText} label="Quotations sent" value={formatMoney(money.quotedSent, settings.currency)} />
            <Metric icon={FileCheck2} label="Quotations accepted" value={formatMoney(money.quotedAccepted, settings.currency)} />
            <Metric icon={Receipt} label="Invoiced" value={formatMoney(money.invoiced, settings.currency)} />
            <Metric icon={Banknote} label="Payments received" value={formatMoney(money.received, settings.currency)} />
            <Metric
              icon={Wallet}
              label="Outstanding"
              value={formatMoney(money.outstanding, settings.currency)}
              sub={toCents(money.overdue) > 0 ? `${formatMoney(money.overdue, settings.currency)} overdue` : "Nothing overdue"}
              warn={toCents(money.overdue) > 0}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Inquiries per month" description="Received vs completed, last 12 months" />
        <CardBody>
          <TrendChart data={trend} />
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
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

      <Card className="overflow-hidden">
        <CardHeader title="Staff performance" description="Open now, and closed in this period" />
        <Table>
          <THead>
            <tr>
              <Th>Person</Th>
              <Th className="text-right">Open</Th>
              <Th className="text-right">Overdue</Th>
              <Th className="text-right">Completed</Th>
              <Th className="text-right">Not completed</Th>
              <Th className="text-right">Avg. completion time</Th>
            </tr>
          </THead>
          <tbody>
            {team.map((p) => (
              <Tr key={p.id} className={p.id === staffId ? "bg-primary-soft/50" : undefined}>
                <Td>
                  <span className="flex items-center gap-2 font-medium">
                    <Avatar name={p.name} size={24} />
                    {p.name}
                  </span>
                </Td>
                <Td className="text-right tabular">{p.open}</Td>
                <Td className={cn("text-right tabular", p.overdue > 0 && "font-semibold text-bad")}>{p.overdue}</Td>
                <Td className="text-right tabular">{p.completed}</Td>
                <Td className="text-right tabular">{p.notCompleted}</Td>
                <Td className="text-right text-text-2 tabular">{formatDuration(p.avgMs)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
