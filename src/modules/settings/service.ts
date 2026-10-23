import * as React from "react";
import { z } from "zod";
import { db, type DbOrTx } from "@/lib/db";
import { settings } from "@/lib/db/schema";

export const settingsSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  companyAddress: z.string().trim().max(500).default(""),
  companyPhone: z.string().trim().max(60).default(""),
  companyEmail: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]).default(""),
  companyTaxNo: z.string().trim().max(60).default(""),
  currency: z.string().trim().min(1).max(10).default("PKR"),
  defaultTaxRate: z.coerce.number().min(0, "Tax cannot be negative").max(100, "Tax cannot exceed 100%"),
  quotationValidityDays: z.coerce.number().int().min(1).max(365),
  invoicePaymentDays: z.coerce.number().int().min(0).max(365),
  reminderPendingDays: z.coerce.number().int().min(1).max(90),
  reminderProcessingDays: z.coerce.number().int().min(1).max(180),
  reminderDueSoonDays: z.coerce.number().int().min(1).max(60),
  defaultQuotationTerms: z.string().trim().max(5000).default(""),
  invoiceFooter: z.string().trim().max(1000).default(""),
});

export type AppSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: "Your Company Pvt Ltd",
  companyAddress: "Office address, City, Pakistan",
  companyPhone: "+92 300 0000000",
  companyEmail: "info@example.com",
  companyTaxNo: "",
  currency: "PKR",
  defaultTaxRate: 18,
  quotationValidityDays: 15,
  invoicePaymentDays: 30,
  reminderPendingDays: 2,
  reminderProcessingDays: 7,
  reminderDueSoonDays: 3,
  defaultQuotationTerms:
    "1. Prices are valid until the due date shown above.\n2. Delivery time starts after written confirmation and advance payment.\n3. Taxes are charged as per applicable law.",
  invoiceFooter: "Thank you for your business.",
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
