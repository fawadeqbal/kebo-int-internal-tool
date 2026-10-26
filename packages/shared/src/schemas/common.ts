import { z } from "zod";
import { isISODate } from "@kebo/utils";

/**
 * Building blocks for input schemas. Every schema accepts what a JSON client
 * sends and what an HTML form sends (strings), and turns empty text into null,
 * so the API and the web share one schema per action.
 */

export const text = (max: number, message?: string) => z.string().trim().min(1, message ?? "Required").max(max);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const isoDate = (message = "Use a valid date (YYYY-MM-DD)") => z.string().trim().refine(isISODate, message);

export const optionalDate = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isISODate(v), "Use a valid date (YYYY-MM-DD)");

export const id = (message = "Choose a valid record") => z.uuid({ message });

export const optionalId = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.uuid().safeParse(v).success, "Choose a valid record");

/** A decimal amount (money) as a non-negative number with at most 2 decimals. */
export const amount = (message = "Enter an amount") =>
  z.coerce
    .number({ message })
    .min(0, "Cannot be negative")
    .max(1_000_000_000_000)
    .refine((v) => Math.round(v * 100) === Math.round(v * 100 * 1e6) / 1e6, "Use at most 2 decimals");

export const percent = z.coerce.number({ message: "Enter a percentage" }).min(0, "Cannot be negative").max(100, "Cannot be more than 100%");

export const quantity = z.coerce.number({ message: "Enter a quantity" }).positive("Quantity must be more than 0").max(10_000_000);

export const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, e.g. USD");

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email");

export const phone = z
  .string()
  .trim()
  .max(40)
  .nullish()
  .transform((v) => (v ? v.replace(/[^\d+]/g, "") || null : null));

export const bool = z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean());

/** Lists: ?page=2&pageSize=25&q=valve */
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
});
export type ListQuery = z.infer<typeof listQuery>;
