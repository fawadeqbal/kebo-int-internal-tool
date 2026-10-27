import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { can, ORDER_STAGE_LABEL, type InquiryStage, type Priority } from "@kebo/shared";
import { Card, CardBody, CardHeader, cn, EmptyState, PageHeader, PriorityBadge, StageBadge } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { OrderRow } from "@/lib/types-orders";
import type { LeaksReport } from "@/lib/types-money";
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
  money: {
    currency: string;
    thisMonth: { quoted: string; won: string; received: string };
    now: { toReceive: string; openOrders: number; ordersByStage: { confirmed: number; in_production: number; shipped: number } };
  } | null;
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
  // Managers: what needs attention in money (this year).
  const leaks = can(me, "expenses.manage") ? await api.get<LeaksReport>("/reports/leaks").catch(() => null) : null;
  return (
    <div>
      <PageHeader title={`Good day, ${me.name.split(" ")[0]}`} description="What needs you today." />

      <section aria-label="Deals" className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="New" value={d.counts.new} hint={d.counts.unassigned ? `${d.counts.unassigned} not assigned` : "Not started"} href="/deals?stage=new" tone={d.counts.unassigned ? "warn" : undefined} />
        <Stat label="Sourcing" value={d.counts.sourcing} hint="Getting factory prices" href="/deals?stage=sourcing" />
        <Stat label="Quoted" value={d.counts.quoted} hint="Waiting for customers" href="/deals?stage=quoted" />
        <Stat label="Past needed-by" value={d.counts.overdue} href="/deals?stage=overdue" tone={d.counts.overdue ? "bad" : undefined} />
        <Stat label="On hold" value={d.counts.onHold} href="/deals?stage=on_hold" />
        <Stat label="My orders to act on" value={d.todo.length} hint={`${d.todo.filter((t) => t.needs?.late).length} late`} href="/orders?mine=1" tone={d.todo.some((t) => t.needs?.late) ? "bad" : undefined} />
      </section>

      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="My to-do" description="What each order you handle needs now, late ones first" />
          <CardBody>
            {d.todo.length === 0 ? (
              <EmptyState title="Nothing waiting" description="What your orders need will appear here." className="py-6" />
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {d.todo.map((t) => (
                  <li key={t.id}>
                    <Link href={`/orders/${t.id}`} className="flex items-center gap-3 py-2.5 hover:text-primary">
                      {t.needs?.late ? <AlertTriangle className="size-4 shrink-0 text-bad" aria-hidden /> : <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden />}
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-medium ${t.needs?.late ? "text-bad" : ""}`}>{t.needs?.title}</p>
                        <p className="truncate text-xs text-muted">
                          {t.refNo} · {t.customer.name} · {ORDER_STAGE_LABEL[t.stage]}
                        </p>
                      </div>
                      <span className={`shrink-0 text-xs ${t.needs?.late ? "font-medium text-bad" : "text-muted"}`}>{t.needs ? `${t.needs.late ? "was due " : ""}${date(t.needs.due)}` : "—"}</span>
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
        <section aria-label="Money" className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat label="Quoted this month" value={money(d.money.thisMonth.quoted, cur)} />
          <Stat label="Won this month" value={money(d.money.thisMonth.won, cur)} tone="ok" />
          <Stat label="Received this month" value={money(d.money.thisMonth.received, cur)} />
          <Stat label="To receive now" value={money(d.money.now.toReceive, cur)} hint={`On ${d.money.now.openOrders} open order${d.money.now.openOrders === 1 ? "" : "s"}, at today's rates`} />
          <Stat
            label="Open orders"
            value={d.money.now.openOrders}
            href="/orders"
            hint={(["confirmed", "in_production", "shipped"] as const).map((s) => `${d.money!.now.ordersByStage[s]} ${ORDER_STAGE_LABEL[s].toLowerCase()}`).join(" · ")}
          />
        </section>
      )}

      {leaks && leaks.warnings.length > 0 && (
        <Card className="mt-5">
          <CardHeader
            title="Money that needs attention"
            description={`${leaks.warnings.length} thing${leaks.warnings.length === 1 ? "" : "s"} this year`}
            actions={
              <Link href="/reports/money" className="text-sm text-primary hover:underline">
                Where we lose money
              </Link>
            }
          />
          <ul className="flex flex-col divide-y divide-line">
            {leaks.warnings.slice(0, 4).map((w, i) => (
              <li key={i}>
                <Link href={w.href ?? "/reports/money"} className="flex items-start gap-2.5 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                  <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", w.level === "bad" ? "text-bad" : "text-warn")} aria-hidden />
                  {w.text}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
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
