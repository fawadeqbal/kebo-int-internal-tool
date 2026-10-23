"use client";

import { useActionState } from "react";
import { Alert, buttonClass, Card, CardBody, CardHeader, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { saveSettingsAction, sendTestEmailAction } from "@/modules/settings/actions";
import type { AppSettings } from "@/modules/settings/service";

export function SettingsForm({ settings, smtpConfigured }: { settings: AppSettings; smtpConfigured: boolean }) {
  const [state, action] = useActionState(saveSettingsAction, {});
  const [testState, testAction, testing] = useActionState(sendTestEmailAction, {});
  const e = state.errors ?? {};
  const v = (key: keyof AppSettings) => {
    const typed = state.values?.[key] as string | undefined;
    if (typed !== undefined) return typed;
    const saved = settings[key];
    return Array.isArray(saved) ? saved.join(key === "notifyEmails" ? ", " : "\n") : String(saved ?? "");
  };
  const checked = (key: keyof AppSettings) => (state.values ? state.values[key] === "on" : Boolean(settings[key]));
  const text = (key: keyof AppSettings, label: string, opts: { hint?: string; type?: string; required?: boolean; step?: string } = {}) => (
    <Field label={label} htmlFor={key} hint={opts.hint} error={e[key]} required={opts.required}>
      <Input id={key} name={key} type={opts.type ?? "text"} step={opts.step} defaultValue={v(key)} aria-invalid={!!e[key]} />
    </Field>
  );

  return (
    <form action={action} className="flex max-w-4xl flex-col gap-5" noValidate>
      {state.message && <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <Card>
        <CardHeader title="Email notifications" description="Who at Kebo gets an email, and for what." />
        <CardBody className="grid gap-5">
          {!smtpConfigured && (
            <Alert tone="warning">
              Email sending is not set up on the server yet. Add <code>SMTP_HOST</code>, <code>SMTP_USER</code> and <code>SMTP_PASSWORD</code> to the server&apos;s <code>.env</code> file (a Gmail or company mailbox works), then restart.
            </Alert>
          )}
          <Field label="Admin emails to notify" htmlFor="notifyEmails" error={e.notifyEmails} hint="Separate with commas, e.g. info@keboint.com, shandongkeboint@gmail.com">
            <Textarea id="notifyEmails" name="notifyEmails" rows={2} className="min-h-0" defaultValue={v("notifyEmails")} />
          </Field>
          <fieldset>
            <legend className="text-sm font-medium text-text">Send an email when…</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["notifyNewQuery", "A new RFQ arrives (website or entered by staff)"],
                  ["notifyQuotation", "A customer accepts or rejects a quotation"],
                  ["notifyClosed", "An inquiry is completed or closed as not completed"],
                  ["notifyPayment", "A payment is recorded"],
                  ["notifyDailySummary", "Every morning: new RFQs, overdue inquiries and unpaid invoices"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 text-sm text-text-2 transition-colors hover:border-line-strong hover:bg-surface-2 has-[:checked]:border-primary/40 has-[:checked]:bg-primary-soft/40 has-[:checked]:text-text">
                  <input type="checkbox" name={key} defaultChecked={checked(key)} className="mt-0.5 size-4 accent-[var(--primary-solid)]" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              formAction={testAction}
              disabled={testing}
              className={buttonClass("secondary", "sm")}
            >
              {testing ? "Sending…" : "Send a test email"}
            </button>
            {testState.message && <span className={`text-xs ${testState.ok ? "text-ok" : "text-bad"}`}>{testState.message}</span>}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Sourcing categories" description="Keep these the same as the dropdown on keboint.com." />
        <CardBody>
          <Field label="One category per line" htmlFor="categories" error={e.categories}>
            <Textarea id="categories" name="categories" rows={6} defaultValue={v("categories")} />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Company profile" description="Printed on quotations and invoices." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          {text("companyName", "Company name", { required: true })}
          {text("companyTaxNo", "Tax / registration number")}
          {text("companyPhone", "Phone")}
          {text("companyEmail", "Email", { type: "email" })}
          <Field label="Address" htmlFor="companyAddress" error={e.companyAddress} className="sm:col-span-2">
            <Textarea id="companyAddress" name="companyAddress" rows={2} className="min-h-0" defaultValue={v("companyAddress")} />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Money & defaults" description="Defaults for new quotations and invoices." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          {text("currency", "Currency code", { required: true, hint: "e.g. USD" })}
          {text("defaultTaxRate", "Default tax rate (%)", { type: "number", step: "0.01", hint: "Usually 0 for export" })}
          {text("quotationValidityDays", "Quotation valid for (days)", { type: "number" })}
          {text("invoicePaymentDays", "Invoice payment due in (days)", { type: "number" })}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Reminders" description="Checked every hour. Reminders go to the person handling it and to managers." />
        <CardBody className="grid gap-5 sm:grid-cols-3">
          {text("reminderPendingDays", "Pending longer than (days)", { type: "number" })}
          {text("reminderProcessingDays", "Processing longer than (days)", { type: "number" })}
          {text("reminderDueSoonDays", "Warn before deadlines (days)", { type: "number" })}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Document text" />
        <CardBody className="grid gap-5">
          <Field label="Default quotation terms & conditions" htmlFor="defaultQuotationTerms" error={e.defaultQuotationTerms}>
            <Textarea id="defaultQuotationTerms" name="defaultQuotationTerms" rows={5} defaultValue={v("defaultQuotationTerms")} />
          </Field>
          <Field label="Invoice footer" htmlFor="invoiceFooter" error={e.invoiceFooter}>
            <Input id="invoiceFooter" name="invoiceFooter" defaultValue={v("invoiceFooter")} />
          </Field>
        </CardBody>
      </Card>
      <div className="sticky bottom-20 z-10 flex justify-end rounded-xl border border-line bg-surface/90 p-3 shadow-pop backdrop-blur lg:bottom-4">
        <SubmitButton>Save settings</SubmitButton>
      </div>
    </form>
  );
}
