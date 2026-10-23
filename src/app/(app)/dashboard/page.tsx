import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import {
  expiringQuotations,
  finance,
  overdueQueries,
  rangeSummary,
  staleQueries,
  statusCounts,
  unpaidInvoices,
  workload,
} from "@/modules/reports/repository";
import { listQueries } from "@/modules/queries/repository";
import { getSettings } from "@/modules/settings/service";
import { invoiceDisplayStatus } from "@/modules/invoices/status";
import { Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import { InvoiceStatusBadge, PriorityBadge, QueryStatusBadge } from "@/components/ui/badge";
import { StatTile } from "@/components/stats";
import { Badge } from "@/components/ui/badge";
import { SOURCE_LABEL } from "@/lib/labels";
import { formatDate, formatDateTime, formatDuration, todayISO } from "@/lib/utils/dates";
import { formatCents, formatMoney, toCents } from "@/lib/utils/money";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const settings = await getSettings();
  const today = todayISO();
  const monthRange = { from: `${today.slice(0, 8)}01`, to: today };
  const isManager = can(user.role, "reports.view");
  const money = can(user.role, "invoices.manage");

  const [counts, month, fresh, overdue, stale, expiring, mine] = await Promise.all([
    statusCounts(user),
    rangeSummary(user, monthRange),
    listQueries(user, { status: "pending", sort: "newest", pageSize: 6 }),
    overdueQueries(user),
    staleQueries(user, settings.reminderPendingDays),
    expiringQuotations(user, settings.reminderDueSoonDays),
    listQueries(user, { status: "open", assignee: "me", sort: "required", pageSize: 8 }),
  ]);
  const [fin, unpaid, team] = await Promise.all([
    money ? finance(monthRange) : null,
    money ? unpaidInvoices() : [],
    isManager ? workload(monthRange) : [],
  ]);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: process.env.APP_TIME_ZONE ?? "Asia/Shanghai" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${today}T00:00:00Z`))}
          {!isManager && " · showing work assigned to you or created by you"}
        </p>
      </header>

      <section aria-label="Work status" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Pending"
          value={counts.pending}
          href="/queries?status=pending"
          hint={isManager && counts.unassigned > 0 ? `${counts.unassigned} not assigned yet` : "Not started yet"}
          tone={isManager && counts.unassigned > 0 ? "alert" : "default"}
        />
        <StatTile label="Processing" value={counts.processing} href="/queries?status=processing" hint="Being worked on" />
        <StatTile label="Completed" value={month.completed} href="/queries?status=completed" tone="good" hint="This month" />
        <StatTile label="Not completed" value={month.notCompleted} href="/queries?status=not_completed" hint="This month" />
        <StatTile label="Overdue" value={counts.overdue} href="/queries?status=overdue" tone={counts.overdue > 0 ? "alert" : "default"} hint="Past required-by date" />
      </section>

      {fin && (
        <section aria-label="Money this month" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Quotations sent · this month" size="sm" value={formatMoney(fin.quotedSent, settings.currency)} hint={`Accepted: ${formatMoney(fin.quotedAccepted, settings.currency)}`} href="/quotations" />
          <StatTile label="Invoiced · this month" size="sm" value={formatMoney(fin.invoiced, settings.currency)} href="/invoices" />
          <StatTile label="Received · this month" size="sm" value={formatMoney(fin.received, settings.currency)} tone="good" href="/invoices?status=paid" />
          <StatTile
            label="Outstanding now" size="sm"
            value={formatMoney(fin.outstanding, settings.currency)}
            tone={toCents(fin.overdue) > 0 ? "alert" : "default"}
            hint={toCents(fin.overdue) > 0 ? `Overdue: ${formatMoney(fin.overdue, settings.currency)}` : "Nothing overdue"}
            href="/invoices?status=outstanding"
          />
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="New queries"
            description="Received and not started yet — newest first"
            actions={<Link href="/queries?status=pending" className="text-sm text-brand-700 hover:underline">View all</Link>}
          />
          {fresh.rows.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">No new queries waiting.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {fresh.rows.map((q) => (
                <li key={q.id}>
                  <Link href={`/queries/${q.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{q.title}</span>
                      <span className="text-xs text-muted">
                        {q.refNo} · {q.companyName} · {formatDateTime(q.createdAt)}
                      </span>
                    </span>
                    {q.source === "website" ? <Badge tone="violet">Website</Badge> : <span className="text-xs text-muted">{SOURCE_LABEL[q.source]}</span>}
                    {!q.assigneeName && <span className="text-xs font-medium text-amber-700">Unassigned</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="My open work" description="Assigned to you, earliest deadline first" actions={<Link href="/queries?status=open&assignee=me" className="text-sm text-brand-700 hover:underline">View all</Link>} />
          {mine.rows.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Nothing assigned to you right now.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {mine.rows.map((q) => (
                <li key={q.id}>
                  <Link href={`/queries/${q.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{q.title}</span>
                      <span className="text-xs text-muted">
                        {q.refNo} · {q.companyName}
                        {q.requiredBy && ` · by ${formatDate(q.requiredBy)}`}
                      </span>
                    </span>
                    <PriorityBadge priority={q.priority} />
                    <QueryStatusBadge status={q.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Needs attention" description="Overdue work and queries waiting too long to start" />
          {overdue.length === 0 && stale.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">All clear — nothing overdue or waiting too long.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {overdue.map((q) => (
                <li key={q.id}>
                  <Link href={`/queries/${q.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{q.title}</span>
                      <span className="text-xs text-muted">
                        {q.refNo} · {q.companyName} · {q.assigneeName ?? "Unassigned"}
                      </span>
                    </span>
                    <span className="text-right text-xs font-semibold text-red-700">
                      Overdue
                      <span className="block font-normal">due {formatDate(q.requiredBy)}</span>
                    </span>
                  </Link>
                </li>
              ))}
              {stale.map((q) => (
                <li key={q.id}>
                  <Link href={`/queries/${q.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{q.title}</span>
                      <span className="text-xs text-muted">
                        {q.refNo} · {q.companyName} · {q.assigneeName ?? "Unassigned"}
                      </span>
                    </span>
                    <span className="text-right text-xs font-semibold text-amber-700">
                      Pending
                      <span className="block font-normal">since {formatDate(q.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Quotations awaiting reply" description={`Sent, due within ${settings.reminderDueSoonDays} days or already past due`} actions={<Link href="/quotations?status=expiring" className="text-sm text-brand-700 hover:underline">View all</Link>} />
          {expiring.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">No quotations close to their due date.</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {expiring.map((q) => (
                <li key={q.id}>
                  <Link href={`/quotations/${q.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas/60">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{q.refNo}</span>
                      <span className="text-xs text-muted">{q.companyName}</span>
                    </span>
                    <span className="text-right text-sm tabular-nums">
                      {formatMoney(q.total, settings.currency)}
                      <span className={`block text-xs ${q.dueDate < today ? "font-semibold text-red-700" : "text-muted"}`}>due {formatDate(q.dueDate)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {money && (
          <Card>
            <CardHeader title="Unpaid invoices" description="Earliest due date first" actions={<Link href="/invoices?status=outstanding" className="text-sm text-brand-700 hover:underline">View all</Link>} />
            {unpaid.length === 0 ? (
              <CardBody>
                <p className="text-sm text-muted">Every invoice is paid.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-line">
                {unpaid.map((inv) => (
                  <li key={inv.id}>
                    <Link href={`/invoices/${inv.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas/60">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{inv.invoiceNo}</span>
                        <span className="text-xs text-muted">
                          {inv.companyName} · due {formatDate(inv.dueDate)}
                        </span>
                      </span>
                      <span className="text-sm font-medium tabular-nums">{formatCents(toCents(inv.total) - toCents(inv.amountPaid), settings.currency)}</span>
                      <InvoiceStatusBadge status={invoiceDisplayStatus(inv, today)} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {isManager && team.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Team workload" description="Open work per person, and what they closed this month" actions={<Link href="/reports" className="text-sm text-brand-700 hover:underline">Full report</Link>} />
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th className="text-right">Open</Th>
                <Th className="text-right">Overdue</Th>
                <Th className="text-right">Completed (month)</Th>
                <Th className="text-right">Avg. completion time</Th>
              </tr>
            </thead>
            <tbody>
              {team.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link href={`/queries?status=open&assignee=${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                  </Td>
                  <Td className="text-right tabular-nums">{p.open}</Td>
                  <Td className={`text-right tabular-nums ${p.overdue > 0 ? "font-semibold text-red-700" : ""}`}>{p.overdue}</Td>
                  <Td className="text-right tabular-nums">{p.completed}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(p.avgMs)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
