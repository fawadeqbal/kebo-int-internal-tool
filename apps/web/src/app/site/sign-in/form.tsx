"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Alert, Field, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { findCompanyAction } from "../actions";

export function FindCompanyForm() {
  const [state, action] = useActionState(findCompanyAction, {});
  if (state.ok)
    return (
      <div className="mt-4 flex flex-col items-center gap-3 py-4 text-center" role="status">
        <MailCheck className="size-10 text-ok" aria-hidden />
        <p className="text-sm">{state.message}</p>
      </div>
    );
  return (
    <form action={action} className="mt-5 flex flex-col gap-4" noValidate>
      {state.message && <Alert tone="error">{state.message}</Alert>}
      <Field label="Work email" htmlFor="email" error={state.errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
      </Field>
      <SubmitButton pendingText="Sending…" size="lg" className="w-full">
        Send me the link
      </SubmitButton>
    </form>
  );
}
