import { BALANCE_TERMS, BALANCE_TERMS_LABEL, INCOTERMS, type SettingsKey } from "@kebo/shared";

/**
 * What each settings group shows, in plain words. The form draws these fields
 * and the action turns them back into the group's object for PUT /settings/:key
 * (see packages/shared/src/schemas/settings.ts for the rules).
 */
export type FieldKind = "text" | "textarea" | "number" | "bool" | "lines" | "rates" | "select" | "image";

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
    description: "Printed on quotations, invoices and packing lists.",
    save: "Save company details",
    fields: [
      { name: "name", label: "Company name", kind: "text", wide: true, hint: "The legal name in English, as on contracts" },
      { name: "nameLocal", label: "Name in Chinese", kind: "text", hint: "Printed above the English name", placeholder: "山东科波国际贸易有限公司" },
      { name: "taxNo", label: "Business license number", kind: "text", hint: "Unified social credit code" },
      { name: "address", label: "Address", kind: "textarea", wide: true },
      { name: "phone", label: "Phone", kind: "text" },
      { name: "website", label: "Website", kind: "text" },
      { name: "email", label: "Email", kind: "text", hint: "Where customers reply" },
      { name: "email2", label: "Second email", kind: "text", hint: "Also printed, if given" },
      { name: "bankDetails", label: "Bank details for customers", kind: "textarea", wide: true, hint: "Beneficiary, bank, SWIFT and account number, printed on invoices so customers can pay" },
      { name: "invoiceFooter", label: "Invoice footer", kind: "textarea", wide: true, hint: "A line at the bottom of every invoice, e.g. thanks or payment notes" },
      { name: "stamp", label: "Company stamp", kind: "image", wide: true, hint: "The red seal printed on proforma invoices. A PNG or JPEG under 300 KB, scanned on white." },
    ],
  },
  {
    key: "sales",
    title: "Sales and quotations",
    description: "Starting values for new quotations. People can change them on each quotation.",
    save: "Save sales settings",
    fields: [
      { name: "currency", label: "Main currency", kind: "text", hint: "Reports and totals are shown in it. Three letters, e.g. USD." },
      {
        name: "exchangeRates",
        label: "Exchange rates",
        kind: "rates",
        hint: "One line per currency: how many of it one unit of the main currency buys, e.g. CNY = 7.10. Used to turn factory prices into quotation prices.",
        placeholder: "CNY = 7.10\nEUR = 0.92",
      },
      { name: "defaultMarginPercent", label: "Usual margin", kind: "number", unit: "%", hint: "Added on top of the factory cost when a quotation is made" },
      { name: "quotationValidityDays", label: "Quotations are valid for", kind: "number", unit: "days", hint: "The customer must answer within this time" },
      { name: "defaultDepositPercent", label: "Usual deposit", kind: "number", unit: "%", hint: "Asked from the customer before production starts" },
      { name: "defaultBalanceTerms", label: "Usual balance terms", kind: "select", options: BALANCE_TERMS.map((b) => ({ value: b, label: BALANCE_TERMS_LABEL[b] })), hint: "When the rest of the money is due" },
      { name: "defaultIncoterm", label: "Usual Incoterm", kind: "select", options: INCOTERMS.map((i) => ({ value: i, label: i })), hint: "Who pays freight and insurance. FOB: we deliver onto the ship at the Chinese port." },
      { name: "defaultTerms", label: "Terms printed on quotations", kind: "textarea", wide: true, hint: "Payment, delivery and warranty terms that go on every new quotation" },
      { name: "categories", label: "Product categories", kind: "lines", wide: true, hint: "One per line. Every deal is filed under one of these." },
    ],
  },
  {
    key: "reminders",
    title: "Reminders",
    description: "When the app nudges people about work that is waiting.",
    save: "Save reminders",
    fields: [
      days("newDays", "Remind about a new deal after", "If a deal is still New after this many days, the person handling it (or the managers) gets a reminder"),
      days("sourcingDays", "Remind about sourcing after", "If a deal has been in Sourcing this long without a quotation"),
      days("dueSoonDays", "Warn about due dates", "How many days ahead to warn about quotations expiring and deals' needed-by dates"),
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
      { name: "dealWonOrLost", label: "A deal is won or lost", kind: "bool" },
      { name: "paymentReceived", label: "A customer payment is recorded", kind: "bool" },
      { name: "dailySummary", label: "Daily summary", kind: "bool", hint: "Each morning: new deals, late orders and money due" },
    ],
  },
];

/** Stored value → what the form box shows. */
export function toFormText(field: SettingField, value: unknown): string {
  if (field.kind === "rates") return Object.entries((value ?? {}) as Record<string, number>).map(([k, v]) => `${k} = ${v}`).join("\n");
  if (field.kind === "lines") return ((value ?? []) as string[]).join("\n");
  return value === null || value === undefined ? "" : String(value);
}
