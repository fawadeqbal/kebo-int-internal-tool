import { z } from "zod";
import { BALANCE_TERMS, INCOTERMS } from "../enums";
import { DEFAULT_ORDER_REMINDER_DAYS } from "../workflows/order";

/**
 * Everything an admin can change, grouped. Each group is stored as one JSON
 * row in `settings` and read through these schemas, so a missing or older
 * value always comes back complete with defaults.
 */
const days = (fallback: number, max = 365) => z.coerce.number().int().min(0).max(max).default(fallback);

/** Kebo's details as on its proforma invoices (used until changed in Settings). */
export const companySettings = z.object({
  name: z.string().trim().min(1).max(200).default("Shandong Kebo International Trade Co., Ltd."),
  nameLocal: z.string().trim().max(120).default("山东科波国际贸易有限公司"),
  address: z.string().trim().max(500).default("No.5, Jielu Road, High-Tech Zone, City Jining, Shandong, China"),
  phone: z.string().trim().max(60).default("+86-151-54754812  +86-178-53758700"),
  email: z.string().trim().max(254).default("shandongkeboint@gmail.com"),
  email2: z.string().trim().max(254).default(""),
  website: z.string().trim().max(120).default("www.keboint.com"),
  /** Business license number (unified social credit code). */
  taxNo: z.string().trim().max(60).default("91370811MAK4PH5B1N"),
  bankDetails: z
    .string()
    .trim()
    .max(1000)
    .default(
      "ACCOUNT NAME: SHANDONG KEBO INTERNATIONAL TRADE CO., LTD.\nBANK NAME: BANK OF CHINA RENCHENG SUB BRANCH\nBANK ADDRESS: B.O.C TOWER,1 TAIBAI ROAD JINING, SHANDONG, P, R. CHINA,\nPOST CODE: 272000\nSWIFT CODE: BKCHCNBJ500\nACCOUNT NO: 242895006310",
    ),
  invoiceFooter: z.string().trim().max(1000).default(""),
  /** Starts every proforma number, e.g. KEB in KEB260916TN07. */
  proformaPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,6}$/, "Use 1 to 6 letters")
    .default("KEB"),
  /** The company stamp (seal) printed on proforma invoices: a PNG/JPEG image as a data URL, or empty. */
  stamp: z
    .string()
    .trim()
    .max(400_000, "The stamp image is too large (keep it under 300 KB)")
    .refine((v) => v === "" || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v), "Upload the stamp as a PNG or JPEG image")
    .default(""),
});

export const salesSettings = z.object({
  currency: z.string().trim().toUpperCase().length(3).default("USD"),
  /** 1 unit of the main currency buys N of each other currency. */
  exchangeRates: z
    .record(z.string().trim().regex(/^[A-Za-z]{3}$/, "Use three-letter currency codes"), z.coerce.number().positive())
    .default({ CNY: 7.1 })
    .transform((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toUpperCase(), v]))),
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
