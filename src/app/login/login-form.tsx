"use client";

import { useActionState } from "react";
import { loginAction } from "@/modules/users/auth-actions";
import { Alert, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, {});
  return (
    <form action={action} className="mt-5 flex flex-col gap-4" noValidate>
      {state.message && <Alert tone="error">{state.message}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email" error={state.errors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          defaultValue={(state.values?.email as string) ?? ""}
          aria-invalid={!!state.errors?.email}
          aria-describedby={state.errors?.email ? "email-error" : undefined}
        />
      </Field>
      <Field label="Password" htmlFor="password" error={state.errors?.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={!!state.errors?.password}
          aria-describedby={state.errors?.password ? "password-error" : undefined}
        />
      </Field>
      <SubmitButton pendingText="Signing in…" size="lg" className="w-full">
        Sign in
      </SubmitButton>
    </form>
  );
}
