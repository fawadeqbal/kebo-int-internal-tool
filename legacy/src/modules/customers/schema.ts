import { z } from "zod";

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const customerSchema = z.object({
  companyName: optional(200),
  contactPerson: z.string().trim().min(2, "Enter the customer's full name").max(120),
  phone: z
    .string()
    .trim()
    .min(7, "Enter a phone / WhatsApp number with country code")
    .max(40)
    .regex(/^[+\d][\d\s\-()]{6,}$/, "Use digits, spaces, + - ( ) only"),
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
  taxNo: optional(60),
  /** Their documents carry no VAT (e.g. export). Left out = unchanged. Only managers and the super admin can set it. */
  vatExempt: z.preprocess((v) => {
    const last = Array.isArray(v) ? v.at(-1) : v;
    return last === undefined || last === null ? undefined : last === "on" || last === true || last === "true";
  }, z.boolean().optional()),
  notes: optional(2000),
  allowDuplicate: z.string().optional(),
});

export type CustomerInput = z.infer<typeof customerSchema>;

/** Phone numbers compared by digits only, so "0300-1234567" matches "0300 1234567". */
export const normalizePhone = (phone: string) => phone.replace(/\D/g, "").replace(/^92/, "0");
