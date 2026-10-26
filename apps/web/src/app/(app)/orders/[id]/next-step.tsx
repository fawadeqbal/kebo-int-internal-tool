import Link from "next/link";
import { buttonClass } from "@kebo/ui";
import type { PlannedStep } from "@kebo/shared";

/**
 * The button that does the next step: the form that records the real thing
 * (the step ticks itself), or the checklist for steps that are just a tick.
 */
export function NextStepActions({ orderId, step, canPay, canInvoice }: { orderId: string; step: PlannedStep; canPay: boolean; canInvoice: boolean }) {
  const base = `/orders/${orderId}`;
  const target: Record<PlannedStep["records"], { href: string; label: string; allowed: boolean }> = {
    invoice: { href: `${base}/invoices?new=proforma`, label: "Make the proforma invoice", allowed: canInvoice },
    payment_in: { href: `${base}/payments?new=in`, label: "Record the payment", allowed: canPay },
    payment_out: { href: `${base}/payments?new=out`, label: "Record the payment to the factory", allowed: canPay },
    factory_order: { href: `${base}/factory-orders?new=1`, label: "Place the factory order", allowed: true },
    ready_date: { href: `${base}/factory-orders`, label: "Record the factory's confirmation", allowed: true },
    shipment: { href: `${base}/shipments`, label: "Go to shipments", allowed: true },
    inspection: { href: `${base}#step-${step.key}`, label: "Record the inspection", allowed: true },
    note: { href: `${base}#step-${step.key}`, label: "Mark it done", allowed: true },
  };
  const t = target[step.records];
  if (!t.allowed) return <p className="text-sm text-muted">Waiting for accounts</p>;
  return (
    <Link href={t.href} className={buttonClass("primary")}>
      {t.label}
    </Link>
  );
}
