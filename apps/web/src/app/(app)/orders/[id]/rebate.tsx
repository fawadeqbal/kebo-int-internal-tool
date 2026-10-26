"use client";

import { useState } from "react";
import { flushSync } from "react-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Checkbox, cn, Input } from "@kebo/ui";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import { date, money } from "@/lib/format";
import type { OrderTax } from "@/lib/types-orders";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;
type Field = "vatInvoiceReceivedOn" | "rebateFiledOn";

/**
 * One step of the rebate paperwork: ticking it sets today's date and saves,
 * the date can then be changed, unticking clears it.
 */
function Step({ field, label, saved, action, canEdit, today }: { field: Field; label: string; saved: string | null; action: Action; canEdit: boolean; today: string }) {
  const [value, setValue] = useState(saved ?? "");
  const id = `tax-${field}`;
  const save = (form: HTMLFormElement | null, v: string) => {
    flushSync(() => setValue(v));
    form?.requestSubmit();
  };
  if (!canEdit)
    return (
      <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span className={cn(saved ? "text-text" : "text-text-2")}>{label}</span>
        <span className={cn("text-xs tabular", saved ? "text-text-2" : "text-muted")}>{saved ? date(saved) : "Not yet"}</span>
      </div>
    );
  return (
    <ActionForm action={action} showSuccess={false} className="py-1">
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={value} />
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={id} className="flex items-center gap-2 text-sm">
          <Checkbox id={id} checked={!!value} onChange={(e) => save(e.currentTarget.form, e.currentTarget.checked ? today : "")} />
          {label}
        </label>
        {value && (
          <Input
            type="date"
            aria-label={`${label}: date`}
            className="h-8 w-36 text-xs tabular"
            max={today}
            value={value}
            onChange={(e) => e.currentTarget.value && save(e.currentTarget.form, e.currentTarget.value)}
          />
        )}
      </div>
    </ActionForm>
  );
}

/**
 * The export rebate of an order: how much should come back, and the two pieces
 * of paperwork (the factory's VAT invoice, then filing within 90 days of shipping).
 */
export function RebateCard({ tax, action, canEdit, today }: { tax: OrderTax; action: Action; canEdit: boolean; today: string }) {
  if (!tax.rebate.length && !tax.vatInvoiceReceivedOn && !tax.rebateFiledOn) return <p className="text-sm text-muted">No export rebate on this order</p>;
  return (
    <div className="flex flex-col gap-2">
      {tax.rebate.length > 0 && (
        <div>
          <p className="text-xs text-muted">Expected back</p>
          <p className="font-semibold tabular">{tax.rebate.map((r) => money(r.amount, r.currency)).join(" + ")}</p>
        </div>
      )}
      <div className="divide-y divide-line">
        {/* Remounted when the saved date changes, so the box shows what was saved. */}
        <Step key={`v-${tax.vatInvoiceReceivedOn}`} field="vatInvoiceReceivedOn" label="Factory's VAT invoice received" saved={tax.vatInvoiceReceivedOn} action={action} canEdit={canEdit} today={today} />
        <Step key={`r-${tax.rebateFiledOn}`} field="rebateFiledOn" label="Rebate filed" saved={tax.rebateFiledOn} action={action} canEdit={canEdit} today={today} />
      </div>
      {tax.deadline && !tax.rebateFiledOn && <p className="text-xs text-text-2">File by {date(tax.deadline)}</p>}
      {tax.needs && (
        <p className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-xs", tax.needs.late ? "bg-bad-soft text-bad" : "bg-surface-2 text-text")}>
          {tax.needs.late ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />}
          <span>
            <span className="font-medium">{tax.needs.title}</span>
            <span className="block">{tax.needs.late ? `Late — was due ${date(tax.needs.due)}` : `By ${date(tax.needs.due)}`}</span>
          </span>
        </p>
      )}
    </div>
  );
}
