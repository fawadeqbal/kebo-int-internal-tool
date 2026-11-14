"use client";

import { useState } from "react";
import { MAIL_PROVIDER_LABEL, MAIL_PROVIDERS, SMTP_PORTS, type MailProvider, type MailSettingsView } from "@kebo/shared";
import { Card, CardBody, CardHeader, cn, Field, Input, Select } from "@kebo/ui";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** What each way needs, in a few words. */
const PROVIDER_SUB: Record<MailProvider, string> = {
  gmail: "A Gmail or Google Workspace address, with an app password",
  smtp: "Any mail server: its name, port, user and password",
  resend: "A Resend API key and an address on your verified domain",
};
/** What the secret is called for each way. */
const SECRET_LABEL: Record<MailProvider, string> = { gmail: "App password", smtp: "Password", resend: "API key" };

/**
 * Admin settings › Email sending: the way the company's email goes out (Gmail, an SMTP server or Resend),
 * who it is from, and a test. The password or key is typed in and never shown again.
 */
export function MailCards({ view, me, saveAction, removeAction, testAction }: { view: MailSettingsView; me: string; saveAction: Action; removeAction: Action; testAction: Action }) {
  const [provider, setProvider] = useState<MailProvider>(view.provider ?? "gmail");
  const saved = view.provider === provider;
  const status = view.provider
    ? { tone: "ok" as const, text: `${MAIL_PROVIDER_LABEL[view.provider]} · from ${view.fromEmail}` }
    : view.serverDefault
      ? { tone: "neutral" as const, text: "Not set: sent through the server's own email" }
      : { tone: "warn" as const, text: "Not set: no email is sent" };
  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden p-0">
        <CardHeader title="How email is sent" description={<span className={cn("font-medium", status.tone === "ok" ? "text-ok" : status.tone === "warn" ? "text-warn" : undefined)}>{status.text}</span>} />
        <CardBody>
          <ActionForm action={saveAction} keepFields className="flex flex-col gap-4">
            {(st) => (
              <>
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium">Send through</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {MAIL_PROVIDERS.map((p) => (
                      <label
                        key={p}
                        className={cn(
                          "flex cursor-pointer items-start gap-2.5 rounded-lg border bg-surface px-3 py-2.5 text-sm transition-colors",
                          provider === p ? "border-primary bg-primary-soft/50 ring-1 ring-primary/30" : "border-line hover:border-line-strong",
                        )}
                      >
                        <input type="radio" name="provider" value={p} className="mt-0.5 accent-[var(--color-primary)]" checked={provider === p} onChange={() => setProvider(p)} />
                        <span>
                          <span className="block font-medium">{MAIL_PROVIDER_LABEL[p]}</span>
                          <span className="block text-xs text-text-2">{PROVIDER_SUB[p]}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="From address" htmlFor="mail-from" required error={st.errors?.fromEmail} hint={provider === "gmail" ? "The Gmail address the emails come from" : provider === "resend" ? "On the domain you verified in Resend" : undefined}>
                    <Input id="mail-from" name="fromEmail" type="email" autoComplete="off" defaultValue={st.values?.fromEmail ?? view.fromEmail} placeholder="sales@yourcompany.com" />
                  </Field>
                  <Field label="From name" htmlFor="mail-name" optional error={st.errors?.fromName} hint="Shown before the address">
                    <Input id="mail-name" name="fromName" maxLength={80} autoComplete="off" defaultValue={st.values?.fromName ?? view.fromName} placeholder="Your company's name" />
                  </Field>
                  {provider === "smtp" && (
                    <>
                      <Field label="Mail server" htmlFor="mail-host" required error={st.errors?.host}>
                        <Input id="mail-host" name="host" autoComplete="off" defaultValue={st.values?.host ?? view.host} placeholder="smtp.yourcompany.com" />
                      </Field>
                      <Field label="Port" htmlFor="mail-port" required error={st.errors?.port} hint="465 is the usual secure port; 587 the other common one">
                        <Select id="mail-port" name="port" defaultValue={st.values?.port ?? String(view.port ?? 465)}>
                          {SMTP_PORTS.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </>
                  )}
                  {provider !== "resend" && (
                    <Field label="User name" htmlFor="mail-user" optional={provider === "gmail"} error={st.errors?.username} hint={provider === "gmail" ? "Only when it is not the From address" : "Often the full email address"}>
                      <Input id="mail-user" name="username" autoComplete="off" defaultValue={st.values?.username ?? view.username} />
                    </Field>
                  )}
                  <Field
                    label={SECRET_LABEL[provider]}
                    htmlFor="mail-secret"
                    required={!(saved && view.hasSecret)}
                    error={st.errors?.secret}
                    hint={
                      saved && view.hasSecret
                        ? "Saved. Leave empty to keep it; type a new one to change it"
                        : provider === "gmail"
                          ? "Made in your Google account under Security › App passwords (two-step sign-in must be on)"
                          : provider === "resend"
                            ? "From resend.com › API keys"
                            : undefined
                    }
                  >
                    <Input id="mail-secret" name="secret" type="password" autoComplete="new-password" placeholder={saved && view.hasSecret ? "••••••••" : undefined} />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SubmitButton>Save</SubmitButton>
                </div>
              </>
            )}
          </ActionForm>
        </CardBody>
      </Card>

      <Card className="overflow-hidden p-0">
        <CardHeader title="Send a test email" description={view.enabled ? "One email, sent the way it is saved now." : "Save how email is sent first."} />
        <CardBody>
          <ActionForm action={testAction} keepFields className="flex flex-col gap-3">
            {(st) => (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Send it to" htmlFor="mail-test-to" error={st.errors?.to} className="min-w-0 flex-1 basis-64">
                  <Input id="mail-test-to" name="to" type="email" defaultValue={st.values?.to ?? me} />
                </Field>
                <SubmitButton variant="secondary" pendingText="Sending…" disabled={!view.enabled}>
                  Send test
                </SubmitButton>
              </div>
            )}
          </ActionForm>
        </CardBody>
      </Card>

      {view.provider && (
        <ActionForm action={removeAction} showSuccess={false}>
          <ConfirmSubmit variant="ghost" size="sm" pendingText="Removing…" className="text-bad" message={view.serverDefault ? "Remove this company's own email setting? Its emails will go through the server's own again." : "Remove this company's own email setting? No email will be sent until one is set again."}>
            Remove this setting
          </ConfirmSubmit>
        </ActionForm>
      )}
    </div>
  );
}
