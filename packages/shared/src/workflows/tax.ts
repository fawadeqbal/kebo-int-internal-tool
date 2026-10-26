import { formatMinor, withTaxMinor, type Minor } from "@kebo/money";

/**
 * Tax is only on factory items: each item's price is without tax and its tax %
 * (13 unless changed) is added on top. Price + tax is what one unit costs Kebo.
 * Sales carry no tax.
 */

export const DEFAULT_TAX_RATE = 13;
/** Quick choices for an item's tax %. */
export const TAX_CHOICES = [13, 9, 3, 0] as const;

/** "CNY 100.00 + 13% tax = CNY 113.00", or "CNY 100.00, no tax". */
export function taxSentence(unitPriceMinor: Minor, taxRate: number, currency: string): string {
  const rate = Number(taxRate) || 0;
  if (rate <= 0) return `${formatMinor(unitPriceMinor, currency)}, no tax`;
  return `${formatMinor(unitPriceMinor, currency)} + ${rate}% tax = ${formatMinor(withTaxMinor(unitPriceMinor, rate), currency)}`;
}
