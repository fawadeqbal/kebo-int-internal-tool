"use client";

import { useActionState } from "react";
import { Alert, Card, CardBody, CardHeader, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { saveSettingsAction } from "@/modules/settings/actions";
import type { AppSettings } from "@/modules/settings/service";

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const [state, action] = useActionState(saveSettingsAction, {});
  const e = state.errors ?? {};
  const v = (key: keyof AppSettings) => String((state.values?.[key] as string | undefined) ?? settings[key] ?? "");
  const text = (key: keyof AppSettings, label: string, opts: { hint?: string; type?: string; required?: boolean; step?: string } = {}) => (
    <Field label={label} htmlFor={key} hint={opts.hint} error={e[key]} required={opts.required}>
      <Input id={key} name={key} type={opts.type ?? "text"} step={opts.step} defaultValue={v(key)} aria-invalid={!!e[key]} />
    </Field>
  );

  return (
    <form action={action} className="flex max-w-4xl flex-col gap-6" noValidate>
      {state.message && <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <Card>
        <CardHeader title="Company profile" description="Printed on quotations and invoices." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          {text("companyName", "Company name", { required: true })}
          {text("companyTaxNo", "NTN / Tax number")}
          {text("companyPhone", "Phone")}
          {text("companyEmail", "Email", { type: "email" })}
          <Field label="Address" htmlFor="companyAddress" error={e.companyAddress} className="sm:col-span-2">
            <Textarea id="companyAddress" name="companyAddress" rows={2} className="min-h-0" defaultValue={v("companyAddress")} />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Money & defaults" description="Used when creating new quotations and invoices. Existing documents keep their own values." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          {text("currency", "Currency code", { required: true, hint: "e.g. PKR" })}
          {text("defaultTaxRate", "Default tax rate (%)", { type: "number", step: "0.01", hint: "e.g. 18 for 18% GST" })}
          {text("quotationValidityDays", "Quotation valid for (days)", { type: "number" })}
          {text("invoicePaymentDays", "Invoice payment due in (days)", { type: "number" })}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Reminders" description="The reminder job checks these every hour and notifies the responsible people." />
        <CardBody className="grid gap-5 sm:grid-cols-3">
          {text("reminderPendingDays", "Pending longer than (days)", { type: "number" })}
          {text("reminderProcessingDays", "Processing longer than (days)", { type: "number" })}
          {text("reminderDueSoonDays", "Warn before due dates (days)", { type: "number" })}
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
      <div>
        <SubmitButton>Save settings</SubmitButton>
      </div>
    </form>
  );
}
