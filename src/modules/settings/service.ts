import * as React from "react";
import { z } from "zod";
import { db, type DbOrTx } from "@/lib/db";
import { settings } from "@/lib/db/schema";

const checkbox = z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean());

/** One item per line → list (blank lines removed). */
const lines = z.preprocess(
  (v) => (typeof v === "string" ? v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) : v),
  z.array(z.string().max(120)).max(50),
);

/** Comma / space / new-line separated emails → list. */
const emailList = z.preprocess(
  (v) => (typeof v === "string" ? v.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean) : v),
  z.array(z.email({ message: "One of the notification emails is not valid" })).max(20),
);

export const settingsSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  companyAddress: z.string().trim().max(500).default(""),
  companyPhone: z.string().trim().max(60).default(""),
  companyEmail: z.union([z.literal(""), z.email("Enter a valid email")]).default(""),
  companyTaxNo: z.string().trim().max(60).default(""),
  currency: z.string().trim().min(1).max(10).default("USD"),
  defaultTaxRate: z.coerce.number().min(0, "Tax cannot be negative").max(100, "Tax cannot exceed 100%"),
  quotationValidityDays: z.coerce.number().int().min(1).max(365),
  invoicePaymentDays: z.coerce.number().int().min(0).max(365),
  reminderPendingDays: z.coerce.number().int().min(1).max(90),
  reminderProcessingDays: z.coerce.number().int().min(1).max(180),
  reminderDueSoonDays: z.coerce.number().int().min(1).max(60),
  defaultQuotationTerms: z.string().trim().max(5000).default(""),
  invoiceFooter: z.string().trim().max(1000).default(""),
  /** Product categories offered in the query form (and on the website form). */
  categories: lines.refine((v) => v.length > 0, "Add at least one category"),
  /** Admin emails that receive notifications. */
  notifyEmails: emailList,
  notifyNewQuery: checkbox,
  notifyClosed: checkbox,
  notifyQuotation: checkbox,
  notifyPayment: checkbox,
  notifyDailySummary: checkbox,
});

export type AppSettings = z.infer<typeof settingsSchema>;

/** Same list and order as the "Sourcing Category" dropdown on keboint.com. */
export const DEFAULT_CATEGORIES = [
  "Pharmaceutical Machinery",
  "Medical Devices & Equipment",
  "Laboratory Equipment",
  "Food Processing Machinery",
  "Beverage Machinery",
  "Cosmetics Manufacturing Machinery",
  "Utility & HVAC Systems",
  "Textile Machinery",
  "Solar System Solutions",
  "General Order Supply",
];

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: "Shandong Kebo International Trade Co., Ltd.",
  companyAddress: "No. 5, Jielu Road, High-tech Zone, Jining, Shandong, China",
  companyPhone: "+86 151 5475 4812",
  companyEmail: "info@keboint.com",
  companyTaxNo: "",
  currency: "USD",
  defaultTaxRate: 0,
  quotationValidityDays: 15,
  invoicePaymentDays: 30,
  reminderPendingDays: 1,
  reminderProcessingDays: 7,
  reminderDueSoonDays: 3,
  defaultQuotationTerms:
    "1. Payment: 30% advance by bank transfer (T/T); 70% balance after the QC inspection report.\n2. Letters of Credit (L/C) accepted for large projects.\n3. Trade terms: FOB / CIF / DDP as stated above.\n4. Prices are valid until the date shown on this quotation.",
  invoiceFooter: "Thank you for your business.",
  categories: DEFAULT_CATEGORIES,
  notifyEmails: [],
  notifyNewQuery: true,
  notifyClosed: true,
  notifyQuotation: true,
  notifyPayment: true,
  notifyDailySummary: true,
};

const SETTINGS_KEY = "app";

export async function loadSettings(tx: DbOrTx = db): Promise<AppSettings> {
  const rows = await tx.select().from(settings);
  const stored = rows.find((r) => r.key === SETTINGS_KEY)?.value as Partial<AppSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

/**
 * Cached once per request inside Next.js. The worker process (plain Node) has no
 * request cache, so there it simply loads the settings.
 */
const perRequest = (React as { cache?: <T>(fn: T) => T }).cache ?? (<T,>(fn: T) => fn);
export const getSettings = perRequest(() => loadSettings());

export async function saveSettings(tx: DbOrTx, value: AppSettings) {
  await tx
    .insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
