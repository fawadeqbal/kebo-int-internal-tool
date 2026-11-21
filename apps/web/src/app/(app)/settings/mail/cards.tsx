"use client";

import { FormButtons } from "@/components/common/route-window";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAIL_PROVIDER_LABEL,
  MAIL_PROVIDERS,
  MAIL_USE_LABEL,
  MAIL_USES,
  SMTP_PORTS,
  type MailAccountView,
  type MailProvider,
  type MailSettingsView,
} from "@kebo/shared";
import { ButtonLink, Card, CardBody, CardHeader, cn, Field, Input, Select } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";

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
 * Admin settings › Email accounts: connect an address (Gmail, an SMTP server or Resend) or change one. The
 * password or key is typed in and never shown again; left empty on a change, the stored one is kept.
 */
export function AccountForm({ account, action }: { account?: MailAccountView; action: Action }) {
  const router = useRouter();
  const [provider, setProvider] = useState<MailProvider>(account?.provider ?? "gmail");
  const saved = !!account && account.provider === provider;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={account ? `Change ${account.fromEmail}` : "Connect an email"}
        description={account ? undefined : "The app sends from it. Gmail needs an app password, not the account's own password."}
      />
      <CardBody>
        <ActionForm action={action} keepFields onDone={() => router.replace("/settings/mail")} className="flex flex-col gap-4">
          {(st) => (
            <>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Where the email is</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {MAIL_PROVIDERS.map((p) => (
                    <label
                      key={p}
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 rounded-lg border bg-surface px-3 py-2.5 text-sm transition-colors",
                        provider === p
                          ? "border-primary bg-primary-soft/50 ring-1 ring-primary/30"
                          : "border-line hover:border-line-strong",
                      )}
                    >
                      <input
                        type="radio"
                        name="provider"
                        value={p}
                        className="mt-0.5 accent-[var(--color-primary)]"
                        checked={provider === p}
                        onChange={() => setProvider(p)}
                      />
                      <span>
                        <span className="block font-medium">{MAIL_PROVIDER_LABEL[p]}</span>
                        <span className="block text-xs text-text-2">{PROVIDER_SUB[p]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Address"
                  htmlFor="mail-from"
                  required
                  error={st.errors?.fromEmail}
                  hint={
                    provider === "gmail"
                      ? "The Gmail address the emails come from"
                      : provider === "resend"
                        ? "On the domain you verified in Resend"
                        : undefined
                  }
                >
                  <Input
                    id="mail-from"
                    name="fromEmail"
                    type="email"
                    autoComplete="off"
                    defaultValue={st.values?.fromEmail ?? account?.fromEmail ?? ""}
                  />
                </Field>
                <Field label="Name people see" htmlFor="mail-name" optional error={st.errors?.fromName} hint="Like Kebo Sales">
                  <Input
                    id="mail-name"
                    name="fromName"
                    maxLength={80}
                    autoComplete="off"
                    defaultValue={st.values?.fromName ?? account?.fromName ?? ""}
                  />
                </Field>
                {provider === "smtp" && (
                  <>
                    <Field label="Mail server" htmlFor="mail-host" required error={st.errors?.host}>
                      <Input id="mail-host" name="host" autoComplete="off" defaultValue={st.values?.host ?? account?.host ?? ""} />
                    </Field>
                    <Field label="Port" htmlFor="mail-port" required error={st.errors?.port}>
                      <Select id="mail-port" name="port" defaultValue={st.values?.port ?? String(account?.port ?? 465)}>
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
                  <Field
                    label="User name"
                    htmlFor="mail-user"
                    optional={provider === "gmail"}
                    error={st.errors?.username}
                    hint={provider === "gmail" ? "Only when it is not the address above" : "Often the full email address"}
                  >
                    <Input
                      id="mail-user"
                      name="username"
                      autoComplete="off"
                      defaultValue={st.values?.username ?? account?.username ?? ""}
                    />
                  </Field>
                )}
                <Field
                  label={SECRET_LABEL[provider]}
                  htmlFor="mail-secret"
                  required={!saved}
                  error={st.errors?.secret}
                  hint={
                    saved
                      ? "Saved. Leave empty to keep it; type a new one to change it"
                      : provider === "gmail"
                        ? "Made in your Google account under Security › App passwords (two-step sign-in must be on)"
                        : provider === "resend"
                          ? "From resend.com › API keys"
                          : undefined
                  }
                >
                  <Input
                    id="mail-secret"
                    name="secret"
                    type="password"
                    autoComplete="new-password"
                    placeholder={saved ? "••••••••" : undefined}
                  />
                </Field>
              </div>
              <FormButtons>
                <ButtonLink href="/settings/mail" variant="secondary">
                  Cancel
                </ButtonLink>
                <SubmitButton pendingText={account ? "Saving…" : "Connecting…"}>{account ? "Save" : "Connect"}</SubmitButton>
              </FormButtons>
            </>
          )}
        </ActionForm>
      </CardBody>
    </Card>
  );
}

const label = (a: MailAccountView) => (a.fromName ? `${a.fromName} · ${a.fromEmail}` : a.fromEmail);

/** Which address each kind of email goes from, the default one, and whether people may choose when sending. */
export function UsesForm({ view, action }: { view: MailSettingsView; action: Action }) {
  const options = view.accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {label(a)}
    </option>
  ));
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Which email sends what" description="Every email the app sends goes from the address set here." />
      <CardBody>
        <ActionForm action={action} keepFields className="flex flex-col gap-4">
          {(st) => (
            <>
              <div className="flex flex-col divide-y divide-line">
                {MAIL_USES.map((u) => (
                  <div key={u} className="grid items-center gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_18rem] sm:gap-4">
                    <label htmlFor={`use-${u}`}>
                      <span className="block text-sm font-medium">{MAIL_USE_LABEL[u].label}</span>
                      <span className="block text-xs text-text-2">{MAIL_USE_LABEL[u].hint}</span>
                    </label>
                    <Select id={`use-${u}`} name={u} defaultValue={st.values?.[u] ?? view.uses[u] ?? ""}>
                      <option value="">The default address</option>
                      {options}
                    </Select>
                  </div>
                ))}
                <div className="grid items-center gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_18rem] sm:gap-4">
                  <label htmlFor="use-default">
                    <span className="block text-sm font-medium">The default address</span>
                    <span className="block text-xs text-text-2">For anything not set above</span>
                  </label>
                  <Select id="use-default" name="defaultId" defaultValue={st.values?.defaultId ?? view.defaultId ?? ""}>
                    {options}
                  </Select>
                </div>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-2/60 px-3.5 py-3 text-sm">
                <input type="checkbox" name="choose" defaultChecked={view.choose} className="mt-0.5 size-[18px] shrink-0 accent-primary" />
                <span>
                  <span className="block font-medium">Let people choose the address when sending</span>
                  <span className="block text-xs text-text-2">
                    The send window starts on the address above; they can pick another connected one.
                  </span>
                </span>
              </label>
              <FormButtons>
                <SubmitButton>Save</SubmitButton>
              </FormButtons>
            </>
          )}
        </ActionForm>
      </CardBody>
    </Card>
  );
}

/** One email through an account, so the admin sees it arrive (or why it did not). */
export function TestForm({ view, me, action }: { view: MailSettingsView; me: string; action: Action }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Send a test email"
        description={view.enabled ? "One email, from the address chosen." : "Connect an email first."}
      />
      <CardBody>
        <ActionForm action={action} keepFields className="flex flex-col gap-3">
          {(st) => (
            <div className="flex flex-wrap items-end gap-3">
              {view.accounts.length > 1 && (
                <Field label="From" htmlFor="mail-test-from" className="min-w-0 flex-1 basis-56">
                  <Select id="mail-test-from" name="accountId" defaultValue={st.values?.accountId ?? view.defaultId ?? ""}>
                    {view.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {label(a)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Send it to" htmlFor="mail-test-to" error={st.errors?.to} className="min-w-0 flex-1 basis-56">
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
  );
}
