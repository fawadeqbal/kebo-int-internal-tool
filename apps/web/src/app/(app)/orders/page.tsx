import Link from "next/link";
import { AlertTriangle, Lock } from "lucide-react";
import { ORDER_STAGE_LABEL, ORDER_STAGES, type OrderStage } from "@kebo/shared";
import { Card, EmptyState, LinkTabs, OrderStageBadge, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import type { OrderRow } from "@/lib/types";

export const metadata = { title: "Orders" };

const BOARD: OrderStage[] = ["awaiting_deposit", "in_production", "ready_to_ship", "shipped"];

/** Open orders as a board by stage, each with its next step; late ones stand out. */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireUser();
  const { view } = await searchParams;
  const status = view === "closed" ? "closed" : view === "cancelled" ? "cancelled" : "open";
  const mine = view === "mine";
  const rows = await api.get<OrderRow[]>("/orders", { status, mine: mine ? "true" : undefined });
  const tabs = [
    { href: "/orders", label: "All open", active: !view },
    { href: "/orders?view=mine", label: "Mine", active: mine },
    { href: "/orders?view=closed", label: "Closed", active: view === "closed" },
    { href: "/orders?view=cancelled", label: "Cancelled", active: view === "cancelled" },
  ];
  return (
    <div>
      <PageHeader title="Orders" description="Every confirmed order and the one thing it needs next." />
      <LinkTabs label="Which orders" tabs={tabs} className="mb-5" />
      {rows.length === 0 ? (
        <EmptyState title="No orders here" description="An order appears when a customer accepts a quotation." />
      ) : status === "open" ? (
        <div className="grid gap-4 lg:grid-cols-4">
          {BOARD.map((stage) => {
            const col = rows.filter((r) => r.stage === stage);
            return (
              <section key={stage} aria-label={ORDER_STAGE_LABEL[stage]} className="flex flex-col gap-3">
                <h2 className="flex items-center justify-between text-sm font-semibold">
                  {ORDER_STAGE_LABEL[stage]} <span className="text-xs font-normal text-muted">{col.length}</span>
                </h2>
                {col.map((o) => (
                  <OrderCard key={o.id} o={o} />
                ))}
                {col.length === 0 && <p className="rounded-lg border border-dashed border-line p-3 text-xs text-muted">Nothing here</p>}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((o) => (
            <OrderCard key={o.id} o={o} />
          ))}
        </div>
      )}
      <p className="mt-6 text-xs text-muted">Stages: {ORDER_STAGES.map((s) => ORDER_STAGE_LABEL[s]).join(" → ")}</p>
    </div>
  );
}

function OrderCard({ o }: { o: OrderRow }) {
  return (
    <Link href={`/orders/${o.id}`}>
      <Card className={`p-3 transition-colors hover:border-line-strong ${o.overdue ? "border-bad/40" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{o.refNo}</span>
          <OrderStageBadge stage={o.stage} />
        </div>
        <p className="mt-0.5 truncate text-sm">{o.customer.name}</p>
        <p className="truncate text-xs text-muted">{o.inquiry.title}</p>
        {o.next && (
          <div className={`mt-2 rounded-md px-2 py-1.5 text-xs ${o.next.overdue ? "bg-bad-soft text-bad" : "bg-surface-2 text-text-2"}`}>
            <span className="font-medium">Next: {o.next.title}</span>
            <span className="block">
              {o.next.overdue && <AlertTriangle className="mr-1 inline size-3" aria-hidden />}
              {o.next.due ? `${o.next.overdue ? "was due" : "due"} ${date(o.next.due)}` : "no date yet"}
              {o.next.blockedBy && (
                <>
                  {" "}
                  · <Lock className="inline size-3" aria-hidden /> waiting
                </>
              )}
            </span>
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <div className="h-full bg-primary" style={{ width: `${(o.progress.done / o.progress.total) * 100}%` }} />
          </div>
          <span className="text-xs text-muted tabular">
            {o.progress.done}/{o.progress.total}
          </span>
          {o.inquiry.assignee && <span className="text-xs text-muted">{o.inquiry.assignee.name}</span>}
        </div>
      </Card>
    </Link>
  );
}
