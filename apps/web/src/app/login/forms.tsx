"use client";

import { useActionState } from "react";
import { Alert, Field, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { loginAction, twoStepAction } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, {});
  return (
    <form action={action} className="mt-5 flex flex-col gap-4" noValidate>
      {state.message && <Alert tone="error">{state.message}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email" error={state.errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="username" autoFocus required defaultValue={state.values?.email ?? ""} />
      </Field>
      <Field label="Password" htmlFor="password" error={state.errors?.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton pendingText="Signing in…" size="lg" className="w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}

export function TwoStepForm({ next }: { next?: string }) {
  const [state, action] = useActionState(twoStepAction, {});
  return (
    <form action={action} className="mt-5 flex flex-col gap-4" noValidate>
      {state.message && <Alert tone="error">{state.message}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Code" htmlFor="code" hint="The 6 digits from your authenticator app, or one of your recovery codes" error={state.errors?.code}>
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required />
      </Field>
      <SubmitButton pendingText="Checking…" size="lg" className="w-full">
        Continue
      </SubmitButton>
    </form>
  );
}
