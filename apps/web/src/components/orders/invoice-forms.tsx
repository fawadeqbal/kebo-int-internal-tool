"use client";

import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import { InlineAction, type Action } from "./gate";

function DateFields({
  s,
  issueDate,
  dueDate,
  today,
  id,
}: {
  s: ActionState;
  issueDate?: string | null;
  dueDate?: string | null;
  today: string;
  id: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Issue date" htmlFor={`${id}-issue`} optional hint="The day you issue it when empty" error={s.errors?.issueDate}>
        <Input id={`${id}-issue`} name="issueDate" type="date" max={today} defaultValue={s.values?.issueDate ?? issueDate ?? ""} />
      </Field>
      <Field label="Due date" htmlFor={`${id}-due`} optional hint="From the payment terms when empty" error={s.errors?.dueDate}>
        <Input id={`${id}-due`} name="dueDate" type="date" defaultValue={s.values?.dueDate ?? dueDate ?? ""} />
      </Field>
    </div>
  );
}

/**
 * Make a draft invoice: the proforma (the whole order, asking for the deposit)
 * or a commercial invoice for one shipment.
 */
export function NewInvoiceForm({
  type,
  action,
  shipments,
  today,
  defaultOpen,
  disabledReason,
}: {
  type: "proforma" | "commercial";
  action: Action;
  /** Commercial: shipments with no live invoice yet. */
  shipments?: { id: string; label: string }[];
  today: string;
  defaultOpen?: boolean;
  disabledReason?: string | null;
}) {
  const [open, setOpen] = useState(!!defaultOpen && !disabledReason);
  const label = type === "proforma" ? "Make the proforma invoice" : "Make a commercial invoice";
  if (!open)
    return (
      <div className="flex flex-col items-start gap-1">
        <Button size="sm" variant={type === "proforma" ? "primary" : "secondary"} onClick={() => setOpen(true)} disabled={!!disabledReason}>
          {label}
        </Button>
        {disabledReason && <p className="text-xs text-muted">{disabledReason}</p>}
      </div>
    );
  return (
    <ActionForm
      action={action}
      onDone={() => setOpen(false)}
      className="flex w-full flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-card"
    >
      {(s) => (
        <>
          <input type="hidden" name="type" value={type} />
          <h3 className="text-sm font-semibold">
            {type === "proforma" ? "Proforma invoice for the whole order" : "Commercial invoice for a shipment"}
          </h3>
          <p className="text-xs text-muted">
            {type === "proforma"
              ? "Lists every line of the order and asks for the deposit. It is made as a draft; issuing it gives it a number and ticks “Proforma invoice sent”."
              : "Bills the goods packed on the shipment (the first one also carries the order's freight and service lines), with its share of any discount."}
          </p>
          {type === "commercial" && (
            <Field label="Shipment" htmlFor="inv-shipment" error={s.errors?.shipmentId}>
              <Select id="inv-shipment" name="shipmentId" defaultValue={s.values?.shipmentId ?? shipments?.[0]?.id ?? ""}>
                {shipments?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <DateFields s={s} today={today} id={`new-${type}`} />
          <Field label="Notes printed on the invoice" htmlFor={`new-${type}-notes`} optional error={s.errors?.notes}>
            <Textarea id={`new-${type}-notes`} name="notes" rows={2} className="min-h-0" defaultValue={s.values?.notes} />
          </Field>
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Making…">
              Make the draft
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** The buttons of one invoice: edit dates/notes and issue (drafts), void (managers). */
export function InvoiceActions({
  status,
  issueDate,
  dueDate,
  notes,
  today,
  update,
  issue,
  voidIt,
}: {
  status: "draft" | "issued" | "void";
  issueDate: string | null;
  dueDate: string | null;
  notes: string | null;
  today: string;
  update: Action | null;
  issue: Action | null;
  voidIt: Action | null;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {issue && status === "draft" && (
        <InlineAction
          label="Issue"
          variant="primary"
          action={issue}
          submitLabel="Issue the invoice"
          confirm="Issue this invoice? It gets its number and can no longer be edited."
        >
          {(s) => (
            <Field
              label="Issue date"
              htmlFor="inv-issue-on"
              optional
              hint="The issue date set on the draft, else today"
              error={s.errors?.on}
            >
              <Input id="inv-issue-on" name="on" type="date" max={today} defaultValue={s.values?.on} />
            </Field>
          )}
        </InlineAction>
      )}
      {update && status === "draft" && (
        <InlineAction label="Edit" action={update} submitLabel="Save">
          {(s) => (
            <>
              <DateFields s={s} issueDate={issueDate} dueDate={dueDate} today={today} id="edit-inv" />
              <Field label="Notes printed on the invoice" htmlFor="edit-inv-notes" optional>
                <Textarea id="edit-inv-notes" name="notes" rows={2} className="min-h-0" defaultValue={s.values?.notes ?? notes ?? ""} />
              </Field>
            </>
          )}
        </InlineAction>
      )}
      {voidIt && status !== "void" && (
        <InlineAction
          label={status === "draft" ? "Delete" : "Void"}
          variant="danger-ghost"
          action={voidIt}
          submitLabel={status === "draft" ? "Delete the draft" : "Void the invoice"}
          submitVariant="danger"
          confirm={
            status === "draft"
              ? "Delete this draft invoice?"
              : "Void this invoice? Its number is never reused; make a new one to replace it."
          }
        >
          {(s) => (
            <Field label="Why?" htmlFor="inv-void-reason" error={s.errors?.reason}>
              <Textarea id="inv-void-reason" name="reason" rows={2} className="min-h-0" defaultValue={s.values?.reason} />
            </Field>
          )}
        </InlineAction>
      )}
    </div>
  );
}
