"use client";

import { useActionState } from "react";
import { Alert, ButtonLink, Card, CardBody, CardHeader, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { LineItemsEditor, type EditableLine } from "@/components/documents/line-items-editor";
import type { ActionState } from "@/lib/utils/result";
import type { QuotationStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils/cn";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function QuotationForm({
  action,
  initial,
  currency,
  cancelHref,
  submitLabel,
}: {
  action: Action;
  initial: { items: EditableLine[]; discount: string; taxRate: string; dueDate: string; submittedAt: string; terms: string; notes: string };
  currency: string;
  cancelHref: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const e = state.errors ?? {};
  const v = (key: keyof typeof initial) => (state.values?.[key] as string | undefined) ?? (initial[key] as string);
  const items = state.values?.items ? (JSON.parse(state.values.items as string) as EditableLine[]) : initial.items;
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.message && !state.ok && <Alert tone="error">{state.message}</Alert>}
      <Card>
        <CardHeader title="Prices" description="The customer's items are filled in: add the prices. Freight (CIF/DDP), inspection or spare parts go on their own lines." />
        <CardBody>
          <LineItemsEditor
            initialItems={items}
            initialDiscount={(state.values?.discount as string) ?? initial.discount}
            initialTaxRate={(state.values?.taxRate as string) ?? initial.taxRate}
            currency={currency}
            errors={e}
            sourceLabel="Requested by the customer"
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Dates & terms" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Valid until" htmlFor="dueDate" required error={e.dueDate} hint="The price holds until this date">
            <Input id="dueDate" name="dueDate" type="date" defaultValue={v("dueDate")} aria-invalid={!!e.dueDate} />
          </Field>
          <Field label="Sent to customer on" htmlFor="submittedAt" optional error={e.submittedAt} hint="Filled in when you mark it as sent">
            <Input id="submittedAt" name="submittedAt" type="date" defaultValue={v("submittedAt")} />
          </Field>
          <Field label="Terms & conditions" htmlFor="terms" optional error={e.terms} className="sm:col-span-2">
            <Textarea id="terms" name="terms" rows={5} defaultValue={v("terms")} />
          </Field>
          <Field label="Internal notes" htmlFor="notes" optional error={e.notes} hint="Not shown to the customer" className="sm:col-span-2">
            <Textarea id="notes" name="notes" rows={2} className="min-h-0" defaultValue={v("notes")} />
          </Field>
        </CardBody>
      </Card>
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{submitLabel}</SubmitButton>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}

export function QuotationStatusForm({
  action,
  transitions,
}: {
  action: Action;
  transitions: { to: QuotationStatus; label: string }[];
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.message && <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <div className="flex flex-wrap gap-2">
        {transitions.map((t) => (
          <SubmitButton
            key={t.to}
            name="status"
            value={t.to}
            size="sm"
            variant={t.to === "accepted" ? "primary" : t.to === "rejected" ? "danger-ghost" : "secondary"}
            className={cn(t.to === "rejected" && "border border-line")}
            pendingText={t.label}
          >
            {t.label}
          </SubmitButton>
        ))}
      </div>
    </form>
  );
}
