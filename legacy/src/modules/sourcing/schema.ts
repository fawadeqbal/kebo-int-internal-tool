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
/** Yes / no / not sent (a form sends "off" then "on" when ticked; the last one counts). */
const yesNo = z.preprocess((v) => {
  const last = Array.isArray(v) ? v.at(-1) : v;
  if (last === undefined || last === null || last === "") return undefined;
  return last === "on" || last === true || last === "true";
}, z.boolean().optional());
const optionalVat = z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : v), z.coerce.number({ message: "Enter the VAT %" }).min(0, "VAT cannot be negative").max(100, "VAT cannot be over 100%").optional());

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
  /** Whether their prices usually include that VAT (left out = unchanged; yes for a new factory). */
  pricesIncludeVat: yesNo,
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

/**
 * The simple way: one factory price for one customer item. The factory is
 * typed by name (an existing one is matched, a new one is added).
 */
export const itemPriceSchema = z
  .object({
    /** An existing factory picked from the list… */
    supplierId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
    /** …or a new one: its name (an existing factory with the same name is used instead). */
    factoryName: z.string().trim().max(200).optional(),
    /** In the main currency (USD). */
    unitPrice: z.coerce.number({ message: "Enter the factory's price for one unit" }).positive("Enter the factory's price for one unit").max(1_000_000_000_000),
    /** Left out = the factory's VAT (changed only for an item that differs, e.g. 6% on a service). */
    vatRate: optionalVat,
    pricesIncludeVat: yesNo,
    leadTime: optional(120),
    /** A new factory's contacts (saved on the factory; filled in on a known one only where it has none). */
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address")
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    phone: optional(40),
  })
  .refine((v) => v.supplierId || (v.factoryName && v.factoryName.length >= 2), { path: ["factoryName"], message: "Choose the factory, or type a new one's name" });

export type ItemPriceInput = z.infer<typeof itemPriceSchema>;

