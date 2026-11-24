import type { ReactNode } from "react";

/**
 * The line under a payment plan, the customer's and a supplier's alike: what was agreed, what has moved, what is
 * left ("Order total · Received · Still due", "PO total · Paid · Still to pay").
 */
export function PlanTotals({ target, items }: { target: string; items: { label: string; value: string; after?: ReactNode }[] }) {
  return (
    <div data-target={target} className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 px-4 text-sm sm:px-3.5">
      {items.map((i) => (
        <span key={i.label} className="text-muted">
          {i.label} <span className="font-semibold text-text tabular">{i.value}</span>
          {i.after}
        </span>
      ))}
    </div>
  );
}
