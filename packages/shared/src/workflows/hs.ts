/**
 * HS codes (25 Nov 2026). An item has the customer's country's code (on the customer's papers) and China's
 * (the supplier's, on the China customs copy): the first six digits are the same in every country, the digits
 * after them are each country's own, so the two can differ. China's empty: the same as the customer's.
 */

/** As typed: digits, with dots or spaces (8422.40, 8481 80 90). */
export const HS_CODE = /^[0-9][0-9. ]{3,18}$/;
export const HS_CODE_HINT = "An HS code is digits, e.g. 8422.40.";

/** The code's digits only (8422.40 → 842240). */
export const hsDigits = (code: string | null | undefined) => (code ?? "").replace(/\D/g, "");

/** Both codes given and their first six digits differ: one of them is likely wrong. */
export function hsMismatch(customer: string | null | undefined, china: string | null | undefined): boolean {
  const a = hsDigits(customer);
  const b = hsDigits(china);
  return a.length >= 6 && b.length >= 6 && a.slice(0, 6) !== b.slice(0, 6);
}

/** Which code a copy prints: China's on the China customs copy (else the customer's), the customer's on the others. */
export function hsFor(copy: "customer" | "customs", customer: string | null | undefined, china: string | null | undefined): string | null {
  return (copy === "customs" ? china?.trim() || customer?.trim() : customer?.trim()) || null;
}
