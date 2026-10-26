"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Alert, Button, ButtonLink, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import type { ActionState } from "@/lib/utils/result";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function CodeInput({ label = "Code from your app", hint, recovery }: { label?: string; hint?: string; recovery?: boolean }) {
  return (
    <Field label={label} htmlFor="code" required hint={hint}>
      <Input
        id="code"
        name="code"
        autoComplete="one-time-code"
        inputMode={recovery ? "text" : "numeric"}
        autoFocus
        maxLength={recovery ? 20 : 7}
        placeholder={recovery ? "123456 or abcd-efgh" : "123456"}
        className="font-mono text-base tracking-[0.2em]"
      />
    </Field>
  );
}

/** Sign-in, after the password. */
export function SecondStepForm({ action, next }: { action: Action; next?: string }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="mt-5 flex flex-col gap-4" noValidate>
      {(state.message || state.errors?.code) && <Alert tone="error">{state.message ?? state.errors?.code?.[0]}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <CodeInput recovery hint="Lost your phone? Enter one of your recovery codes instead." />
      <SubmitButton pendingText="Checking…" size="lg" className="w-full">
        Verify and sign in
      </SubmitButton>
    </form>
  );
}

/** The recovery codes, shown once, with copy and download. */
export function RecoveryCodes({ codes, continueHref }: { codes: string[]; continueHref?: string }) {
  const [copied, setCopied] = useState(false);
  const text = `Kebo RFQ Desk recovery codes (each works once)\n\n${codes.join("\n")}\n`;
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning">Save these recovery codes now — they are shown only once. Each one lets you sign in once if you lose your phone.</Alert>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-line bg-surface-2/60 p-4 font-mono text-sm text-text">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true));
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy"}
        </Button>
        <a
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-text hover:bg-surface-2"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          download="kebo-rfq-recovery-codes.txt"
        >
          <Download className="size-4" aria-hidden /> Download
        </a>
        {continueHref && (
          <ButtonLink href={continueHref} size="sm">
            I&apos;ve saved them — continue
          </ButtonLink>
        )}
      </div>
    </div>
  );
}

/** Setup: enter the first code to turn it on, then save the recovery codes. */
export function ConfirmTwoStepForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, {});
  const codes = state.ok ? (state.meta?.codes as string[] | undefined) : undefined;
  if (codes) return <RecoveryCodes codes={codes} continueHref="/dashboard?toast=Two-step+sign-in+is+on" />;
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.message && <Alert tone="error">{state.message}</Alert>}
      <CodeInput label="Enter the 6-digit code the app shows" />
      <SubmitButton pendingText="Checking…" className="w-full">
        Turn on two-step sign-in
      </SubmitButton>
    </form>
  );
}

/** My account: one small form per change, each confirmed with a current code. */
export function TwoStepCodeAction({ action, label, danger, description }: { action: Action; label: string; danger?: boolean; description: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, {});
  const codes = state.ok ? (state.meta?.codes as string[] | undefined) : undefined;
  if (codes) return <RecoveryCodes codes={codes} />;
  if (!open)
    return (
      <Button type="button" variant={danger ? "danger-ghost" : "secondary"} size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-3 rounded-lg border border-line p-3" noValidate>
      <p className="text-sm text-text-2">{description}</p>
      {state.message && !state.ok && <Alert tone="error">{state.message}</Alert>}
      <CodeInput />
      <div className="flex gap-2">
        <SubmitButton size="sm" variant={danger ? "danger" : "primary"} pendingText="Checking…">
          {label}
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
