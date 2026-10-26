import Link from "next/link";
import { AlertTriangle, ArrowRight, Lock } from "lucide-react";
import { BALANCE_TERMS_LABEL, can } from "@kebo/shared";
import { OrderStageBadge, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { load, requireUser } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { OrderView } from "@/lib/types";
import { OrderTabs } from "./tabs";
import { NextStepActions } from "./next-step";

/** Every order screen: who and what, the one thing to do next, and the tabs. */
export default async function OrderLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await load(() => api.get<OrderView>(`/orders/${id}`));
  const next = o.plan.next;
  const paid = o.customerPayments.settledMinor / 100;
  return (
    <div>
      <PageHeader
        backHref="/orders"
        backLabel="Orders"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {o.refNo} <OrderStageBadge stage={o.stage} />
          </span>
        }
        description={
          <>
            <Link href={`/customers/${o.customer.id}`} className="font-medium text-text hover:underline">
              {o.customer.name}
            </Link>{" "}
            · from deal{" "}
            <Link href={`/deals/${o.inquiry.id}`} className="hover:underline">
              {o.inquiry.refNo}
            </Link>{" "}
            · {o.inquiry.title}
            {o.inquiry.assignee && <> · handled by {o.inquiry.assignee.name}</>}
          </>
        }
      />

      {o.status === "cancelled" ? (
        <div className="mb-5 rounded-xl border border-line bg-surface-2 p-4 text-sm text-muted">This order was cancelled. The deal can be reopened and quoted again.</div>
      ) : next ? (
        <section aria-label="Next step" className={`mb-5 rounded-xl border p-4 ${next.overdue ? "border-bad/30 bg-bad-soft" : "border-primary/25 bg-primary-soft/50"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium tracking-wide text-muted uppercase">Next step</p>
              <p className="mt-0.5 flex items-center gap-2 text-base font-semibold">
                <ArrowRight className="size-4 text-primary" aria-hidden /> {next.title}
              </p>
              <p className={`mt-1 text-sm ${next.overdue ? "font-medium text-bad" : "text-text-2"}`}>
                {next.overdue && <AlertTriangle className="mr-1 inline size-4" aria-hidden />}
                {next.due ? (next.overdue ? `Late — was due ${date(next.due)}` : `Due ${date(next.due)}`) : "No due date yet"}
                {next.hint ? ` · ${next.hint}` : ""}
              </p>
              {next.blockedBy && (
                <p className="mt-1 flex items-center gap-1 text-sm text-warn">
                  <Lock className="size-3.5" aria-hidden /> {next.blockedBy.message}
                </p>
              )}
            </div>
            <NextStepActions orderId={o.id} step={next} canPay={can(me.role, "payments.record")} canInvoice={can(me.role, "invoices.manage")} />
          </div>
        </section>
      ) : (
        <div className="mb-5 rounded-xl border border-ok/30 bg-ok-soft p-4 text-sm font-medium">Every step is done. This order is closed.</div>
      )}

      <dl className="mb-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-surface p-3">
          <dt className="text-xs text-muted">Order total</dt>
          <dd className="mt-0.5 font-semibold tabular">{money(o.total, o.currency)}</dd>
          <dd className="text-xs text-muted">
            {o.incoterm}
            {o.incotermPlace ? ` ${o.incotermPlace}` : ""} · {o.depositPercent}% deposit
          </dd>
        </div>
        <div className="rounded-xl border border-line bg-surface p-3">
          <dt className="text-xs text-muted">Received</dt>
          <dd className="mt-0.5 font-semibold tabular">{money(paid, o.currency)}</dd>
          <dd className="text-xs text-muted">{money(o.customerPayments.outstandingMinor / 100, o.currency)} to come</dd>
        </div>
        <div className="rounded-xl border border-line bg-surface p-3">
          <dt className="text-xs text-muted">Payment terms</dt>
          <dd className="mt-0.5 font-medium">{BALANCE_TERMS_LABEL[o.balanceTerms]}</dd>
          <dd className="text-xs text-muted">Ordered {date(o.orderedOn)}</dd>
        </div>
        <div className="rounded-xl border border-line bg-surface p-3">
          <dt className="text-xs text-muted">Ship by</dt>
          <dd className="mt-0.5 font-medium">{o.shipBy ? date(o.shipBy) : "Not set"}</dd>
          <dd className="text-xs text-muted">{o.readyOn ? `Factory ready ${date(o.readyOn)}` : "Factory date not confirmed"}</dd>
        </div>
      </dl>

      <OrderTabs id={o.id} />
      <div className="mt-5">{children}</div>
    </div>
  );
}
