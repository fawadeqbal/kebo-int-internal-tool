import { z } from "zod";
import { isISODate } from "@kebo/utils";
import { CURRENCIES } from "../enums";

/**
 * Building blocks for input schemas. Every schema accepts what a JSON client
 * sends and what an HTML form sends (strings), and turns empty text into null,
 * so the API and the web share one schema per action.
 */

export const text = (max: number, message?: string) =>
  z
    .string()
    .trim()
    .min(1, message ?? "Required")
    .max(max);

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

/**
 * Empty form fields ("", null) mean "not given", never 0: a blank cost is an
 * uncosted line, a blank deposit takes the default, a blank price is an error.
 */
const blank = (v: unknown) => (v === "" || v === null || (typeof v === "string" && v.trim() === "") ? undefined : v);

/**
 * At most `places` decimals (what the database column can hold), checked on the
 * number's shortest text ("154002876.02"), not with floating-point maths that
 * refuses large amounts. Exponent forms (1e-7, 1.5e+21) count their real decimals.
 */
export const decimals = (places: number) => (v: number) => {
  if (!Number.isFinite(v)) return false;
  const m = /^-?\d*(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(v));
  if (!m) return false;
  return Math.max((m[1] ?? "").length - Number(m[2] ?? 0), 0) <= places;
};

/** Money columns are NUMERIC(14,2): up to 999,999,999,999.99. Single amounts stay well below that so totals fit too. */
export const MAX_AMOUNT = 9_999_999_999.99;

/** A required money amount: non-negative, at most 2 decimals. */
export const amount = (message = "Enter an amount") =>
  z.preprocess(
    blank,
    z.coerce
      .number({ message })
      .min(0, "Cannot be negative")
      .max(MAX_AMOUNT, "That amount is too large")
      .refine(decimals(2), "Use at most 2 decimals"),
  );

/** A money amount where a blank field takes `fallback` (e.g. no discount = 0). */
export const amountOr = (fallback: number) =>
  z.preprocess(
    blank,
    z.coerce
      .number()
      .min(0, "Cannot be negative")
      .max(MAX_AMOUNT, "That amount is too large")
      .refine(decimals(2), "Use at most 2 decimals")
      .default(fallback),
  );

/** An optional money amount: blank → null. */
export const optionalAmount = z.preprocess(
  (v) => blank(v) ?? null,
  z.coerce
    .number()
    .min(0, "Cannot be negative")
    .max(MAX_AMOUNT, "That amount is too large")
    .refine(decimals(2), "Use at most 2 decimals")
    .nullable(),
);

const percentNumber = z.coerce
  .number({ message: "Enter a percentage" })
  .min(0, "Cannot be negative")
  .max(100, "Cannot be more than 100%")
  .refine(decimals(2), "Use at most 2 decimals");

/** A required percentage 0–100 with at most 2 decimals. */
export const percent = z.preprocess(blank, percentNumber);

/** A percentage where a blank field takes `fallback`. */
export const percentOr = (fallback: number) => z.preprocess(blank, percentNumber.default(fallback));

/** Quantities are NUMERIC(12,2): at least 0.01, at most 2 decimals. */
export const quantity = z.preprocess(
  blank,
  z.coerce
    .number({ message: "Enter a quantity" })
    .min(0.01, "Quantity must be more than 0")
    .max(10_000_000, "That quantity is too large")
    .refine(decimals(2), "Use at most 2 decimals for the quantity"),
);

/** An optional positive rate (exchange rate): blank → null. */
export const optionalRate = z.preprocess(
  (v) => blank(v) ?? null,
  z.coerce.number().positive("Must be more than 0").max(1_000_000).refine(decimals(6), "Use at most 6 decimals").nullable(),
);

/** One of the business's currencies (USD, CNY, PKR); typed codes are accepted in any case. */
export const currency = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
  z.enum(CURRENCIES, `Choose ${CURRENCIES.join(", ")}`),
);

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
