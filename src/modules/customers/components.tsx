"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, ButtonLink, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import type { ActionState } from "@/lib/utils/result";

type Values = Partial<Record<"companyName" | "contactPerson" | "phone" | "email" | "address" | "taxNo" | "notes", string | null>>;
type Duplicate = { id: string; companyName: string | null; contactPerson: string; phone: string };

/** The customer fields, reused by the customer form and the "new customer" part of the query form. */
export function CustomerFields({ state, initial, prefix = "", compact = false }: { state: ActionState; initial?: Values; prefix?: string; compact?: boolean }) {
  const e = state.errors ?? {};
  const v = (key: keyof Values) => (state.values?.[key] as string | undefined) ?? initial?.[key] ?? "";
  const id = (key: string) => `${prefix}${key}`;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Full name" htmlFor={id("contactPerson")} required error={e.contactPerson}>
        <Input id={id("contactPerson")} name="contactPerson" defaultValue={v("contactPerson")} aria-invalid={!!e.contactPerson} autoComplete="name" />
      </Field>
      <Field label="Company" htmlFor={id("companyName")} error={e.companyName} hint="Optional">
        <Input id={id("companyName")} name="companyName" defaultValue={v("companyName")} aria-invalid={!!e.companyName} autoComplete="organization" />
      </Field>
      <Field label="Phone / WhatsApp" htmlFor={id("phone")} required error={e.phone} hint="With country code, e.g. +971 50 123 4567">
        <Input id={id("phone")} name="phone" type="tel" defaultValue={v("phone")} aria-invalid={!!e.phone} autoComplete="tel" />
      </Field>
      <Field label="Business email" htmlFor={id("email")} error={e.email}>
        <Input id={id("email")} name="email" type="email" defaultValue={v("email")} aria-invalid={!!e.email} autoComplete="email" />
      </Field>
      {!compact && (
        <>
          <Field label="Address / country" htmlFor={id("address")} error={e.address}>
            <Input id={id("address")} name="address" defaultValue={v("address")} autoComplete="street-address" />
          </Field>
          <Field label="Company registration / tax no." htmlFor={id("taxNo")} error={e.taxNo}>
            <Input id={id("taxNo")} name="taxNo" defaultValue={v("taxNo")} />
          </Field>
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
        <input type="checkbox" name="allowDuplicate" value="on" className="h-4 w-4 accent-brand-600" />
        It&apos;s a different customer — save anyway
      </label>
    </Alert>
  );
}

export function CustomerForm({
  action,
  initial,
  cancelHref,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: Values;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const e = state.errors ?? {};
  const duplicates = state.meta?.duplicates;
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.message && !duplicates && <Alert tone="error">{state.message}</Alert>}
      <DuplicateWarning state={state} />
      <CustomerFields state={state} initial={initial} />
      <Field label="Notes" htmlFor="notes" error={e.notes} hint="Only the team sees this, e.g. preferred trade terms, destination port">
        <Textarea id="notes" name="notes" rows={3} defaultValue={(state.values?.notes as string) ?? initial?.notes ?? ""} />
      </Field>
      <div className="flex gap-3 border-t border-line pt-5">
        <SubmitButton>{initial ? "Save changes" : "Add customer"}</SubmitButton>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
