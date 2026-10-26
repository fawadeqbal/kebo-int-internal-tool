import { z } from "zod";
import { BALANCE_TERMS, INCOTERMS } from "../enums";
import { DEFAULT_ORDER_REMINDER_DAYS } from "../workflows/order";

/**
 * Everything an admin can change, grouped. Each group is stored as one JSON
 * row in `settings` and read through these schemas, so a missing or older
 * value always comes back complete with defaults.
 */
const days = (fallback: number, max = 365) => z.coerce.number().int().min(0).max(max).default(fallback);

export const companySettings = z.object({
  name: z.string().trim().min(1).max(200).default("Shandong Kebo International Trade Co., Ltd."),
  nameLocal: z.string().trim().max(120).default(""),
  address: z.string().trim().max(500).default(""),
  phone: z.string().trim().max(60).default(""),
  email: z.string().trim().max(254).default(""),
  email2: z.string().trim().max(254).default(""),
  website: z.string().trim().max(120).default("keboint.com"),
  taxNo: z.string().trim().max(60).default(""),
  bankDetails: z.string().trim().max(1000).default(""),
  invoiceFooter: z.string().trim().max(1000).default(""),
});

export const salesSettings = z.object({
  currency: z.string().trim().toUpperCase().length(3).default("USD"),
  /** 1 unit of the main currency buys N of each other currency. */
  exchangeRates: z
    .record(z.string().trim().regex(/^[A-Za-z]{3}$/, "Use three-letter currency codes"), z.coerce.number().positive())
    .default({ CNY: 7.1 })
    .transform((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toUpperCase(), v]))),
  defaultMarginPercent: z.coerce.number().min(0).max(95).default(15),
  vatRate: z.coerce.number().min(0).max(100).default(0),
  pricesIncludeVat: z.boolean().default(false),
  quotationValidityDays: days(15),
  defaultDepositPercent: z.coerce.number().min(0).max(100).default(30),
  defaultBalanceTerms: z.enum(BALANCE_TERMS).default("before_shipment"),
  defaultIncoterm: z.enum(INCOTERMS).default("FOB"),
  defaultTerms: z.string().trim().max(5000).default(""),
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
