import { BALANCE_TERMS, BALANCE_TERMS_LABEL, COLOUR_SET_LABEL, COLOUR_SETS, INCOTERMS, type SettingsKey } from "@kebo/shared";

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
  /** A tick's words when shown (default On / Off). */
  on?: string;
  off?: string;
  placeholder?: string;
  /** Images: what it is ("logo"), for "No logo" and "Remove the logo". */
  noun?: string;
  /** Images: made at most this many pixels wide and high before saving (a logo); none: kept as chosen. */
  maxPixels?: number;
}

/**
 * One card of a settings section (design system: Settings frame): its values
 * read-only, ✎ Edit opens them in the side panel. `switches`: on/off rows that
 * save as they are switched, no panel.
 */
export interface SettingCard {
  key: string;
  title: string;
  /** What it holds, in one line. */
  description: string;
  fields: string[];
  switches?: boolean;
  /** Shows the top of the documents as these values make it. */
  preview?: boolean;
  /** The app's colours: the sets side by side, light and dark, chosen at once (no panel). */
  colours?: boolean;
}

export interface SettingGroup {
  key: SettingsKey;
  title: string;
  description: string;
  save: string;
  fields: SettingField[];
  cards: SettingCard[];
}

const days = (name: string, label: string, hint: string): SettingField => ({ name, label, hint, kind: "number", unit: "days" });

/** Every time zone, with how far it is from UTC now: "Asia/Karachi (GMT+5)". */
const ZONES = (() => {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
  const offset = (zone: string) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
    } catch {
      return "";
    }
  };
  return zones.map((z) => ({ value: z, label: `${z.replace(/_/g, " ")} (${offset(z)})` }));
})();

