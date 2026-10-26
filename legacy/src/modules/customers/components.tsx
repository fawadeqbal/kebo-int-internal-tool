"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, ButtonLink, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import type { ActionState } from "@/lib/utils/result";

type Values = Partial<Record<"companyName" | "contactPerson" | "phone" | "email" | "address" | "taxNo" | "notes", string | null>> & { vatExempt?: boolean };
type Duplicate = { id: string; companyName: string | null; contactPerson: string; phone: string };

/** The customer fields, reused by the customer form and the "new customer" part of the query form. */
export function CustomerFields({
  state,
  initial,
  prefix = "",
  compact = false,
  canSetVat = false,
}: {
  state: ActionState;
  initial?: Values;
  prefix?: string;
  compact?: boolean;
  /** Managers and the super admin can mark a customer VAT exempt. */
  canSetVat?: boolean;
}) {
  const e = state.errors ?? {};
  const v = (key: Exclude<keyof Values, "vatExempt">) => (state.values?.[key] as string | undefined) ?? initial?.[key] ?? "";
  const sentExempt = state.values?.vatExempt;
  const exempt = sentExempt !== undefined ? (Array.isArray(sentExempt) ? sentExempt.at(-1) : sentExempt) === "on" : (initial?.vatExempt ?? false);
  const id = (key: string) => `${prefix}${key}`;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Full name" htmlFor={id("contactPerson")} required error={e.contactPerson}>
        <Input id={id("contactPerson")} name="contactPerson" defaultValue={v("contactPerson")} aria-invalid={!!e.contactPerson} autoComplete="name" />
      </Field>
      <Field label="Company" htmlFor={id("companyName")} optional error={e.companyName}>
        <Input id={id("companyName")} name="companyName" defaultValue={v("companyName")} aria-invalid={!!e.companyName} autoComplete="organization" />
      </Field>
      <Field label="Phone / WhatsApp" htmlFor={id("phone")} required error={e.phone} hint="With country code, e.g. +971 50 123 4567">
        <Input id={id("phone")} name="phone" type="tel" defaultValue={v("phone")} aria-invalid={!!e.phone} autoComplete="tel" />
      </Field>
      <Field label="Business email" htmlFor={id("email")} optional error={e.email}>
        <Input id={id("email")} name="email" type="email" defaultValue={v("email")} aria-invalid={!!e.email} autoComplete="email" />
      </Field>
      {!compact && (
        <>
          <Field label="Address / country" htmlFor={id("address")} optional error={e.address}>
            <Input id={id("address")} name="address" defaultValue={v("address")} autoComplete="street-address" />
          </Field>
          <Field label="Company registration / tax no." htmlFor={id("taxNo")} optional error={e.taxNo}>
            <Input id={id("taxNo")} name="taxNo" defaultValue={v("taxNo")} />
          </Field>
          {canSetVat && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 text-sm text-text-2 hover:bg-surface-2 has-[:checked]:border-primary/40 has-[:checked]:bg-primary-soft/40 has-[:checked]:text-text sm:col-span-2">
              <input type="hidden" name="vatExempt" value="off" />
              <input type="checkbox" name="vatExempt" defaultChecked={exempt} className="mt-0.5 size-4 accent-[var(--primary-solid)]" />
              <span>
                <span className="block font-medium text-text">VAT exempt</span>
                <span className="block text-xs text-muted">Their quotations and invoices carry no VAT, e.g. export customers.</span>
              </span>
            </label>
          )}
        </>
      )}
    </div>
  );
}

export function DuplicateWarning({ state }: { state: ActionState }) {
  const duplicates = state.meta?.duplicates as Duplicate[] | undefined;
  if (!duplicates?.length) return null;
  return (
    <Alert tone="warning">
      <p className="font-medium">This customer may already exist:</p>
      <ul className="mt-2 space-y-1">
        {duplicates.map((d) => (
          <li key={d.id}>
            <Link href={`/customers/${d.id}`} target="_blank" className="font-medium underline">
              {d.companyName || d.contactPerson}
            </Link>{" "}
            — {d.contactPerson}, {d.phone}
          </li>
        ))}
      </ul>
      <label className="mt-3 flex items-center gap-2">
        <input type="checkbox" name="allowDuplicate" value="on" className="size-4 accent-[var(--primary-solid)]" />
        It&apos;s a different customer — save anyway
      </label>
    </Alert>
  );
}

export function CustomerForm({
  action,
  initial,
  cancelHref,
  canSetVat = false,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: Values;
  cancelHref: string;
  canSetVat?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const e = state.errors ?? {};
  const duplicates = state.meta?.duplicates;
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.message && !duplicates && <Alert tone="error">{state.message}</Alert>}
      <DuplicateWarning state={state} />
      <CustomerFields state={state} initial={initial} canSetVat={canSetVat} />
      <Field label="Notes" htmlFor="notes" optional error={e.notes} hint="Only the team sees this, e.g. preferred trade terms, destination port">
        <Textarea id="notes" name="notes" rows={3} defaultValue={(state.values?.notes as string) ?? initial?.notes ?? ""} />
      </Field>
      <div className="flex gap-2 border-t border-line pt-4">
        <SubmitButton>{initial ? "Save changes" : "Add customer"}</SubmitButton>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
