import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { InquiryStage, Priority } from "@kebo/shared";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, PriorityBadge, StageBadge } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { OrderRow, Person } from "@/lib/types";
import { Stat } from "@/components/common/stat";

export const metadata = { title: "Dashboard" };

interface DealLine {
  id: string;
  refNo: string;
  title: string;
  stage: InquiryStage;
  onHold: boolean;
  requiredBy: string | null;
  priority: Priority;
  customer: { id: string; name: string };
  assignee: Person | null;
}
interface Dashboard {
  today: string;
  counts: { new: number; sourcing: number; quoted: number; overdue: number; onHold: number; unassigned: number };
  todo: OrderRow[];
  myDeals: DealLine[];
  newDeals: DealLine[];
  expiringQuotes: { id: string; label: string; validUntil: string; total: string; currency: string; inquiry: { id: string; title: string; customer: { name: string } } }[];
  money: { currency: string; thisMonth: { quoted: string; won: string; received: string; paidToFactories: string }; now: { toReceive: string; owedToFactories: string; openOrders: number } } | null;
  workload: { id: string; name: string; openDeals: number; openOrders: number }[] | null;
}

function DealList({ rows, empty }: { rows: DealLine[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {rows.map((d) => (
        <li key={d.id}>
          <Link href={`/deals/${d.id}`} className="flex items-center gap-3 py-2.5 hover:text-primary">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {d.refNo} · {d.title}
              </p>
              <p className="truncate text-xs text-muted">
                {d.customer.name}
                {d.requiredBy ? ` · needed by ${date(d.requiredBy)}` : ""}
              </p>
            </div>
            <PriorityBadge priority={d.priority} />
            <StageBadge stage={d.stage} onHold={d.onHold} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage() {
  const me = await requireUser();
  const d = await api.get<Dashboard>("/dashboard");
  const cur = d.money?.currency ?? "USD";
  return (
    <div>
      <PageHeader title={`Good day, ${me.name.split(" ")[0]}`} description="What needs you today." />

      <section aria-label="Deals" className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="New" value={d.counts.new} hint={d.counts.unassigned ? `${d.counts.unassigned} not assigned` : "Not started"} href="/deals?stage=new" tone={d.counts.unassigned ? "warn" : undefined} />
        <Stat label="Sourcing" value={d.counts.sourcing} hint="Getting factory prices" href="/deals?stage=sourcing" />
        <Stat label="Quoted" value={d.counts.quoted} hint="Waiting for customers" href="/deals?stage=quoted" />
        <Stat label="Past needed-by" value={d.counts.overdue} href="/deals?stage=overdue" tone={d.counts.overdue ? "bad" : undefined} />
        <Stat label="On hold" value={d.counts.onHold} href="/deals?stage=on_hold" />
        <Stat label="Order steps to do" value={d.todo.length} hint={`${d.todo.filter((t) => t.next?.overdue).length} late`} href="/orders?view=mine" tone={d.todo.some((t) => t.next?.overdue) ? "bad" : undefined} />
      </section>

      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="My to-do" description="The next step of each order you handle, late ones first" />
          <CardBody>
            {d.todo.length === 0 ? (
              <EmptyState title="Nothing waiting" description="Order steps you handle will appear here." className="py-6" />
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {d.todo.map((t) => (
                  <li key={t.id}>
                    <Link href={`/orders/${t.id}`} className="flex items-center gap-3 py-2.5 hover:text-primary">
                      {t.next?.overdue ? <AlertTriangle className="size-4 shrink-0 text-bad" aria-hidden /> : <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{t.next?.title}</p>
                        <p className="truncate text-xs text-muted">
                          {t.refNo} · {t.customer.name}
                        </p>
                      </div>
                      <span className={`shrink-0 text-xs ${t.next?.overdue ? "font-medium text-bad" : "text-muted"}`}>{t.next?.due ? date(t.next.due) : "—"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="My open deals" description="Earliest needed-by first" />
          <CardBody>
            <DealList rows={d.myDeals} empty="No open deals assigned to you." />
          </CardBody>
        </Card>

        {d.newDeals.length > 0 && (
          <Card>
            <CardHeader title="New inquiries" description="Assign someone so sourcing can start" />
            <CardBody>
              <DealList rows={d.newDeals} empty="" />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Quotations about to expire" description="Follow up with the customer" />
          <CardBody>
            {d.expiringQuotes.length === 0 ? (
              <p className="text-sm text-muted">None in the next few days.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {d.expiringQuotes.map((q) => (
                  <li key={q.id}>
                    <Link href={`/deals/${q.inquiry.id}/quotation`} className="flex items-center gap-3 py-2.5 hover:text-primary">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {q.label} · {q.inquiry.customer.name}
                        </p>
                        <p className="truncate text-xs text-muted">{q.inquiry.title}</p>
                      </div>
                      <span className="text-xs tabular">{money(q.total, q.currency)}</span>
                      <span className={`text-xs ${q.validUntil < d.today ? "text-bad" : "text-muted"}`}>until {date(q.validUntil)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {d.money && (
        <section aria-label="Money" className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Quoted this month" value={money(d.money.thisMonth.quoted, cur)} />
          <Stat label="Won this month" value={money(d.money.thisMonth.won, cur)} tone="ok" />
          <Stat label="Received this month" value={money(d.money.thisMonth.received, cur)} />
          <Stat label="Paid to factories" value={money(d.money.thisMonth.paidToFactories, cur)} hint="this month, at today's rates" />
          <Stat label="To receive" value={money(d.money.now.toReceive, cur)} hint={`${d.money.now.openOrders} open orders`} />
          <Stat label="Owed to factories" value={money(d.money.now.owedToFactories, cur)} />
        </section>
      )}

      {d.workload && (
        <Card className="mt-5">
          <CardHeader title="Team" description="Open deals and orders per person" />
          <CardBody>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {d.workload.map((p) => (
                <li key={p.id}>
                  <Link href={`/deals?assignee=${p.id}`} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm hover:border-line-strong">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted">
                      {p.openDeals} deals · {p.openOrders} orders
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
