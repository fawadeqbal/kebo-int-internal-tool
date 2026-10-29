import { BALANCE_TERMS, BALANCE_TERMS_LABEL, INCOTERMS, type SettingsKey } from "@kebo/shared";

/**
 * What each settings group shows, in plain words. The form draws these fields
 * and the action turns them back into the group's object for PUT /settings/:key
 * (see packages/shared/src/schemas/settings.ts for the rules).
 */
export type FieldKind = "text" | "textarea" | "number" | "bool" | "lines" | "currencies" | "select" | "image";

export interface SettingField {
  name: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  /** Shown after a number box ("days", "%"). */
  unit?: string;
  options?: { value: string; label: string }[];
  wide?: boolean;
  placeholder?: string;
  /** Images: what it is ("logo"), for "No logo" and "Remove the logo". */
  noun?: string;
  /** Images: made at most this many pixels wide and high before saving (a logo); none: kept as chosen. */
  maxPixels?: number;
}

export interface SettingGroup {
  key: SettingsKey;
  title: string;
  description: string;
  save: string;
  fields: SettingField[];
}

const days = (name: string, label: string, hint: string): SettingField => ({ name, label, hint, kind: "number", unit: "days" });

export const SETTING_GROUPS: SettingGroup[] = [
  {
    key: "company",
    title: "Company",
    description: "Printed on quotations, invoices and packing lists. The first five make the top of every document; the preview shows it as you type.",
    save: "Save company details",
    fields: [
      {
        name: "logo",
        label: "Logo",
        kind: "image",
        wide: true,
        noun: "logo",
        maxPixels: 360,
        hint: "At the top left of every document and beside the company name in the app. A square PNG or JPEG works best; without one, the title's initials show in a ring.",
      },
      { name: "brandMark", label: "Title on documents", kind: "text", hint: "The big word beside the logo, e.g. KEBO. Empty: made from the company name.", placeholder: "KEBO" },
      { name: "brandTagline", label: "Line under the title", kind: "text", hint: "Small letters under it, e.g. INTERNATIONAL TRADE. Empty: none.", placeholder: "INTERNATIONAL TRADE" },
      { name: "name", label: "Company name", kind: "text", hint: "The legal name in English, as on contracts" },
      { name: "nameLocal", label: "Name in Chinese", kind: "text", hint: "Printed beside the English name, if given" },
      { name: "taxNo", label: "Business license number", kind: "text", hint: "Unified social credit code" },
      { name: "address", label: "Address", kind: "textarea", wide: true },
      { name: "phone", label: "Phone", kind: "text" },
      { name: "website", label: "Website", kind: "text" },
      { name: "email", label: "Email", kind: "text", hint: "Where customers reply" },
      { name: "email2", label: "Second email", kind: "text", hint: "Also printed, if given" },
      { name: "bankDetails", label: "Bank details for customers", kind: "textarea", wide: true, hint: "Beneficiary, bank, SWIFT and account number, printed on invoices so customers can pay" },
      { name: "invoiceFooter", label: "Invoice footer", kind: "textarea", wide: true, hint: "A line at the bottom of every invoice, e.g. thanks or payment notes" },
      { name: "proformaPrefix", label: "Proforma number starts with", kind: "text", hint: "e.g. ABC in ABC260916TN07 (then the issue date, the customer's letters and the handler's count this year)" },
      { name: "stamp", label: "Company stamp", kind: "image", wide: true, noun: "stamp", hint: "The red seal printed on proforma invoices. A PNG or JPEG under 300 KB, scanned on white." },
    ],
  },
  {
    key: "sales",
    title: "Sales and quotations",
    description: "Starting values for new quotations. People can change them on each quotation.",
    save: "Save sales settings",
    fields: [
      {
        name: "currency",
        label: "Currencies",
        kind: "currencies",
        wide: true,
        hint: "Reports and totals are shown in the main currency. The rates turn factory prices into quotation prices, and convert amounts wherever a currency is changed.",
      },
      { name: "defaultMarginPercent", label: "Usual margin", kind: "number", unit: "%", hint: "Added on top of the factory cost when a quotation is made" },
      { name: "quotationValidityDays", label: "Quotations are valid for", kind: "number", unit: "days", hint: "The customer must answer within this time" },
      { name: "defaultDepositPercent", label: "Usual deposit", kind: "number", unit: "%", hint: "Asked from the customer before production starts" },
      { name: "defaultBalanceTerms", label: "Usual balance terms", kind: "select", options: BALANCE_TERMS.map((b) => ({ value: b, label: BALANCE_TERMS_LABEL[b] })), hint: "When the rest of the money is due" },
      { name: "defaultIncoterm", label: "Usual Incoterm", kind: "select", options: INCOTERMS.map((i) => ({ value: i, label: i })), hint: "Who pays freight and insurance. FOB: we deliver onto the ship at the Chinese port." },
      { name: "defaultPaymentTerms", label: "Payment terms on new quotations", kind: "textarea", wide: true, hint: "Printed under the deposit and balance, e.g. By T/T; L/C at sight accepted" },
      { name: "defaultDeliveryTerms", label: "Delivery terms on new quotations", kind: "textarea", wide: true, hint: "Printed under the delivery time, e.g. packing, inspection, warranty" },
      { name: "categories", label: "Product categories", kind: "lines", wide: true, hint: "One per line. Every inquiry is filed under one of these." },
    ],
  },
  {
    key: "reminders",
    title: "Reminders",
    description: "When the app nudges people about work that is waiting.",
    save: "Save reminders",
    fields: [
      days("newDays", "Remind about a new inquiry after", "If an inquiry is still New after this many days, the person handling it (or the managers) gets a reminder"),
      days("sourcingDays", "Remind about sourcing after", "If an inquiry has been in Sourcing this long without a quotation"),
      days("dueSoonDays", "Warn about due dates", "How many days ahead to warn about quotations expiring and inquiries' needed-by dates"),
      days("depositDays", "Remind when an order waits for its deposit", "If an order is still Confirmed without the deposit after this many days, the person handling it is reminded"),
      days("productionDays", "Remind when production has no ready date", "If an order has been In production this long and the factory gave no ready date, ask them for one"),
      days("balanceDays", "Remind about the balance after shipping", "If money is still due this many days after the goods were shipped, chase the customer for the balance"),
      days("escalateAfterDays", "Tell the managers after", "When an order is this many days late on what it needs, the managers are told"),
    ],
  },
  {
    key: "notifications",
    title: "Email notifications",
    description: "Emails to the admin list. Everyone also gets in-app notifications about their own work.",
    save: "Save notifications",
    fields: [
      { name: "emails", label: "Send to", kind: "lines", wide: true, hint: "Email addresses, one per line (up to 20). They get the emails switched on below.", placeholder: "boss@keboint.com" },
      { name: "newInquiry", label: "A new inquiry arrives", kind: "bool", hint: "From the website or entered by someone" },
      { name: "dealWonOrLost", label: "An inquiry is won or lost", kind: "bool" },
      { name: "paymentReceived", label: "A customer payment is recorded", kind: "bool" },
      { name: "dailySummary", label: "Daily summary", kind: "bool", hint: "Each morning: new inquiries, late orders and money due" },
    ],
  },
];

/** Stored value → what the form box shows. */
export function toFormText(field: SettingField, value: unknown): string {
  if (field.kind === "lines") return ((value ?? []) as string[]).join("\n");
  return value === null || value === undefined ? "" : String(value);
}
