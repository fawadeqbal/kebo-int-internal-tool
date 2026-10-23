import { z } from "zod";

/** Line items arrive from the form as a JSON array (built by the line-item editor). */
export const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Each line needs a description").max(2000),
  quantity: z.coerce.number({ message: "Enter a quantity" }).positive("Quantity must be more than 0").max(1_000_000),
  unitPrice: z.coerce.number({ message: "Enter a price" }).min(0, "Price cannot be negative").max(1_000_000_000_000),
});

export const lineItemsField = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Add at least one line item" });
      return z.NEVER;
    }
  })
  .pipe(z.array(lineItemSchema).min(1, "Add at least one line item").max(200, "Too many lines"));

export const moneyField = (label: string) =>
  z.coerce.number({ message: `Enter ${label}` }).min(0, `${label[0].toUpperCase()}${label.slice(1)} cannot be negative`).max(1_000_000_000_000);

export const taxRateField = z.coerce.number({ message: "Enter the tax rate" }).min(0, "Tax cannot be negative").max(100, "Tax cannot exceed 100%");

export const isoDate = (message: string) => z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, message);

export type LineItem = z.infer<typeof lineItemSchema>;
