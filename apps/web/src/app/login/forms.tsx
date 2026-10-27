"use client";

import { useActionState, useRef } from "react";
import { Alert, Field, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { loginAction, twoStepAction } from "./actions";

export interface DemoLogin {
  label: string;
  hint: string;
  email: string;
  password: string;
}

export function LoginForm({ next, demo }: { next?: string; demo?: DemoLogin[] }) {
  const [state, action] = useActionState(loginAction, {});
  const form = useRef<HTMLFormElement>(null);
  const pick = (d: DemoLogin) => {
    const f = form.current;
    if (!f) return;
    (f.elements.namedItem("email") as HTMLInputElement).value = d.email;
    (f.elements.namedItem("password") as HTMLInputElement).value = d.password;
    f.requestSubmit();
  };
  return (
    <form ref={form} action={action} className="mt-5 flex flex-col gap-4" noValidate>
      {demo && (
        <div className="flex flex-col gap-2">
          {demo.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => pick(d)}
              className="flex flex-col rounded-xl border border-line px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-primary-soft/40"
            >
              <span className="text-sm font-medium">Sign in as the {d.label.toLowerCase()}</span>
              <span className="text-xs text-muted">{d.hint}</span>
            </button>
          ))}
          <p className="pt-1 text-center text-xs text-muted">or sign in with an email</p>
        </div>
      )}
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
      <Field
        label="Code"
        htmlFor="code"
        hint="The 6 digits from your authenticator app, or one of your recovery codes"
        error={state.errors?.code}
      >
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required />
      </Field>
      <SubmitButton pendingText="Checking…" size="lg" className="w-full">
        Continue
      </SubmitButton>
    </form>
  );
}
