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
  companyName: z.string().trim().min(2, "Enter the company name").max(200),
  contactPerson: z.string().trim().min(2, "Enter the contact person's name").max(120),
  phone: z
    .string()
    .trim()
    .min(7, "Enter a valid contact number")
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
  notes: optional(2000),
  allowDuplicate: z.string().optional(),
});

export type CustomerInput = z.infer<typeof customerSchema>;

/** Phone numbers compared by digits only, so "0300-1234567" matches "0300 1234567". */
export const normalizePhone = (phone: string) => phone.replace(/\D/g, "").replace(/^92/, "0");
