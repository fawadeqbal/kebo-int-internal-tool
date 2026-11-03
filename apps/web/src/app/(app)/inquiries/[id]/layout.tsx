import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { can, CHANNEL_LABEL } from "@kebo/shared";
import { buttonClass, PriorityBadge, StageBadge } from "@kebo/ui";
import { requireUser, hasFeature } from "@/lib/session";
import { dealOf, sourcingOf } from "@/lib/deal-data";
import { StepNav } from "@/components/orders/step-nav";
import { inquirySteps } from "./steps";

/**
 * Every page of an inquiry shares one top: its number and stage, what it is,
 * the customer, how it came and who handles it, Edit details, and the
 * inquiry's navigation: Overview · 1 Needs · 2 Factory prices · 3 Quotation ·
 * Costs (managers) · History, then "Order →" once won.
 */
export default async function DealLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const d = await dealOf(id);
  const sourcing = can(me, "sourcing.manage");
  const offers = sourcing ? ((await sourcingOf(id).catch(() => null))?.quotes.length ?? 0) : null;
  const order = d.orders.find((o) => o.status !== "cancelled");
  const base = `/inquiries/${d.id}`;
  const managers = can(me, "expenses.manage") && (await hasFeature("expenses"));
  const meta = [
    d.title && <span key="t">{d.title}</span>,
    <Link key="c" href={`/customers/${d.customer.id}`} className="hover:underline">
      {d.customer.name}
    </Link>,
    <span key="ch">{CHANNEL_LABEL[d.channel]}</span>,
    d.assignee && <span key="a">{d.assignee.name}</span>,
  ].filter(Boolean);

  return (
    <div>
      <header className="flex flex-col gap-1">
        <Link href="/inquiries" className="inline-flex w-fit items-center gap-1 text-xs text-muted hover:text-text">
          <ArrowLeft className="size-3.5" aria-hidden /> Inquiries
        </Link>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold tracking-tight tabular sm:text-2xl">{d.refNo}</h1>
            <StageBadge stage={d.stage} onHold={d.onHold} />
            <PriorityBadge priority={d.priority} />
            <p className="min-w-0 basis-full text-sm text-text-2 sm:basis-auto">
              {meta.map((m, i) => (
                <span key={i}>
                  {i > 0 && (
                    <span aria-hidden className="px-1.5 text-muted">
                      ·
                    </span>
                  )}
                  {m}
                </span>
              ))}
            </p>
          </div>
          {d.allowed.edit && (
            <Link href={`${base}/edit`} className={buttonClass("secondary", "sm", "shrink-0 self-start max-sm:hidden")}>
              Edit details
            </Link>
          )}
        </div>
      </header>
      {d.customer.country === "ZZ" && (
        <p className="mt-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm">
          This customer&apos;s country is not set.{" "}
          <Link href={`/customers/${d.customer.id}/edit`} className="font-medium underline">
            Add it
          </Link>{" "}
          — it decides shipping.
        </p>
      )}
      <StepNav
        base={base}
        label="Inquiry steps"
        glance="The inquiry at a glance"
        steps={inquirySteps(d, offers).map((s) => ({ key: s.key, number: s.number, label: s.label, state: s.state, status: s.status, href: `${base}/${s.path}` }))}
        costs={managers ? {} : null}
        extra={order ? [{ href: `/orders/${order.id}`, label: "Order →" }] : []}
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
