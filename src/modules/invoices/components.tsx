"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Alert, Button, ButtonLink, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { LineItemsEditor, type EditableLine } from "@/components/documents/line-items-editor";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import type { ActionState } from "@/lib/utils/result";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function InvoiceForm({
  action,
  initial,
  currency,
  cancelHref,
}: {
  action: Action;
  initial: { items: EditableLine[]; discount: string; taxRate: string; issueDate: string; dueDate: string; notes: string };
  currency: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const e = state.errors ?? {};
  const v = (key: keyof typeof initial) => (state.values?.[key] as string | undefined) ?? (initial[key] as string);
  const items = state.values?.items ? (JSON.parse(state.values.items as string) as EditableLine[]) : initial.items;
  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.message && !state.ok && <Alert tone="error">{state.message}</Alert>}
      <Alert tone="info">Copied from the accepted quotation. Check it now: once issued, an invoice can only be cancelled, not edited.</Alert>
      <Card>
        <CardHeader title="Lines & totals" />
        <CardBody>
          <LineItemsEditor initialItems={items} initialDiscount={v("discount")} initialTaxRate={v("taxRate")} currency={currency} errors={e} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Dates" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Invoice date" htmlFor="issueDate" required error={e.issueDate}>
            <Input id="issueDate" name="issueDate" type="date" defaultValue={v("issueDate")} />
          </Field>
          <Field label="Payment due" htmlFor="dueDate" required error={e.dueDate}>
            <Input id="dueDate" name="dueDate" type="date" defaultValue={v("dueDate")} />
          </Field>
          <Field label="Note on invoice" htmlFor="notes" error={e.notes} hint="e.g. bank details for T/T, customer PO number" className="sm:col-span-2">
            <Textarea id="notes" name="notes" rows={2} className="min-h-0" defaultValue={v("notes")} />
          </Field>
        </CardBody>
      </Card>
      <div className="flex gap-3">
        <SubmitButton pendingText="Issuing…">Issue invoice</SubmitButton>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}

export function PaymentForm({ action, balance, today }: { action: Action; balance: string; today: string }) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  const e = state.errors ?? {};
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-3" noValidate>
      {state.message && <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <Field label="Amount received" htmlFor="amount" required error={e.amount} hint={`Balance due: ${balance}`}>
        <Input id="amount" name="amount" type="number" min="0" step="0.01" inputMode="decimal" />
      </Field>
      <div className="grid grid-cols-1 gap-3">
        <Field label="Date" htmlFor="paidAt" required error={e.paidAt}>
          <Input id="paidAt" name="paidAt" type="date" defaultValue={today} />
        </Field>
        <Field label="Method" htmlFor="method" required error={e.method}>
          <Select id="method" name="method" defaultValue="bank_transfer">
            {Object.entries(PAYMENT_METHOD_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Reference" htmlFor="reference" error={e.reference} hint="T/T reference, L/C number…">
        <Input id="reference" name="reference" />
      </Field>
      <div>
        <SubmitButton size="sm" pendingText="Recording…">
          Record payment
        </SubmitButton>
      </div>
    </form>
  );
}

export function CancelInvoiceForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button type="button" variant="ghost" size="sm" className="text-red-700" onClick={() => setOpen(true)}>
        Cancel invoice…
      </Button>
    );
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50/50 p-3">
      {state.message && !state.ok && <Alert tone="error">{state.message}</Alert>}
      <Field label="Reason for cancelling" htmlFor="reason" required error={state.errors?.reason}>
        <Textarea id="reason" name="reason" rows={2} className="min-h-0" autoFocus />
      </Field>
      <div className="flex gap-2">
        <SubmitButton size="sm" variant="danger" pendingText="Cancelling…">
          Cancel invoice
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
    </form>
  );
}
