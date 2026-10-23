import { z } from "zod";
import { paymentMethodEnum } from "@/lib/db/schema";
import { isoDate, lineItemsField, moneyField, taxRateField } from "@/lib/line-items";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const invoiceSchema = z
  .object({
    items: lineItemsField,
    discount: moneyField("discount").default(0),
    taxRate: taxRateField,
    issueDate: isoDate("Choose the invoice date"),
    dueDate: isoDate("Choose the payment due date"),
    notes: optionalText(2000),
  })
  .refine((v) => v.dueDate >= v.issueDate, { path: ["dueDate"], message: "The due date cannot be before the invoice date" });

export const paymentSchema = z.object({
  amount: z.coerce.number({ message: "Enter the amount received" }).positive("Amount must be more than 0"),
  paidAt: isoDate("Choose the payment date"),
  method: z.enum(paymentMethodEnum.enumValues),
  reference: optionalText(120),
});

export const cancelInvoiceSchema = z.object({ reason: z.string().trim().min(3, "Explain why the invoice is cancelled").max(1000) });

export type InvoiceInput = z.infer<typeof invoiceSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
