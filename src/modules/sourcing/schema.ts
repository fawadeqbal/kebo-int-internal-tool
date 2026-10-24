import { z } from "zod";
import { baseLineSchema, isoDate, jsonLines } from "@/lib/line-items";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const vatRate = z.preprocess((v) => (v === "" || v === undefined || v === null ? 0 : v), z.coerce.number({ message: "Enter the VAT %" }).min(0, "VAT cannot be negative").max(100, "VAT cannot be over 100%"));
const checkbox = z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean());

/** A factory (supplier). Only the name is required; the rest can be filled in later. */
export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Enter the factory's name").max(200),
  contactPerson: optional(120),
  phone: optional(40),
  wechat: optional(80),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  address: optional(500),
  defaultVatRate: vatRate.default(13),
  bankDetails: optional(1000),
  notes: optional(2000),
});

/** One line of what a factory offered: for which customer item (sourceId), its price and VAT. */
export const offerLineSchema = baseLineSchema.extend({
  unitPrice: z.coerce.number({ message: "Enter the factory's price" }).min(0, "Price cannot be negative").max(1_000_000_000_000),
  vatRate,
});

/** A factory offer for an inquiry. Pick a known factory, or type a new name to add it on the spot. */
export const offerSchema = z
  .object({
    supplierId: optional(40),
    newSupplierName: optional(200),
    reference: optional(80),
    quotedOn: isoDate("Choose the date of the factory's offer"),
    validUntil: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date")
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. CNY")
      .default("CNY"),
    pricesIncludeVat: checkbox,
    priceBasis: optional(60),
    leadTime: optional(120),
    paymentTerms: optional(1000),
    notes: optional(2000),
    items: jsonLines(offerLineSchema, "Add at least one line the factory offered"),
  })
  .refine((v) => !!(v.supplierId || v.newSupplierName), { path: ["supplierId"], message: "Choose the factory, or type a new one" });

/** { queryItemId: offerLineId | "" } — the factory line chosen for each requested item. */
export const choicesSchema = z.object({
  choices: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Nothing to save" });
        return z.NEVER;
      }
    })
    .pipe(z.record(z.uuid(), z.union([z.uuid(), z.literal(""), z.null()]))),
});

export type SupplierInput = z.infer<typeof supplierSchema>;
export type OfferInput = z.infer<typeof offerSchema>;
export type OfferLineInput = z.infer<typeof offerLineSchema>;
