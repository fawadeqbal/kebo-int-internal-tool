"use client";

import { useActionState, useRef, useState } from "react";
import { MailCheck } from "lucide-react";
import { Alert, Field, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { signUpAction, slugCheckAction } from "./actions";

export function SignUpForm({ trialDays }: { trialDays: number }) {
  const [state, action] = useActionState(signUpAction, {});
  const [slug, setSlug] = useState(state.values?.slug ?? "");
  const [hint, setHint] = useState<string | null>(null);
  const touched = useRef(false);
  if (state.ok)
    return (
      <div className="mt-4 flex flex-col items-center gap-3 py-4 text-center">
        <MailCheck className="size-10 text-ok" aria-hidden />
        <p className="text-sm">{state.message}</p>
      </div>
    );
  const v = state.values ?? {};
  const suggest = async (name: string) => {
    if (touched.current || !name.trim()) return;
    const r = await slugCheckAction(name, "");
    if (r.suggestion && !touched.current) setSlug(r.suggestion);
  };
  const check = async (s: string) => {
    if (!s) return setHint(null);
    const r = await slugCheckAction("", s);
    setHint(r.free ? null : (r.problem ?? null) + (r.suggestion ? ` Try "${r.suggestion}".` : ""));
  };
  return (
    <form action={action} className="mt-5 flex flex-col gap-4" noValidate>
      {state.message && <Alert tone="error">{state.message}</Alert>}
      <Field label="Company" htmlFor="companyName" error={state.errors?.companyName}>
        <Input
          id="companyName"
          name="companyName"
          autoComplete="organization"
          required
          defaultValue={v.companyName}
          onBlur={(e) => void suggest(e.target.value)}
        />
      </Field>
      <Field
        label="Short name"
        htmlFor="slug"
        hint="Small letters, numbers and dashes. It becomes your address."
        error={state.errors?.slug ?? (hint ? [hint] : undefined)}
      >
        <Input
          id="slug"
          name="slug"
          required
          value={slug}
          onChange={(e) => {
            touched.current = true;
            setSlug(e.target.value.toLowerCase());
          }}
          onBlur={(e) => void check(e.target.value)}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="name" error={state.errors?.name}>
          <Input id="name" name="name" autoComplete="name" required defaultValue={v.name} />
        </Field>
        <Field label="Email" htmlFor="email" error={state.errors?.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={v.email} />
        </Field>
      </div>
      <Field label="Password" htmlFor="password" hint="At least 10 characters, with letters and a number" error={state.errors?.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      <SubmitButton pendingText="Starting…" size="lg" className="w-full">
        Start my {trialDays}-day trial
      </SubmitButton>
      <p className="text-center text-xs text-muted">You are the admin of your company&apos;s workspace. No card needed.</p>
    </form>
  );
}
