"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Field, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { loginAction, twoStepAction } from "./actions";

export interface DemoLogin {
  label: string;
  hint: string;
  email: string;
  password: string;
}

export function LoginForm({ next, demo, forgotHref }: { next?: string; demo?: DemoLogin[]; forgotHref: string }) {
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
      {state.message && state.code === "choose_company" && <Alert tone="info">{state.message}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      {state.code === "choose_company" && Array.isArray(state.data) && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Company</legend>
          {(state.data as { slug: string; name: string }[]).map((c, i) => (
            <label
              key={c.slug}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40"
            >
              <input type="radio" name="company" value={c.slug} defaultChecked={i === 0} className="accent-[var(--color-primary)]" />
              <span className="font-medium">{c.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      {state.code !== "choose_company" && state.values?.company && <input type="hidden" name="company" value={state.values.company} />}
      <Field label="Email" required htmlFor="email" error={state.errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="username" autoFocus required defaultValue={state.values?.email ?? ""} />
      </Field>
      <Field label="Password" required htmlFor="password" error={state.errors?.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus={state.code === "choose_company"}
        />
      </Field>
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <input type="hidden" name="keepAsked" value="1" />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
          <input type="checkbox" name="keep" defaultChecked className="size-[18px] accent-primary-solid" />
          Keep me signed in
        </label>
        <Link href={forgotHref} className="font-semibold text-primary hover:underline">
          Forgot password?
        </Link>
      </div>
      <SubmitButton pendingText="Signing in…" className="h-[46px] w-full text-[15px]">
        Sign in
      </SubmitButton>
      {state.message && state.code !== "choose_company" && <Alert tone="error">{state.message}</Alert>}
    </form>
  );
}

/**
 * The two-step code (board "Two-step sign-in"): six boxes that move along as digits are typed (a pasted
 * code fills them all); "Use a recovery code" swaps them for one field.
 */
export function TwoStepForm({ next }: { next?: string }) {
  const [state, action] = useActionState(twoStepAction, {});
  const [recovery, setRecovery] = useState(false);
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const put = (from: number, typed: string) => {
    const only = typed.replace(/\D/g, "").slice(0, 6 - from);
    if (!only) return;
    setDigits((d) => d.map((x, i) => (i >= from && i < from + only.length ? only[i - from]! : x)));
    boxes.current[Math.min(from + only.length, 5)]?.focus();
  };
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      {recovery ? (
        <Field label="Recovery code" htmlFor="code" error={state.errors?.code} className="text-left">
          <Input id="code" name="code" autoComplete="one-time-code" autoFocus required />
        </Field>
      ) : (
        <fieldset>
          <legend className="sr-only">The 6-digit code</legend>
          <input type="hidden" name="code" value={digits.join("")} />
          <div className="flex justify-center gap-2">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  boxes.current[i] = el;
                }}
                aria-label={`Digit ${i + 1}`}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                autoFocus={i === 0}
                maxLength={6}
                value={d}
                onChange={(e) => (e.target.value ? put(i, e.target.value) : setDigits((x) => x.map((v, j) => (j === i ? "" : v))))}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !d && i > 0) boxes.current[i - 1]?.focus();
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  put(i, e.clipboardData.getData("text"));
                }}
                className="h-14 w-11 rounded-[10px] border border-line-strong bg-surface text-center text-[22px] font-bold text-text outline-none focus:border-2 focus:border-primary-solid sm:w-12"
              />
            ))}
          </div>
          {state.errors?.code && <p className="mt-2 text-xs text-bad">{state.errors.code[0]}</p>}
        </fieldset>
      )}
      {state.message && <Alert tone="error">{state.message}</Alert>}
      <SubmitButton pendingText="Checking…" className="w-full">
        Verify
      </SubmitButton>
      <p className="text-[13px] text-muted">
        {recovery ? "Have your phone? " : "Lost your phone? "}
        <button type="button" onClick={() => setRecovery((r) => !r)} className="font-semibold text-primary hover:underline">
          {recovery ? "Use the 6-digit code" : "Use a recovery code"}
        </button>
      </p>
    </form>
  );
}
