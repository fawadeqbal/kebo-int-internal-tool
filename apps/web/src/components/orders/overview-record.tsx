import Link from "next/link";
import { Check } from "lucide-react";
import { INSTALMENT_STATUS_LABEL, ORDER_STAGE_LABEL, ORDER_STAGES, type InstalmentStatus, type OrderStage } from "@kebo/shared";
import { Badge, Card, CardHeader, cn } from "@kebo/ui";
import { date, money } from "@/lib/format";
import type { OrderMoney } from "@/lib/types-money";
import { RecordPaymentLink, ViewPaymentsLink } from "@/components/money/pay-links";

/**
 * The order's Overview as an ERP record (step 5): the status bar, the payment plan block and the linked
 * documents. Each shows what its owning page gives it: the plan comes from Billing (each instalment an
 * invoice with its payment request number), payments are listed only under Treasury › Payments.
 */

/** Confirmed › In production › Shipped › Done › Closed, the current one filled. */
export function OrderStatusBar({ stage, status }: { stage: OrderStage; status: string }) {
  const steps = [...ORDER_STAGES.map((s) => ({ key: s as string, label: ORDER_STAGE_LABEL[s] })), { key: "closed", label: "Closed" }];
  const at = status === "closed" ? steps.length - 1 : ORDER_STAGES.indexOf(stage);
  return (
    <ol aria-label="Status" className="flex flex-wrap overflow-hidden rounded-lg border border-line bg-surface">
      {steps.map((s, i) => (
        <li
          key={s.key}
          aria-current={i === at ? "step" : undefined}
          className={cn(
            "flex h-8 items-center gap-1.5 border-r border-line px-3.5 text-[13px] font-medium last:border-r-0",
            i < at ? "text-text-2" : i === at ? "bg-primary-soft font-semibold text-primary" : "text-muted",
          )}
        >
          {i < at && <Check className="size-3.5 text-ok" aria-hidden />}
          {s.label}
          {i < at && <span className="sr-only"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}

const TONE: Record<InstalmentStatus, "ok" | "info" | "warn" | "bad" | "neutral"> = {
  paid: "ok",
  part_paid: "info",
  due_soon: "warn",
  late: "bad",
  open: "neutral",
};

/**
 * The payment plan, read-only (decided 11 Nov): each instalment with its number, amount, due date and
 * where it stands, and one Record payment. The plan is changed on the Payment tab.
 */
export function PlanBlock({ m, base, canRecord }: { m: OrderMoney; base: string; canRecord: boolean }) {
  const p = m.plan;
  return (
    <Card>
      <CardHeader
        title="Payment plan"
        actions={
          <Link href={`${base}/payment`} className="text-sm font-medium text-primary hover:underline">
            {p.canEdit ? "Change the plan" : "Payment terms"}
          </Link>
        }
      />
      {p.items.length ? (
        <ul className="divide-y divide-line">
          {p.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{i.label}</span>
                <span className="block text-xs text-muted">
                  {i.number} · {i.dueOn ? `due ${date(i.dueOn)}` : (i.when ?? i.rule ?? "no date yet")}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-right tabular">
                  {money(i.amount, m.currency)}
                  {i.status !== "paid" && Number(i.paid) > 0 && (
                    <span className="block text-xs text-muted">{money(i.open, m.currency)} open</span>
                  )}
                </span>
                <Badge tone={TONE[i.status]}>{INSTALMENT_STATUS_LABEL[i.status]}</Badge>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted">No instalments yet.</p>
      )}
      {!p.matchesTotal && (
        <p className="border-t border-line bg-warn-soft px-4 py-2 text-xs">
          The instalments do not add up to the order ({money(p.difference, m.currency)} apart). Fix it on the Payment tab.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
        <span className="text-sm text-text-2">
          Still due <b className="font-semibold text-text tabular">{money(m.due, m.currency)}</b>
          {Number(m.chargedTotal) > 0 && <span className="text-xs text-muted"> · with {money(m.chargedTotal, m.currency)} charged</span>}
        </span>
        <span className="flex flex-wrap items-center gap-3">
          <ViewPaymentsLink order={m.orderId} />
          {canRecord && Number(m.due) > 0 && (
            <RecordPaymentLink kind="in" order={m.orderId} amount={p.next?.open} back={base} quiet={false} />
          )}
        </span>
      </div>
    </Card>
  );
}

/** The documents this one came from and led to, as links (familiar ERP "linked documents"). */
export function LinkedDocuments({ links }: { links: { kind: string; label: string; href: string }[] }) {
  return (
    <Card>
      <CardHeader title="Linked" />
      <nav aria-label="Linked documents" className="flex flex-wrap gap-2 p-4">
        {links.map((l) => (
          <Link
            key={`${l.kind}-${l.href}`}
            href={l.href}
            className="flex min-w-32 flex-col rounded-lg border border-line bg-surface px-3 py-1.5 hover:border-line-strong"
          >
            <span className="text-xs text-muted">{l.kind}</span>
            <span className="font-medium text-primary">{l.label}</span>
          </Link>
        ))}
      </nav>
    </Card>
  );
}
