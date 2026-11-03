import { factoryTaxMinor, formatMinor, withTaxMinor, type Minor } from "@kebo/money";

/**
 * Tax is only on factory items. Each factory offer says whether its prices are
 * without tax (the tax % is added on top: price + tax is what one unit costs
 * us) or have the tax included (the price is the cost; the tax inside is only
 * shown). The offer has a tax % for its lines; a line can have its own.
 * New offers start at the company's default (Settings), Without tax · 0%.
 * Sales carry no tax.
 */

/** A new offer's tax % when the company has not set its own default. */
export const DEFAULT_TAX_RATE = 0;
/** Quick choices for an item's tax %. */
export const TAX_CHOICES = [13, 9, 3, 0] as const;

/**
 * "CNY 100.00 + 13% tax = CNY 113.00", "CNY 113.00, tax 13% included (CNY 13.00)",
 * or "CNY 100.00, no tax".
 */
export function taxSentence(unitPriceMinor: Minor, taxRate: number, currency: string, taxIncluded = false): string {
  const rate = Number(taxRate) || 0;
  if (rate <= 0) return `${formatMinor(unitPriceMinor, currency)}, no tax`;
  if (taxIncluded)
    return `${formatMinor(unitPriceMinor, currency)}, tax ${rate}% included (${formatMinor(factoryTaxMinor(unitPriceMinor, rate, true), currency)})`;
  return `${formatMinor(unitPriceMinor, currency)} + ${rate}% tax = ${formatMinor(withTaxMinor(unitPriceMinor, rate), currency)}`;
}

/** The offer's tax in a few words: "0% · added on top", "13% · included in the prices". */
export function offerTaxText(taxRate: number | string, taxIncluded: boolean): string {
  const rate = Number(taxRate) || 0;
  return taxIncluded ? `${rate}% · included in the prices` : `${rate}% · added on top`;
}

/** Under the factory in the offers table, when the rate is not 0: "+13% tax" / "tax incl. 13%". */
export function offerTaxTag(taxRate: number | string, taxIncluded: boolean): string | null {
  const rate = Number(taxRate) || 0;
  if (rate <= 0) return null;
  return taxIncluded ? `tax incl. ${rate}%` : `+${rate}% tax`;
}
