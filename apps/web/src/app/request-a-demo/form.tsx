"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Alert, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import type { LeadOrigin } from "@kebo/shared";
import { OriginFields } from "@/components/site/origin-fields";
import { requestDemoAction } from "./actions";

export function RequestDemoForm({ origin }: { origin: LeadOrigin }) {
  const [state, action] = useActionState(requestDemoAction, {});
  if (state.ok)
    return (
      <div className="mt-4 flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle2 className="size-10 text-ok" aria-hidden />
        <p className="text-sm">{state.message}</p>
      </div>
    );
  const v = state.values ?? {};
  return (
    <form action={action} className="mt-5 flex flex-col gap-4" noValidate>
      {state.message && <Alert tone="error">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" htmlFor="companyName" error={state.errors?.companyName}>
          <Input id="companyName" name="companyName" autoComplete="organization" required defaultValue={v.companyName} />
        </Field>
        <Field label="Your name" htmlFor="name" error={state.errors?.name}>
          <Input id="name" name="name" autoComplete="name" required defaultValue={v.name} />
        </Field>
        <Field label="Email" htmlFor="email" error={state.errors?.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={v.email} />
        </Field>
        <Field label="Phone / WhatsApp" htmlFor="phone" optional error={state.errors?.phone}>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={v.phone} />
        </Field>
        <Field label="Country" htmlFor="country" optional error={state.errors?.country}>
          <Input id="country" name="country" autoComplete="country-name" defaultValue={v.country} />
        </Field>
        <Field label="People in your team" htmlFor="teamSize" optional error={state.errors?.teamSize}>
          <Select id="teamSize" name="teamSize" defaultValue={v.teamSize ?? ""}>
            <option value="">Choose…</option>
            <option value="1-5">1 to 5</option>
            <option value="6-20">6 to 20</option>
            <option value="21-50">21 to 50</option>
            <option value="51+">More than 50</option>
          </Select>
        </Field>
      </div>
      <Field label="What would you like to see?" htmlFor="message" optional error={state.errors?.message}>
        <Textarea id="message" name="message" rows={4} defaultValue={v.message} placeholder="What you trade, how you handle RFQs today…" />
      </Field>
      {/* People never see or fill this; bots do. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      <OriginFields origin={origin} />
      <SubmitButton pendingText="Sending…" size="lg" className="w-full">
        Request a demo
      </SubmitButton>
    </form>
  );
}
