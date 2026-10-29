import { z } from "zod";
import { BALANCE_TERMS, CURRENCIES, INCOTERMS } from "../enums";
import { DEFAULT_ORDER_REMINDER_DAYS } from "../workflows/order";

/**
 * Everything an admin can change, grouped. Each group is stored as one JSON
 * row in `settings` and read through these schemas, so a missing or older
 * value always comes back complete with defaults.
 */
const days = (fallback: number, max = 365) => z.coerce.number().int().min(0).max(max).default(fallback);

/**
 * The company's own details, printed on its documents: everything blank until
 * the company fills it in under Settings → Company (nothing here belongs to any
 * one company).
 */
export const companySettings = z.object({
  name: z.string().trim().min(1).max(200).default("Company"),
  nameLocal: z.string().trim().max(120).default(""),
  address: z.string().trim().max(500).default(""),
  phone: z.string().trim().max(60).default(""),
  email: z.string().trim().max(254).default(""),
  email2: z.string().trim().max(254).default(""),
  website: z.string().trim().max(120).default(""),
  /** Business license number (unified social credit code). */
  taxNo: z.string().trim().max(60).default(""),
  bankDetails: z.string().trim().max(1000).default(""),
  invoiceFooter: z.string().trim().max(1000).default(""),
  /** Starts every proforma number, e.g. KEB in KEB260916TN07. */
  proformaPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,6}$/, "Use 1 to 6 letters")
    .default("PI"),
  /** The company's logo at the top of every document (and beside its name in the app): a PNG/JPEG image as a data URL, or empty. */
  logo: z
    .string()
    .trim()
    .max(400_000, "The logo image is too large (keep it under 300 KB)")
    .refine((v) => v === "" || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v), "Upload the logo as a PNG or JPEG image")
    .default(""),
  /** The title beside the logo on documents (a short name, e.g. "KEBO"); empty: made from the company name. */
  brandMark: z.string().trim().max(24).default(""),
  /** The line under the title (e.g. "INTERNATIONAL TRADE"); empty: none. */
  brandTagline: z.string().trim().max(40).default(""),
  /** The company stamp (seal) printed on proforma invoices: a PNG/JPEG image as a data URL, or empty. */
  stamp: z
    .string()
    .trim()
    .max(400_000, "The stamp image is too large (keep it under 300 KB)")
    .refine((v) => v === "" || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v), "Upload the stamp as a PNG or JPEG image")
    .default(""),
});

export const salesSettings = z.object({
  /** Reports and totals are in it. */
  currency: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.enum(CURRENCIES, `Choose ${CURRENCIES.join(", ")}`)).default("USD"),
  /** 1 unit of the main currency buys N of each other currency (only the business's currencies are kept). */
  exchangeRates: z
    .record(z.string().trim(), z.coerce.number().positive("A rate must be more than 0"))
    .default({ CNY: 7.1 })
    .transform((r) =>
      Object.fromEntries(
        Object.entries(r)
          .map(([k, v]) => [k.toUpperCase(), v] as const)
          .filter(([k]) => (CURRENCIES as readonly string[]).includes(k)),
      ),
    ),
  defaultMarginPercent: z.coerce.number().min(0).max(95).default(15),
  quotationValidityDays: days(15),
  defaultDepositPercent: z.coerce.number().min(0).max(100).default(30),
  defaultBalanceTerms: z.enum(BALANCE_TERMS).default("before_shipment"),
  defaultIncoterm: z.enum(INCOTERMS).default("FOB"),
  /** Payment terms that go on every new quotation (beyond the deposit and balance). */
  defaultPaymentTerms: z.string().trim().max(5000).default(""),
  /** Delivery terms that go on every new quotation (packing, inspection, warranty…). */
  defaultDeliveryTerms: z.string().trim().max(5000).default(""),
  categories: z.array(z.string().trim().min(1).max(120)).default(["Machinery", "Chemicals", "Building materials", "Auto parts", "Other"]),
});

export const reminderSettings = z.object({
  /** Remind when a deal is still New after this many days. */
  newDays: days(1, 90),
  /** Remind when a deal has been Sourcing this long without a quotation. */
  sourcingDays: days(5, 180),
  /** "Due soon" window for quotation validity and needed-by dates. */
  dueSoonDays: days(3, 60),
  /** Orders: still Confirmed without the deposit after this many days. */
  depositDays: days(DEFAULT_ORDER_REMINDER_DAYS.depositDays, 180),
  /** Orders: In production this long when the factory gave no ready date. */
  productionDays: days(DEFAULT_ORDER_REMINDER_DAYS.productionDays, 365),
  /** Orders: Shipped with money still due this many days after the ship date. */
  balanceDays: days(DEFAULT_ORDER_REMINDER_DAYS.balanceDays, 365),
  /** Tell the managers when an order is this many days late. */
  escalateAfterDays: days(3, 60),
});

export const notificationSettings = z.object({
  emails: z.array(z.email()).max(20).default([]),
  newInquiry: z.boolean().default(true),
  dealWonOrLost: z.boolean().default(true),
  paymentReceived: z.boolean().default(true),
  dailySummary: z.boolean().default(true),
});

export const SETTINGS = {
  company: companySettings,
  sales: salesSettings,
  reminders: reminderSettings,
  notifications: notificationSettings,
} as const;

export type SettingsKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingsKey]: z.infer<(typeof SETTINGS)[K]> };

/** Read stored values (possibly partial or old) into complete settings. */
export function readSettings(stored: Partial<Record<string, unknown>>): Settings {
  const out = {} as Record<SettingsKey, unknown>;
  for (const key of Object.keys(SETTINGS) as SettingsKey[]) {
    const parsed = SETTINGS[key].safeParse(stored[key] ?? {});
    out[key] = parsed.success ? parsed.data : SETTINGS[key].parse({});
  }
  return out as Settings;
}

/** Words that do not tell a company apart ("Co., Ltd."), left out of the mark made from its name. */
const GENERIC_WORDS = new Set(["co", "company", "ltd", "limited", "llc", "inc", "corp", "corporation", "pvt", "private", "the", "group", "gmbh", "plc", "and", "&"]);

/** The big word on a company's documents: the one it chose, else its name's first one or two words ("Meray Company" → "MERAY"). */
export function brandMarkOf(mark: string | null | undefined, name: string): string {
  if (mark?.trim()) return mark.trim().toUpperCase();
  const words = name
    .replace(/[.,()]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !GENERIC_WORDS.has(w.toLowerCase()));
  const two = words.slice(0, 2).join(" ");
  return (two.length <= 14 ? two : (words[0] ?? name)).toUpperCase().slice(0, 24);
}
