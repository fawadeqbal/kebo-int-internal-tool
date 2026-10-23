import { z } from "zod";
import { priorityEnum, querySourceEnum, queryStatusEnum } from "@/lib/db/schema";
import { customerSchema } from "@/modules/customers/schema";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalUser = z
  .string()
  .trim()
  .refine((v) => v === "" || z.uuid().safeParse(v).success, "Choose a valid person")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** A short title from the first line of the requirements, when none is typed. */
export function titleFrom(requirements: string, category?: string | null): string {
  const first = (requirements.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "").replace(/[.\s]+$/, "");
  if (!first) return category ? `${category} inquiry` : "Inquiry";
  if (first.length <= 90) return first;
  const cut = first.slice(0, 90);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60))}…`;
}

export const queryDetailsSchema = z.object({
  source: z.enum(querySourceEnum.enumValues, { message: "Choose how the inquiry came in" }).default("phone"),
  title: optionalText(200),
  category: z.string().trim().min(1, "Choose a sourcing category").max(120),
  specifications: z.string().trim().min(5, "Write what the customer needs").max(20000),
  quantity: z.preprocess((v) => (v === "" || v === undefined ? 1 : v), z.coerce.number({ message: "Enter a quantity" }).int("Use a whole number").min(1, "At least 1").max(1_000_000)),
  priority: z.enum(priorityEnum.enumValues).default("normal"),
  requiredBy: optionalDate,
  assignedTo: optionalUser,
});

/** Create: either pick an existing customer or enter a new one in the same form. */
export const createQuerySchema = z.discriminatedUnion("customerMode", [
  queryDetailsSchema.extend({ customerMode: z.literal("existing"), customerId: z.uuid({ message: "Choose a customer" }) }),
  queryDetailsSchema.extend({ customerMode: z.literal("new") }).extend(customerSchema.shape),
]);

export const updateQuerySchema = queryDetailsSchema.omit({ assignedTo: true }).extend({
  customerId: z.uuid({ message: "Choose a customer" }),
});

export const statusChangeSchema = z
  .object({
    status: z.enum(queryStatusEnum.enumValues),
    reason: optionalText(2000),
  })
  .refine((v) => v.status !== "not_completed" || !!v.reason, {
    path: ["reason"],
    message: "Say why there is no order, e.g. bought elsewhere",
  });

export const assignSchema = z.object({ assignedTo: optionalUser });

export const commentSchema = z.object({ body: z.string().trim().min(1, "Write a note first").max(5000) });

export type CreateQueryInput = z.infer<typeof createQuerySchema>;
export type UpdateQueryInput = z.infer<typeof updateQuerySchema>;
