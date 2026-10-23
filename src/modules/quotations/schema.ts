import { z } from "zod";
import { isoDate, lineItemsField, moneyField, taxRateField } from "@/lib/line-items";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const quotationSchema = z
  .object({
    items: lineItemsField,
    discount: moneyField("discount").default(0),
    taxRate: taxRateField,
    dueDate: isoDate("Choose the valid-until date"),
    submittedAt: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date")
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    terms: optionalText(5000),
    notes: optionalText(2000),
  });

export const quotationStatusSchema = z.object({
  status: z.enum(["sent", "accepted", "rejected", "expired"]),
  submittedAt: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date")
    .optional(),
});

export type QuotationInput = z.infer<typeof quotationSchema>;
