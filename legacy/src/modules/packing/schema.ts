import { z } from "zod";
import { isoDate } from "@/lib/line-items";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const decimal = (label: string, max: number) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? 0 : v), z.coerce.number({ message: `Enter the ${label}` }).min(0, `${label[0].toUpperCase()}${label.slice(1)} cannot be negative`).max(max));

/**
 * A packed invoice line. The item, model, quantity and unit come from the
 * invoice line (`sourceId`); the packing list adds only how it is packed.
 */
export const packingLineSchema = z
  .object({
    sourceId: z.uuid({ message: "This line is not on the invoice" }),
    packages: z.preprocess((v) => (v === "" ? 0 : v), z.coerce.number().int("Packages must be a whole number").min(0).max(100_000)),
    packageType: z.string().trim().min(1).max(40).default("Wooden case"),
    netWeight: decimal("net weight", 10_000_000),
    grossWeight: decimal("gross weight", 10_000_000),
    cbm: decimal("volume", 100_000),
  })
  .refine((l) => l.grossWeight === 0 || l.grossWeight >= l.netWeight, { message: "Gross weight cannot be less than net weight", path: ["grossWeight"] });

/** Lines arrive from the form as one JSON array (built by the packing editor). */
export const packingLinesField = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Add at least one line" });
      return z.NEVER;
    }
  })
  .pipe(z.array(packingLineSchema).min(1, "Tick at least one line that is shipped").max(200, "Too many lines"));

export const packingListSchema = z.object({
  items: packingLinesField,
  packDate: isoDate("Choose the packing date"),
  incoterm: optionalText(60),
  portOfLoading: optionalText(120),
  portOfDischarge: optionalText(120),
  finalDestination: optionalText(160),
  transport: optionalText(160),
  containerNo: optionalText(200),
  sealNo: optionalText(120),
  marks: optionalText(1000),
  notes: optionalText(2000),
});

export type PackingListInput = z.infer<typeof packingListSchema>;
