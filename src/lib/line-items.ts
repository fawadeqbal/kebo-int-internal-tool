import { z } from "zod";

/** Units offered in every line editor (any other short text is allowed too). */
export const UNITS = ["pcs", "set", "unit", "lot", "kg", "ton", "m", "m²", "m³", "L", "carton", "roll", "pair"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const optionalId = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.uuid().nullable())
  .nullable()
  .optional();

const quantity = z.coerce.number({ message: "Enter a quantity" }).positive("Quantity must be more than 0").max(1_000_000);
const unit = z
  .string()
  .trim()
  .max(20, "Unit is too long")
  .transform((v) => v || "pcs")
  .default("pcs");

/**
 * The part of a line that is the same on every document: the item (first line
 * of the description = its name, more lines = details), brand/model, quantity
 * and unit. `sourceId` is the line it came from on the step before (requested
 * item → quotation line → invoice line → packing line), so each step starts
 * from the last one instead of retyping.
 */
export const baseLineSchema = z.object({
  id: optionalId,
  sourceId: optionalId,
  description: z.string().trim().min(1, "Each line needs a description").max(2000),
  model: optionalText(120),
  quantity,
  unit,
});

/** A priced line (quotation, invoice). */
export const lineItemSchema = baseLineSchema.extend({
  hsCode: optionalText(20),
  unitPrice: z.coerce.number({ message: "Enter a price" }).min(0, "Price cannot be negative").max(1_000_000_000_000),
});

/** A requested item on an inquiry: no price yet. */
export const requestedItemSchema = baseLineSchema.omit({ sourceId: true });

/** Lines arrive as one JSON array (built by the line editor; the app sends the same). */
export function jsonLines<S extends z.ZodTypeAny>(item: S, emptyMessage: string) {
  return z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: emptyMessage });
        return z.NEVER;
      }
    })
    .pipe(z.array(item).min(1, emptyMessage).max(200, "Too many lines"));
}

export const lineItemsField = jsonLines(lineItemSchema, "Add at least one line item");
export const requestedItemsField = jsonLines(requestedItemSchema, "Add at least one item the customer needs");

export const moneyField = (label: string) =>
  z.coerce.number({ message: `Enter ${label}` }).min(0, `${label[0].toUpperCase()}${label.slice(1)} cannot be negative`).max(1_000_000_000_000);

export const taxRateField = z.coerce.number({ message: "Enter the tax rate" }).min(0, "Tax cannot be negative").max(100, "Tax cannot exceed 100%");

export const isoDate = (message: string) => z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, message);

export type LineItem = z.infer<typeof lineItemSchema>;
export type RequestedItem = z.infer<typeof requestedItemSchema>;

/** The item name and its details, from a description (first line / the rest). */
export function splitDescription(description: string): { name: string; details: string } {
  const [name = "", ...rest] = description.split(/\r?\n/);
  return { name: name.trim(), details: rest.join("\n").trim() };
}

/** One-line summary of requested items for titles and lists: "Tablet press + 2 more". */
export function itemsSummary(items: { description: string }[], max = 90): string {
  const first = splitDescription(items[0]?.description ?? "").name.replace(/[.\s]+$/, "");
  if (!first) return "";
  const more = items.length > 1 ? ` + ${items.length - 1} more` : "";
  const room = max - more.length;
  const name = first.length <= room ? first : `${first.slice(0, Math.max(first.slice(0, room).lastIndexOf(" "), room - 20))}…`;
  return name + more;
}

/** A line as the editors hold it (every value as text, like a form). */
export interface EditableLine {
  id?: string;
  /** The line it came from on the step before. */
  sourceId?: string;
  description: string;
  model: string;
  hsCode: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

export const emptyLine = (): EditableLine => ({ description: "", model: "", hsCode: "", quantity: "1", unit: "pcs", unitPrice: "" });

/** A stored line (any document) → editor line. `sourceId` = the stored line's own id, to carry it to the next step. */
export function toEditableLine(
  row: { id?: string; description: string; model?: string | null; hsCode?: string | null; quantity: string | number; unit?: string | null; unitPrice?: string | number | null },
  opts: { asSource?: boolean; keepId?: boolean; sourceId?: string | null; withPrice?: boolean } = {},
): EditableLine {
  return {
    ...(opts.keepId && row.id ? { id: row.id } : {}),
    ...(opts.asSource && row.id ? { sourceId: row.id } : opts.sourceId ? { sourceId: opts.sourceId } : {}),
    description: row.description,
    model: row.model ?? "",
    hsCode: row.hsCode ?? "",
    quantity: String(Number(row.quantity)),
    unit: row.unit || "pcs",
    unitPrice: opts.withPrice === false || row.unitPrice === undefined || row.unitPrice === null ? "" : String(Number(row.unitPrice)),
  };
}
