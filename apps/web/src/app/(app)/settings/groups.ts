import { BALANCE_TERMS, BALANCE_TERMS_LABEL, INCOTERMS, type SettingsKey } from "@kebo/shared";

/**
 * What each settings group shows, in plain words. The form draws these fields
 * and the action turns them back into the group's object for PUT /settings/:key
 * (see packages/shared/src/schemas/settings.ts for the rules).
 */
export type FieldKind = "text" | "textarea" | "number" | "bool" | "lines" | "rates" | "select";

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
      { name: "nameLocal", label: "Name in Chinese", kind: "text", hint: "Printed under the English name", placeholder: "山东科博国际贸易有限公司" },
      { name: "taxNo", label: "Tax number", kind: "text", hint: "Unified social credit code" },
      { name: "address", label: "Address", kind: "textarea", wide: true },
      { name: "phone", label: "Phone", kind: "text" },
      { name: "website", label: "Website", kind: "text" },
      { name: "email", label: "Email", kind: "text", hint: "Where customers reply" },
      { name: "email2", label: "Second email", kind: "text", hint: "Also printed, if given" },
      { name: "bankDetails", label: "Bank details for customers", kind: "textarea", wide: true, hint: "Beneficiary, bank, SWIFT and account number, printed on invoices so customers can pay" },
      { name: "invoiceFooter", label: "Invoice footer", kind: "textarea", wide: true, hint: "A line at the bottom of every invoice, e.g. thanks or payment notes" },
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
      { name: "vatRate", label: "VAT on our sales", kind: "number", unit: "%", hint: "0 for export sales; only domestic sales carry VAT" },
      { name: "pricesIncludeVat", label: "Our prices include VAT", kind: "bool", hint: "Tick if the prices we quote already contain the VAT above" },
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
      days("dueSoonDays", "Warn about due dates", "How many days ahead to warn about quotations expiring, invoices and order steps falling due"),
      days("escalateAfterDays", "Tell the managers after", "When an order step is this many days late, the managers are told"),
    ],
  },
  {
    key: "plan",
    title: "Order plan timings",
    description: "How many days each order step usually takes. Due dates on new orders are worked out from these; people can move a single due date on an order.",
    save: "Save plan timings",
    fields: [
      days("proformaDays", "Proforma invoice", "Days after the order to send the proforma invoice"),
      days("depositDays", "Customer deposit", "Days after the proforma for the customer's deposit to arrive"),
      days("factoryOrderDays", "Factory order", "Days after the deposit to place the order with the factory"),
      days("factoryDepositDays", "Factory deposit", "Days after the factory order to pay the factory's deposit"),
      days("factoryConfirmDays", "Factory confirms", "Days after the factory order for the factory to confirm the ready date"),
      days("samplesDays", "Samples approved", "Days after the factory confirms for samples to be approved"),
      days("inspectionLeadDays", "Inspection", "Inspect the goods this many days before the ship date"),
      days("factoryBalanceLeadDays", "Factory balance", "Pay the factory's balance this many days before shipping"),
      days("balanceAfterShipDays", "Customer balance (against B/L)", "When the balance is due against the B/L copy: days after shipping"),
      days("balanceAfterArrivalDays", "Customer balance (after arrival)", "When the balance is due after arrival: days after shipping (time at sea plus a few days)"),
      days("documentsDays", "Original documents", "Days after the balance is in (and the goods have left) to send the original documents"),
      days("vatInvoiceDays", "Factory VAT invoice", "Days after shipping to receive the factory's VAT invoice, needed for the export tax refund"),
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
      { name: "dailySummary", label: "Daily summary", kind: "bool", hint: "Each morning: new deals, late steps and money due" },
    ],
  },
];

/** Stored value → what the form box shows. */
export function toFormText(field: SettingField, value: unknown): string {
  if (field.kind === "rates") return Object.entries((value ?? {}) as Record<string, number>).map(([k, v]) => `${k} = ${v}`).join("\n");
  if (field.kind === "lines") return ((value ?? []) as string[]).join("\n");
  return value === null || value === undefined ? "" : String(value);
}