/** How a date and a time are written, each shown as it looks. */
const DATE_FORMAT_OPTIONS = [
  { value: "d_mmm_yyyy", label: "14 Nov 2026" },
  { value: "dd_mm_yyyy", label: "14/11/2026 (day first)" },
  { value: "mm_dd_yyyy", label: "11/14/2026 (month first)" },
  { value: "yyyy_mm_dd", label: "2026-11-14" },
];
const TIME_FORMAT_OPTIONS = [
  { value: "24h", label: "24-hour (15:30)" },
  { value: "12h", label: "12-hour (3:30 PM)" },
];

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
        hint: "PNG or JPEG",
        maxPixels: 360,
      },
      { name: "brandMark", label: "Title on documents", kind: "text" },
      { name: "brandTagline", label: "Line under the title", kind: "text" },
      { name: "name", label: "Company name", kind: "text" },
      { name: "nameLocal", label: "Name in Chinese", kind: "text" },
      { name: "taxNo", label: "Business license number", kind: "text" },
      { name: "address", label: "Address", kind: "textarea", wide: true },
      { name: "phone", label: "Phone", kind: "text" },
      { name: "website", label: "Website", kind: "text" },
      { name: "email", label: "Email", kind: "text" },
      { name: "email2", label: "Second email", kind: "text" },
      { name: "bankDetails", label: "Bank details for customers", kind: "textarea", wide: true },
      { name: "invoiceFooter", label: "Invoice footer", kind: "textarea", wide: true },
      { name: "proformaPrefix", label: "Proforma number starts with", kind: "text" },
      { name: "stamp", label: "Company stamp", kind: "image", wide: true, noun: "stamp", hint: "PNG or JPEG, under 300 KB" },
      {
        name: "timeZone",
        label: "Time zone",
        kind: "select",
        wide: true,
        options: ZONES,
      },
      { name: "dateFormat", label: "Dates", kind: "select", options: DATE_FORMAT_OPTIONS },
      { name: "timeFormat", label: "Times", kind: "select", options: TIME_FORMAT_OPTIONS },
      // Listed so that saving any other card keeps it as it is (the API takes the whole group).
      { name: "colours", label: "The app's colours", kind: "select", options: COLOUR_SETS.map((c) => ({ value: c, label: COLOUR_SET_LABEL[c] })) },
    ],
    cards: [
      {
        key: "brand",
        title: "The top of your documents",
        description: "Logo, title and names printed at the top of every quotation, invoice and packing list.",
        fields: ["logo", "brandMark", "brandTagline", "name", "nameLocal"],
        preview: true,
      },
      {
        key: "contact",
        title: "Contact details",
        description: "Printed under the top of every document, so customers know how to reach you.",
        fields: ["taxNo", "address", "phone", "website", "email", "email2"],
      },
      {
        key: "invoices",
        title: "On invoices",
        description: "How customers pay you, the line at the bottom, the proforma number and the stamp.",
        fields: ["bankDetails", "invoiceFooter", "proformaPrefix", "stamp"],
      },
      {
        key: "time",
        title: "Time and dates",
        description:
          "The company's time zone and how dates and times are written, on every page, email and reminder. Papers for customers and suppliers always write 04 Sep 2026, so no one abroad misreads a date.",
        fields: ["timeZone", "dateFormat", "timeFormat"],
      },
      {
        key: "colours",
        title: "The app's colours",
        description: "How the app looks for everyone in the company. Choosing one changes it at once.",
        fields: ["colours"],
        colours: true,
      },
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
      },
      { name: "defaultMarginPercent", label: "Usual margin", kind: "number", unit: "%" },
      { name: "marginFloorPercent", label: "Warn when an order's margin falls under", kind: "number", unit: "%" },
      { name: "quotationValidityDays", label: "Quotations are valid for", kind: "number", unit: "days" },
      { name: "leadSpareDays", label: "Spare days on a supplier's lead time", kind: "number", unit: "days" },
      { name: "defaultDepositPercent", label: "Usual deposit", kind: "number", unit: "%" },
      { name: "defaultBalanceTerms", label: "Usual balance terms", kind: "select", options: BALANCE_TERMS.map((b) => ({ value: b, label: BALANCE_TERMS_LABEL[b] })) },
      { name: "defaultIncoterm", label: "Usual Incoterm", kind: "select", options: INCOTERMS.map((i) => ({ value: i, label: i })) },
      {
        name: "factoryTaxIncluded",
        label: "Tax included in supplier prices",
        kind: "bool",
        on: "Included",
        off: "Added on top",
      },
      { name: "factoryTaxRate", label: "Supplier tax", kind: "number", unit: "%" },
      { name: "factoryAdvancePercent", label: "Supplier deposit", kind: "number", unit: "%" },
      { name: "exportVatRefundPercent", label: "Export VAT refund", kind: "number", unit: "%" },
      { name: "defaultPaymentTerms", label: "Payment terms on new quotations", kind: "textarea", wide: true },
      { name: "defaultDeliveryTerms", label: "Incoterm on new quotations", kind: "textarea", wide: true },
      { name: "warrantyTerms", label: "Warranty on sales contracts", kind: "textarea", wide: true },
      { name: "categories", label: "Product categories", kind: "lines", wide: true, hint: "One per line" },
    ],
    cards: [
      {
        key: "currencies",
        title: "Currencies",
        description: "The main currency of reports and totals, and what one unit of it buys in the others.",
        fields: ["currency"],
      },
      {
        key: "quotations",
        title: "New quotations start with",
        description: "Margin, validity, deposit and terms. Made from a supplier's offer, a quotation takes its port, its warranty and its days plus the spare days, and is never valid longer than its prices. People can change them on each quotation.",
        fields: ["defaultMarginPercent", "marginFloorPercent", "quotationValidityDays", "leadSpareDays", "defaultDepositPercent", "defaultBalanceTerms", "defaultIncoterm"],
      },
      {
        key: "factory",
        title: "Supplier offers start with",
        description: "Tax and the deposit we pay when we order (each offer can say otherwise), and the export VAT refund taken off their tax in what a quotation costs us (0 when there is none).",
        fields: ["factoryTaxIncluded", "factoryTaxRate", "exportVatRefundPercent", "factoryAdvancePercent"],
      },
      {
        key: "terms",
        title: "Printed terms",
        description: "Payment, delivery and warranty wording on new quotations and contracts.",
        fields: ["defaultPaymentTerms", "defaultDeliveryTerms", "warrantyTerms"],
      },
      {
        key: "categories",
        title: "Product categories",
        description: "Every inquiry is filed under one of these.",
        fields: ["categories"],
      },
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
      days("productionDays", "Remind when production has no ready date", "If an order has been In production this long and the supplier gave no ready date, ask them for one"),
      days("balanceDays", "Remind about the balance after shipping", "If money is still due this many days after the goods were shipped, chase the customer for the balance"),
      days("escalateAfterDays", "Tell the managers after", "When an order is this many days late on what it needs, the managers are told"),
    ],
    cards: [
      {
        key: "inquiries",
        title: "Inquiries and quotations",
        description: "When someone is nudged about an inquiry that waits, and how far ahead due dates warn.",
        fields: ["newDays", "sourcingDays", "dueSoonDays"],
      },
      {
        key: "orders",
        title: "Orders",
        description: "When the person handling an order is reminded, and when the managers are told.",
        fields: ["depositDays", "productionDays", "balanceDays", "escalateAfterDays"],
      },
    ],
  },
  {
    key: "notifications",
    title: "Email notifications",
    description: "Emails to the admin list. Everyone also gets in-app notifications about their own work.",
    save: "Save notifications",
    fields: [
      { name: "emails", label: "Send to", kind: "lines", wide: true, hint: "One per line, up to 20" },
      { name: "newInquiry", label: "A new inquiry arrives", kind: "bool" },
      { name: "dealWonOrLost", label: "An inquiry is won or lost", kind: "bool" },
      { name: "paymentReceived", label: "A customer payment is recorded", kind: "bool" },
      { name: "dailySummary", label: "Daily summary", kind: "bool" },
    ],
    cards: [
      {
        key: "recipients",
        title: "Who gets the emails",
        description: "The admin list: up to 20 addresses. They get the emails switched on below.",
        fields: ["emails"],
      },
      {
        key: "which",
        title: "Which emails",
        description: "Each switch saves at once.",
        fields: ["newInquiry", "dealWonOrLost", "paymentReceived", "dailySummary"],
        switches: true,
      },
    ],
  },
];

/** Stored value → what the form box shows. */
export function toFormText(field: SettingField, value: unknown): string {
  if (field.kind === "lines") return ((value ?? []) as string[]).join("\n");
  return value === null || value === undefined ? "" : String(value);
}
