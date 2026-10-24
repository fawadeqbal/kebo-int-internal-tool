"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Alert, Button, buttonClass, Card, CardBody, CardHeader, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { saveSettingsAction, sendTestEmailAction } from "@/modules/settings/actions";
import type { AppSettings } from "@/modules/settings/service";

type Key = keyof AppSettings;
type Section = "email" | "categories" | "company" | "money" | "reminders" | "documents";

const SECTIONS: Record<Section, Key[]> = {
  email: ["notifyEmails", "notifyNewQuery", "notifyQuotation", "notifyClosed", "notifyPayment", "notifyDailySummary"],
  categories: ["categories"],
  company: ["companyName", "companyTaxNo", "companyPhone", "companyEmail", "companyWebsite", "companyAddress"],
  money: ["currency", "defaultTaxRate", "quotationValidityDays", "invoicePaymentDays"],
  reminders: ["reminderPendingDays", "reminderProcessingDays", "reminderDueSoonDays"],
  documents: ["defaultQuotationTerms", "bankDetails", "invoiceFooter"],
};

const NOTIFY: [Key, string][] = [
  ["notifyNewQuery", "A new RFQ arrives (website or entered by staff)"],
  ["notifyQuotation", "A customer accepts or rejects a quotation"],
  ["notifyClosed", "An inquiry is completed or closed as not completed"],
  ["notifyPayment", "A payment is recorded"],
  ["notifyDailySummary", "Every morning: new RFQs, overdue inquiries and unpaid invoices"],
];

const asText = (key: Key, value: AppSettings[Key]) =>
  Array.isArray(value) ? value.join(key === "notifyEmails" ? ", " : "\n") : typeof value === "boolean" ? (value ? "on" : "") : String(value ?? "");

/** The saved values of every other section, so saving one section keeps the rest as they are. */
function KeepOthers({ settings, except }: { settings: AppSettings; except: Key[] }) {
  return (
    <>
      {(Object.keys(settings) as Key[])
        .filter((k) => !except.includes(k))
        .map((k) => {
          const v = asText(k, settings[k]);
          return typeof settings[k] === "boolean" ? v && <input key={k} type="hidden" name={k} value="on" /> : <input key={k} type="hidden" name={k} value={v} />;
        })}
    </>
  );
}

function ReadRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="mt-0.5 text-sm break-words whitespace-pre-wrap text-text">{value || <span className="text-muted">Not set</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Settings, read first: each section shows what is saved, with its own Edit.
 * Only that section's fields open; the rest stay as they are.
 */
export function SettingsForm({ settings, smtpConfigured }: { settings: AppSettings; smtpConfigured: boolean }) {
  const [editing, setEditing] = useState<Section | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Saved: close the section and say so.
  const [state, action] = useActionState(async (prev: Awaited<ReturnType<typeof saveSettingsAction>>, fd: FormData) => {
    const result = await saveSettingsAction(prev, fd);
    if (result.ok) {
      setSaved(result.message ?? "Saved.");
      setEditing(null);
    }
    return result;
  }, {});
  const [testState, testAction, testing] = useActionState(sendTestEmailAction, {});
  const e = state.errors ?? {};

  const v = (key: Key) => {
    const typed = state.values?.[key] as string | undefined;
    return typed !== undefined && !state.ok ? typed : asText(key, settings[key]);
  };
  const checked = (key: Key) => (state.values && !state.ok ? state.values[key] === "on" : Boolean(settings[key]));
  const text = (key: Key, label: string, opts: { hint?: string; type?: string; required?: boolean; step?: string } = {}) => (
    <Field label={label} htmlFor={key} hint={opts.hint} error={e[key]} required={opts.required}>
      <Input id={key} name={key} type={opts.type ?? "text"} step={opts.step} defaultValue={v(key)} aria-invalid={!!e[key]} />
    </Field>
  );

  const section = (id: Section, title: string, description: string, read: ReactNode, edit: ReactNode, gridClass = "grid gap-5") => {
    const open = editing === id;
    return (
      <Card>
        <CardHeader
          title={title}
          description={description}
          actions={
            !open && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSaved(null);
                  setEditing(id);
                }}
                disabled={editing !== null}
                aria-label={`Edit ${title.toLowerCase()}`}
              >
                <Pencil aria-hidden /> Edit
              </Button>
            )
          }
        />
        <CardBody>
          {open ? (
            <form action={action} className="flex flex-col gap-5" noValidate>
              {state.message && !state.ok && <Alert tone="error">{state.message}</Alert>}
              <KeepOthers settings={settings} except={SECTIONS[id]} />
              <div className={gridClass}>{edit}</div>
              <div className="flex gap-2">
                <SubmitButton size="sm">Save</SubmitButton>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            read
          )}
        </CardBody>
      </Card>
    );
  };

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      {saved && !editing && <Alert tone="success">{saved}</Alert>}

      {section(
        "email",
        "Email notifications",
        "Who at Kebo gets an email, and for what.",
        <div className="flex flex-col gap-4">
          {!smtpConfigured && (
            <Alert tone="warning">
              Email sending is not set up on the server yet. Add <code>SMTP_HOST</code>, <code>SMTP_USER</code> and <code>SMTP_PASSWORD</code> to the server&apos;s <code>.env</code> file, then restart.
            </Alert>
          )}
          <ReadRows rows={[["Admin emails", settings.notifyEmails.join(", ")]]} />
          <div>
            <p className="text-xs text-muted">Sends an email when</p>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {NOTIFY.map(([key, label]) => (
                <li key={key} className={settings[key] ? "text-text" : "text-muted line-through"}>
                  {label}
                </li>
              ))}
            </ul>
          </div>
          <form action={testAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="notifyEmails" value={settings.notifyEmails.join(", ")} />
            <button type="submit" disabled={testing || settings.notifyEmails.length === 0} className={buttonClass("secondary", "sm")}>
              {testing ? "Sending…" : "Send a test email"}
            </button>
            {testState.message && <span className={`text-xs ${testState.ok ? "text-ok" : "text-bad"}`}>{testState.message}</span>}
          </form>
        </div>,
        <>
          <Field label="Admin emails to notify" htmlFor="notifyEmails" error={e.notifyEmails} hint="Separate with commas, e.g. info@keboint.com, shandongkeboint@gmail.com">
            <Textarea id="notifyEmails" name="notifyEmails" rows={2} className="min-h-0" defaultValue={v("notifyEmails")} />
          </Field>
          <fieldset>
            <legend className="text-sm font-medium text-text">Send an email when…</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {NOTIFY.map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 text-sm text-text-2 transition-colors hover:border-line-strong hover:bg-surface-2 has-[:checked]:border-primary/40 has-[:checked]:bg-primary-soft/40 has-[:checked]:text-text">
                  <input type="checkbox" name={key} defaultChecked={checked(key)} className="mt-0.5 size-4 accent-[var(--primary-solid)]" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </>,
      )}

      {section(
        "categories",
        "Sourcing categories",
        "Keep these the same as the dropdown on keboint.com.",
        <ul className="flex flex-wrap gap-1.5">
          {settings.categories.map((c) => (
            <li key={c} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-text-2">
              {c}
            </li>
          ))}
        </ul>,
        <Field label="One category per line" htmlFor="categories" error={e.categories}>
          <Textarea id="categories" name="categories" rows={8} defaultValue={v("categories")} />
        </Field>,
      )}

      {section(
        "company",
        "Company profile",
        "Printed on quotations, invoices and packing lists.",
        <ReadRows
          rows={[
            ["Company name", settings.companyName],
            ["Tax / registration no.", settings.companyTaxNo],
            ["Phone", settings.companyPhone],
            ["Email", settings.companyEmail],
            ["Website", settings.companyWebsite],
            ["Address", settings.companyAddress],
          ]}
        />,
        <>
          {text("companyName", "Company name", { required: true })}
          {text("companyTaxNo", "Tax / registration number")}
          {text("companyPhone", "Phone")}
          {text("companyEmail", "Email", { type: "email" })}
          {text("companyWebsite", "Website", { hint: "e.g. www.keboint.com" })}
          <Field label="Address" htmlFor="companyAddress" error={e.companyAddress} className="sm:col-span-2">
            <Textarea id="companyAddress" name="companyAddress" rows={2} className="min-h-0" defaultValue={v("companyAddress")} />
          </Field>
        </>,
        "grid gap-5 sm:grid-cols-2",
      )}

      {section(
        "money",
        "Money & defaults",
        "Defaults for new quotations and invoices. Sent documents keep their own currency.",
        <ReadRows
          rows={[
            ["Currency", settings.currency],
            ["Default tax rate", `${settings.defaultTaxRate}%`],
            ["Quotation valid for", `${settings.quotationValidityDays} days`],
            ["Invoice payment due in", `${settings.invoicePaymentDays} days`],
          ]}
        />,
        <>
          {text("currency", "Currency code", { required: true, hint: "e.g. USD" })}
          {text("defaultTaxRate", "Default tax rate (%)", { type: "number", step: "0.01", hint: "Usually 0 for export" })}
          {text("quotationValidityDays", "Quotation valid for (days)", { type: "number" })}
          {text("invoicePaymentDays", "Invoice payment due in (days)", { type: "number" })}
        </>,
        "grid gap-5 sm:grid-cols-2",
      )}

      {section(
        "reminders",
        "Reminders",
        "Checked every hour. Reminders go to the person handling it and to managers.",
        <ReadRows
          rows={[
            ["Pending longer than", `${settings.reminderPendingDays} days`],
            ["Processing longer than", `${settings.reminderProcessingDays} days`],
            ["Warn before deadlines", `${settings.reminderDueSoonDays} days`],
          ]}
        />,
        <>
          {text("reminderPendingDays", "Pending longer than (days)", { type: "number" })}
          {text("reminderProcessingDays", "Processing longer than (days)", { type: "number" })}
          {text("reminderDueSoonDays", "Warn before deadlines (days)", { type: "number" })}
        </>,
        "grid gap-5 sm:grid-cols-3",
      )}

      {section(
        "documents",
        "Quotations & invoices",
        "Printed on the documents you send to customers.",
        <ReadRows
          rows={[
            ["Default quotation terms", settings.defaultQuotationTerms],
            ["Bank details for T/T", settings.bankDetails],
            ["Invoice footer", settings.invoiceFooter],
          ]}
        />,
        <>
          <Field label="Default quotation terms & conditions" htmlFor="defaultQuotationTerms" error={e.defaultQuotationTerms}>
            <Textarea id="defaultQuotationTerms" name="defaultQuotationTerms" rows={5} defaultValue={v("defaultQuotationTerms")} />
          </Field>
          <Field label="Bank details for T/T" htmlFor="bankDetails" optional error={e.bankDetails} hint="Printed on every invoice: beneficiary, bank name, account no., SWIFT code, bank address">
            <Textarea
              id="bankDetails"
              name="bankDetails"
              rows={5}
              defaultValue={v("bankDetails")}
              placeholder={"Beneficiary: Shandong Kebo International Trade Co., Ltd.\nBank: …\nAccount no.: …\nSWIFT: …\nBank address: …"}
            />
          </Field>
          <Field label="Invoice footer" htmlFor="invoiceFooter" error={e.invoiceFooter}>
            <Input id="invoiceFooter" name="invoiceFooter" defaultValue={v("invoiceFooter")} />
          </Field>
        </>,
      )}
    </div>
  );
}
