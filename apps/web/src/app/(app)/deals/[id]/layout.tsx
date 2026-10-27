import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { can, CHANNEL_LABEL, LOST_REASON_LABEL } from "@kebo/shared";
import { buttonClass, PageHeader, PriorityBadge, StageBadge } from "@kebo/ui";
import { api } from "@/lib/api";
import { load, requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import { DealTabs } from "./tabs";

/** What the deal needs now, worked out from its stage (the same rules the API enforces). */
function guidance(d: DealDetail): { text: string; href?: string; label?: string } {
  const latest = d.quotation?.revisions[0];
  const order = d.orders.find((o) => o.status !== "cancelled");
  switch (d.stage) {
    case "new":
      return d.assignee ? { text: `${d.assignee.name} should start by getting factory prices.`, href: `/deals/${d.id}/sourcing`, label: "Add factory prices" } : { text: "Nobody handles this yet. Assign someone (or take it) so sourcing can start." };
    case "sourcing":
      return latest?.status === "draft"
        ? { text: `R${latest.number} is drafted. Check it and send it to the customer.`, href: `/deals/${d.id}/quotation`, label: "Open the quotation" }
        : { text: "Get prices from 2–3 factories, then make the quotation.", href: `/deals/${d.id}/sourcing`, label: "Factory prices" };
    case "quoted":
      return { text: latest?.validUntil ? `Waiting for the customer. R${latest.number} is valid until ${date(latest.validUntil)}: follow up, then record their answer.` : "Waiting for the customer: follow up and record their answer.", href: `/deals/${d.id}/quotation`, label: "Record the answer" };
    case "won":
      return order ? { text: `Won. The work continues on order ${order.refNo}.`, href: `/orders/${order.id}`, label: "Go to the order" } : { text: "Won." };
    case "lost":
      return { text: `Lost${d.lostReason ? `: ${LOST_REASON_LABEL[d.lostReason].toLowerCase()}` : ""}.${d.allowed.reopen ? " A manager can reopen it." : ""}` };
  }
}

export default async function DealLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const d = await load(() => api.get<DealDetail>(`/inquiries/${id}`));
  const g = guidance(d);
  const order = d.orders.find((o) => o.status !== "cancelled");
  return (
    <div>
      <PageHeader
        backHref="/deals"
        backLabel="Deals"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {d.refNo} <StageBadge stage={d.stage} onHold={d.onHold} /> <PriorityBadge priority={d.priority} />
          </span>
        }
        description={
          <>
            <span className="font-medium text-text">{d.title}</span> ·{" "}
            <Link href={`/customers/${d.customer.id}`} className="hover:underline">
              {d.customer.name}
            </Link>{" "}
            · {CHANNEL_LABEL[d.channel]} · {d.category}
            {d.requiredBy && <> · needed by {date(d.requiredBy)}</>}
          </>
        }
        actions={
          d.allowed.edit ? (
            <Link href={`/deals/${d.id}/edit`} className={buttonClass("secondary", "sm")}>
              Edit details
            </Link>
          ) : undefined
        }
      />
      <section aria-label="What next" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary-soft/50 p-4">
        <p className="flex items-center gap-2 text-sm">
          <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden />
          {g.text}
        </p>
        {g.href && (
          <Link href={g.href} className={buttonClass("primary", "sm")}>
            {g.label}
          </Link>
        )}
      </section>
      {d.customer.country === "ZZ" && (
        <p className="mb-4 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm">
          This customer&apos;s country is not set.{" "}
          <Link href={`/customers/${d.customer.id}/edit`} className="font-medium underline">
            Add it
          </Link>{" "}
          — it decides shipping.
        </p>
      )}
      <DealTabs
        id={d.id}
        source={can(me, "sourcing.manage")}
        orderId={order?.id ?? null}
        files={d.attachments.length + d.notes.length}
        managers={can(me, "expenses.manage")}
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
