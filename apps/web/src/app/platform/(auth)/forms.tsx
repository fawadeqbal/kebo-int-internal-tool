"use client";

import { useActionState } from "react";
import { Field, Input, Notice } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { platformLoginAction, platformTwoStepAction } from "../actions";
import { PasswordInput } from "@/components/common/password-input";
import { TwoStepForm } from "@/app/login/forms";

export function PlatformLoginForm() {
  const [state, action] = useActionState(platformLoginAction, {});
  return (
    <form action={action} className="mt-5 flex flex-col gap-4" noValidate>
      {state.message && <Notice tone="bad">{state.message}</Notice>}
      <Field label="Email" htmlFor="email" error={state.errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="username" autoFocus required defaultValue={state.values?.email ?? ""} />
      </Field>
      <Field label="Password" htmlFor="password" error={state.errors?.password}>
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton pendingText="Signing in…" size="lg" className="w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}

/**
 * The platform's code, asked the same way as a company's (six boxes, "Use a recovery code"): one two-step sign-in
 * (review 24 Nov, A-36: the two screens used different patterns).
 */
export function PlatformTwoStepForm() {
  return <TwoStepForm send={platformTwoStepAction} />;
}
