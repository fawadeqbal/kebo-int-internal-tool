"use client";

import { useActionState } from "react";
import { Alert, Field, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { setPasswordAction } from "./actions";

export function SetPasswordForm({ token, email, platform = false }: { token: string; email: string; platform?: boolean }) {
  const [state, action] = useActionState(setPasswordAction, {});
  return (
    <form action={action} className="mt-5 flex flex-col gap-4" noValidate>
      {state.message && <Alert tone="error">{state.message}</Alert>}
      <input type="hidden" name="token" value={token} />
      {platform && <input type="hidden" name="platform" value="1" />}
      <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
      <Field
        label="New password"
        htmlFor="password"
        hint="At least 10 characters, with letters and a number"
        error={state.errors?.password}
      >
        <Input id="password" name="password" type="password" autoComplete="new-password" autoFocus required />
      </Field>
      <Field label="The same password again" htmlFor="confirm" error={state.errors?.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton pendingText="Saving…" size="lg" className="w-full">
        Set my password
      </SubmitButton>
    </form>
  );
}
