import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Banknote, CheckCircle2, Clock, FileCheck2, FileText, Hourglass, Inbox, Receipt, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { expiringQuotations, finance, overdueQueries, rangeSummary, staleQueries, statusCounts, unpaidInvoices, workload } from "@/modules/reports/repository";
import { listQueries } from "@/modules/queries/repository";
import { getSettings } from "@/modules/settings/service";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { Avatar, Card, CardBody, CardHeader, PageHeader, Table, THead, Td, Th, Tr } from "@/components/ui";
import { Badge, InvoiceStatusBadge, PriorityBadge, QueryStatusBadge } from "@/components/ui/badge";
import { Metric, Queue, StatCard } from "@/components/stats";
import { SOURCE_LABEL } from "@/lib/labels";
import { formatDate, formatDuration, timeAgo, todayISO } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Dashboard" };

const SAMPLE = 6;

function ViewAll({ href, label = "View all" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="text-xs font-medium text-primary hover:underline">
      {label}
    </Link>
  );
}

/** One linked row in a dashboard card. */
function Row({ href, title, sub, end }: { href: string; title: ReactNode; sub: ReactNode; end?: ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/70">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text">{title}</span>
          <span className="block truncate text-xs text-muted">{sub}</span>
        </span>
        {end && <span className="flex shrink-0 items-center gap-1.5">{end}</span>}
      </Link>
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <CardBody>
      <p className="text-sm text-muted">{children}</p>
    </CardBody>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const settings = await getSettings();
  const today = todayISO();
  const monthRange = { from: `${today.slice(0, 8)}01`, to: today };
  const isManager = can(user.role, "reports.view");
  const money = can(user.role, "invoices.manage");
  const now = new Date();

  const [counts, month, fresh, overdue, stale, expiring, mine] = await Promise.all([
    statusCounts(user),
    rangeSummary(user, monthRange),
    listQueries(user, { status: "pending", sort: "newest", pageSize: 6 }),
    overdueQueries(user, SAMPLE),
    staleQueries(user, settings.reminderPendingDays, SAMPLE),
    expiringQuotations(user, settings.reminderDueSoonDays, SAMPLE),
    listQueries(user, { status: "open", assignee: "me", sort: "required", pageSize: 6 }),
  ]);
  const [fin, unpaid, team] = await Promise.all([money ? finance(monthRange) : null, money ? unpaidInvoices(SAMPLE) : [], isManager ? workload(monthRange) : []]);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: process.env.APP_TIME_ZONE ?? "Asia/Shanghai" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const cur = settings.currency;
  const overdueMoney = fin ? toCents(fin.overdue) > 0 : false;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${greeting}, ${user.name.split(" ")[0]}`}
        description={
          <>
            {new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${today}T00:00:00Z`))}
            {!isManager && " · your inquiries only"}
          </>
        }
      />

      <section aria-label="Work status" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          label="Waiting to start"
          icon={Inbox}
          tone={counts.pending > 0 ? "warn" : "neutral"}
          emphasis={isManager && counts.unassigned > 0}
          value={counts.pending}
          hint={isManager && counts.unassigned > 0 ? `${counts.unassigned} not assigned` : "Pending"}
          href="/queries?status=pending"
        />
        <StatCard label="In progress" icon={Hourglass} tone="info" value={counts.processing} hint="Sourcing and quoting" href="/queries?status=processing" />
        <StatCard
          label="Overdue"
          icon={AlertTriangle}
          tone={counts.overdue > 0 ? "bad" : "neutral"}
          emphasis={counts.overdue > 0}
          value={counts.overdue}
          hint="Past the needed-by date"
          href="/queries?status=overdue"
        />
        <StatCard label="Completed this month" icon={CheckCircle2} tone="ok" value={month.completed} hint={`${month.notCompleted} closed without an order`} href="/queries?status=completed" />
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {fin && (
          <Card className="overflow-hidden">
            <CardHeader title="Money · this month" description={`In ${cur}`} actions={<ViewAll href="/invoices" label="Invoices" />} />
            <CardBody className="divide-y divide-line py-1">
              <Metric icon={FileText} label="Quotations sent" value={formatMoney(fin.quotedSent, cur)} href="/quotations" />
              <Metric icon={FileCheck2} label="Accepted by customers" value={formatMoney(fin.quotedAccepted, cur)} href="/quotations?status=accepted" />
              <Metric icon={Receipt} label="Invoiced" value={formatMoney(fin.invoiced, cur)} href="/invoices" />
              <Metric icon={Banknote} label="Received" value={formatMoney(fin.received, cur)} href="/invoices?status=paid" />
              <Metric
                icon={Wallet}
                label="Outstanding now"
                value={formatMoney(fin.outstanding, cur)}
                sub={overdueMoney ? `${formatMoney(fin.overdue, cur)} overdue` : "Nothing overdue"}
                warn={overdueMoney}
                href="/invoices?status=outstanding"
              />
            </CardBody>
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardHeader title="Needs someone" description="Work queues across the team" />
          <CardBody className="space-y-2">
            {isManager && <Queue href="/queries?status=pending" label="Inquiries not assigned" count={counts.unassigned} />}
            <Queue href="/queries?status=overdue" label="Past the needed-by date" count={counts.overdue} danger />
            <Queue href="/queries?status=pending" label={`Pending more than ${settings.reminderPendingDays} ${settings.reminderPendingDays === 1 ? "day" : "days"}`} count={stale.length} more={stale.length >= SAMPLE} />
            <Queue href="/quotations?status=expiring" label="Quotations about to expire" count={expiring.length} more={expiring.length >= SAMPLE} />
            {money && <Queue href="/invoices?status=outstanding" label="Invoices waiting for payment" count={unpaid.length} more={unpaid.length >= SAMPLE} />}
          </CardBody>
        </Card>

        <Card className={cn("overflow-hidden", !fin && "lg:col-span-2")}>
          <CardHeader title="My open work" description="Assigned to you, earliest needed-by date first" actions={<ViewAll href="/queries?status=open&assignee=me" />} />
          {mine.rows.length === 0 ? (
            <Empty>Nothing assigned to you right now.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {mine.rows.map((q) => (
                <Row
                  key={q.id}
                  href={`/queries/${q.id}`}
                  title={q.title}
                  sub={
                    <>
                      {q.companyName}
                      {q.requiredBy && ` · needed ${formatDate(q.requiredBy)}`}
                    </>
                  }
                  end={
                    <>
                      {q.priority !== "normal" && <PriorityBadge priority={q.priority} />}
                      <QueryStatusBadge status={q.status} />
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="New inquiries" description="Not started yet, newest first" actions={<ViewAll href="/queries?status=pending" />} />
          {fresh.rows.length === 0 ? (
            <Empty>No new inquiries waiting.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {fresh.rows.map((q) => (
                <Row
                  key={q.id}
                  href={`/queries/${q.id}`}
                  title={q.title}
                  sub={`${q.companyName} · ${timeAgo(q.createdAt, now)}`}
                  end={
                    <>
                      {q.source === "website" ? <Badge tone="primary">Website</Badge> : <Badge tone="outline">{SOURCE_LABEL[q.source]}</Badge>}
                      {!q.assigneeName && <Badge tone="warn">Not assigned</Badge>}
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Needs attention" description="Past the needed-by date, or waiting too long to start" />
          {overdue.length === 0 && stale.length === 0 ? (
            <Empty>All clear. Nothing overdue or waiting too long.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {overdue.map((q) => (
                <Row
                  key={q.id}
                  href={`/queries/${q.id}`}
                  title={q.title}
                  sub={`${q.companyName} · ${q.assigneeName ?? "Not assigned"}`}
                  end={
                    <span className="text-right">
                      <Badge tone="bad">Overdue</Badge>
                      <span className="mt-0.5 block text-xs text-muted">needed {formatDate(q.requiredBy)}</span>
                    </span>
                  }
                />
              ))}
              {stale.map((q) => (
                <Row
                  key={q.id}
                  href={`/queries/${q.id}`}
                  title={q.title}
                  sub={`${q.companyName} · ${q.assigneeName ?? "Not assigned"}`}
                  end={
                    <span className="text-right">
                      <Badge tone="warn">Pending</Badge>
                      <span className="mt-0.5 block text-xs text-muted">since {formatDate(q.createdAt)}</span>
                    </span>
                  }
                />
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Waiting for the customer" description={`Quotations valid for ${settings.reminderDueSoonDays} more days or already expired`} actions={<ViewAll href="/quotations?status=expiring" />} />
          {expiring.length === 0 ? (
            <Empty>No quotations about to expire.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {expiring.map((q) => (
                <Row
                  key={q.id}
                  href={`/quotations/${q.id}`}
                  title={<span className="font-mono text-[13px]">{q.refNo}</span>}
                  sub={q.companyName}
                  end={
                    <span className="text-right">
                      <span className="block text-sm font-medium text-text tabular">{formatMoney(q.total, cur)}</span>
                      <span className={cn("block text-xs", q.dueDate < today ? "font-medium text-bad" : "text-muted")}>
                        <Clock className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                        valid until {formatDate(q.dueDate)}
                      </span>
                    </span>
                  }
                />
              ))}
            </ul>
          )}
        </Card>

        {money && (
          <Card className="overflow-hidden">
            <CardHeader title="Unpaid invoices" description="Earliest due date first" actions={<ViewAll href="/invoices?status=outstanding" />} />
            {unpaid.length === 0 ? (
              <Empty>Every invoice is paid.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {unpaid.map((inv) => (
                  <Row
                    key={inv.id}
                    href={`/invoices/${inv.id}`}
                    title={<span className="font-mono text-[13px]">{inv.invoiceNo}</span>}
                    sub={`${inv.companyName} · due ${formatDate(inv.dueDate)}`}
                    end={
                      <>
                        <span className="text-sm font-medium text-text tabular">{formatCents(toCents(inv.total) - toCents(inv.amountPaid), cur)}</span>
                        <InvoiceStatusBadge status={invoiceDisplayStatus(inv, today)} />
                      </>
                    }
                  />
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {isManager && team.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="Team workload" description="Open inquiries per person, and what they closed this month" actions={<ViewAll href="/reports" label="Full report" />} />
          <Table>
            <THead>
              <tr>
                <Th>Person</Th>
                <Th className="text-right">Open</Th>
                <Th className="text-right">Overdue</Th>
                <Th className="hidden text-right sm:table-cell">Completed this month</Th>
                <Th className="hidden text-right md:table-cell">Avg. completion time</Th>
              </tr>
            </THead>
            <tbody>
              {team.map((p) => (
                <Tr key={p.id} className="hover:bg-surface-2/70">
                  <Td>
                    <Link href={`/queries?status=open&assignee=${p.id}`} className="flex items-center gap-2 font-medium hover:text-primary">
                      <Avatar name={p.name} size={24} />
                      {p.name}
                    </Link>
                  </Td>
                  <Td className="text-right tabular">{p.open}</Td>
                  <Td className={cn("text-right tabular", p.overdue > 0 && "font-semibold text-bad")}>{p.overdue}</Td>
                  <Td className="hidden text-right tabular sm:table-cell">{p.completed}</Td>
                  <Td className="hidden text-right text-text-2 tabular md:table-cell">{formatDuration(p.avgMs)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
