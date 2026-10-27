"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { Alert, Button, Field, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { TwoStepStatus } from "@/lib/types-people";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function PasswordForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-col gap-4">
      {(s) => (
        <>
          <Field label="Current password" htmlFor="current" error={s.errors?.current}>
            <Input id="current" name="current" type="password" autoComplete="current-password" aria-invalid={!!s.errors?.current} />
          </Field>
          <Field label="New password" htmlFor="next" error={s.errors?.next} hint="At least 10 characters, with letters and at least one number. A short sentence is easy to remember.">
            <Input id="next" name="next" type="password" autoComplete="new-password" aria-invalid={!!s.errors?.next} />
          </Field>
          <Field label="New password again" htmlFor="confirm" error={s.errors?.confirm}>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" aria-invalid={!!s.errors?.confirm} />
          </Field>
          <div>
            <SubmitButton pendingText="Changing…">Change my password</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

function CodeField({ id, error, label = "Code from your app" }: { id: string; error?: string[]; label?: string }) {
  return (
    <Field label={label} htmlFor={id} error={error}>
      <Input id={id} name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="max-w-40 font-mono tracking-widest" aria-invalid={!!error} />
    </Field>
  );
}

/** The 10 one-time recovery codes, shown once right after they are made. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Alert tone="warning">
        <p className="font-medium">Save these recovery codes now. They are shown only once.</p>
        <p className="mt-0.5 text-text-2">If you lose your phone, each code lets you sign in one time instead of the code from your app. Keep them somewhere safe, away from your phone (a password manager, or printed).</p>
      </Alert>
      <ol className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-2/60 p-3 font-mono text-sm tabular sm:grid-cols-2">
        {codes.map((c, i) => (
          <li key={c} className="flex items-baseline gap-2">
            <span className="w-5 text-right text-xs text-muted">{i + 1}.</span>
            <span className="tracking-wide select-all">{c}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy all"}
        </Button>
        <Button size="sm" variant="primary" onClick={onDone}>
          I have saved them
        </Button>
      </div>
    </div>
  );
}

/** Two-step sign-in: start → scan → confirm with a code → recovery codes; then new codes or turn off. */
export function TwoStepPanel({
  status,
  sinceText,
  start,
  confirm,
  newCodes,
  turnOff,
  doneHref,
}: {
  status: TwoStepStatus;
  sinceText: string | null;
  start: Action;
  confirm: Action;
  newCodes: Action;
  turnOff: Action;
  /** Where to go once the recovery codes are saved (the setup a role requires, at sign-in). */
  doneHref?: string;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [manage, setManage] = useState<"codes" | "off" | null>(null);

  if (codes)
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          setCodes(null);
          if (doneHref) router.replace(doneHref);
        }}
      />
    );

  // While setting up, stay on the setup step even once the page data says "on": the confirm
  // form must stay mounted until it has handed over the recovery codes (its onDone runs after the refresh).
  if (status.on && !setup)
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-lg border border-ok/25 bg-ok-soft p-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">Two-step sign-in is on{sinceText ? ` since ${sinceText}` : ""}.</p>
            <p className="text-text-2">
              After your password you enter the code from your authenticator app. {status.recoveryCodesLeft} recovery code{status.recoveryCodesLeft === 1 ? "" : "s"} left.
            </p>
          </div>
        </div>
        {status.recoveryCodesLeft <= 3 && (
          <Alert tone="warning">You are running out of recovery codes. Make new ones so you can still get in if you lose your phone.</Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={manage === "codes" ? "primary" : "secondary"} onClick={() => setManage(manage === "codes" ? null : "codes")} aria-pressed={manage === "codes"}>
            <KeyRound aria-hidden /> Make new recovery codes
          </Button>
          {!status.required && (
            <Button size="sm" variant={manage === "off" ? "danger" : "danger-ghost"} onClick={() => setManage(manage === "off" ? null : "off")} aria-pressed={manage === "off"}>
              Turn off
            </Button>
          )}
        </div>
        {status.required && <p className="text-xs text-muted">Your role ({status.roleName}) needs two-step sign-in, so it cannot be turned off.</p>}
        {manage === "codes" && (
          <ActionForm
            key="codes"
            action={newCodes}
            showSuccess={false}
            onDone={(s) => {
              setManage(null);
              setCodes((s.data as { recoveryCodes: string[] }).recoveryCodes);
            }}
            className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3"
          >
            {(s) => (
              <>
                <p className="text-sm text-text-2">Your old recovery codes stop working. Enter the code your app shows now to confirm it is you.</p>
                <CodeField id="codes-code" error={s.errors?.code} />
                <div>
                  <SubmitButton size="sm" pendingText="Making codes…">
                    Make new codes
                  </SubmitButton>
                </div>
              </>
            )}
          </ActionForm>
        )}
        {manage === "off" && (
          <ActionForm key="off" action={turnOff} onDone={() => setManage(null)} className="flex flex-col gap-3 rounded-lg border border-bad/25 bg-bad-soft/50 p-3">
            {(s) => (
              <>
                <p className="text-sm text-text-2">Without it, anyone who learns your password can sign in as you. Enter the code your app shows now to turn it off.</p>
                <CodeField id="off-code" error={s.errors?.code} />
                <div>
                  <SubmitButton size="sm" variant="danger" pendingText="Turning off…">
                    Turn off two-step sign-in
                  </SubmitButton>
                </div>
              </>
            )}
          </ActionForm>
        )}
      </div>
    );

  if (setup)
    return (
      <div className="flex flex-col gap-5">
        <ol className="flex flex-col gap-5">
          <li className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
            <div className="w-44 shrink-0 self-center rounded-lg border border-line bg-white p-2 sm:self-start">
              <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qr)}`} alt="QR code to scan with your authenticator app" className="block size-full" width={160} height={160} />
            </div>
            <div className="min-w-0 text-sm">
              <p className="font-medium">1. Scan this with your authenticator app</p>
              <p className="mt-1 text-text-2">Use Google Authenticator, Microsoft Authenticator, 1Password or a similar app: add an account, then scan the code.</p>
              <p className="mt-3 text-xs text-muted">Can&apos;t scan? Enter this key in the app instead (time-based):</p>
              <p className="mt-1 rounded-md bg-surface-2 px-2 py-1.5 font-mono text-sm tracking-wider break-all select-all">{setup.secret.match(/.{1,4}/g)?.join(" ")}</p>
            </div>
          </li>
          <li>
            <ActionForm
              action={confirm}
              showSuccess={false}
              onDone={(s) => {
                setSetup(null);
                setCodes((s.data as { recoveryCodes: string[] }).recoveryCodes);
              }}
              className="flex flex-col gap-3"
            >
              {(s) => (
                <>
                  <p className="text-sm font-medium">2. Enter the 6-digit code the app shows</p>
                  <CodeField id="confirm-code" error={s.errors?.code} label="Code" />
                  <div className="flex gap-2">
                    <SubmitButton size="sm" pendingText="Checking…">
                      Turn on two-step sign-in
                    </SubmitButton>
                    <Button size="sm" variant="ghost" onClick={() => setSetup(null)}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </ActionForm>
          </li>
        </ol>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 text-sm">
        <Smartphone className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
        <div>
          <p className="font-medium">Two-step sign-in is off.</p>
          <p className="text-text-2">
            {status.required ? `Your role (${status.roleName}) needs it. ` : "Turn it on so a stolen password is not enough: "}
            After your password, you also enter a 6-digit code from an app on your phone. It takes two minutes.
          </p>
        </div>
      </div>
      <ActionForm action={start} showSuccess={false} onDone={(s) => {
          setManage(null);
          setSetup(s.data as { secret: string; qr: string });
        }}>
        <SubmitButton size="sm" pendingText="Starting…">
          Set up two-step sign-in
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
