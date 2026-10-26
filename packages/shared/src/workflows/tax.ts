import { formatMinor, roundHalfAway, type Minor } from "@kebo/money";
import { addDays, type ISODate } from "@kebo/utils";

/**
 * Tax, one simple rule everywhere: a price is WITHOUT tax, and the tax % is
 * added on top (100 + 13% = 113). Nothing is set on factories or customers.
 *
 * - Buying: each factory price gets its tax % when it is entered (13% unless
 *   changed). An exporter gets part of that tax back, the export rebate:
 *   price × the product's rebate rate (set by its HS code), never more than the
 *   tax paid. It needs the factory's special VAT invoice and is filed within 90
 *   days of shipping.
 * - Selling: exports carry no tax; a customer in China pays 13% on top. The
 *   customer's country decides; a quotation can still be changed by hand.
 */

export const HOME_COUNTRY = "CN";
export const DOMESTIC_VAT_RATE = 13;

/** Tax on a sale to a customer in this country: none for exports. */
export const saleVatFor = (country: string | null | undefined): number => (country?.toUpperCase() === HOME_COUNTRY ? DOMESTIC_VAT_RATE : 0);

/** Tax % on a factory price unless changed, and the quick choices. */
export const DEFAULT_FACTORY_VAT = 13;
export const TAX_CHOICES = [13, 9, 3, 0] as const;

/** Common export rebate rates (the official rate depends on the product's HS code). */
export const REBATE_CHOICES = [13, 9, 6, 0] as const;

/** The rebate that really comes back: never more than the VAT on the invoice, nothing without one. */
export const effectiveRebate = (rebateRate: number, vatRate: number): number => Math.max(0, Math.min(Number(rebateRate) || 0, Number(vatRate) || 0));

/** Export rebate on a quantity of a factory price (without tax), in the factory's currency (minor units). */
export function rebateMinor(p: { unitPriceMinor: Minor; quantity: number; vatRate: number; rebateRate: number }): Minor {
  const rate = effectiveRebate(p.rebateRate, p.vatRate);
  if (rate <= 0) return 0;
  return roundHalfAway(p.unitPriceMinor * (rate / 100) * p.quantity);
}

/** A factory price explained in one line, e.g. "CNY 100.00 + 13% tax = CNY 113.00 · 13% rebate back · your cost CNY 100.00". */
export function costSentence(p: { unitPriceMinor: Minor; vatRate: number; rebateRate: number; costMinor: Minor; currency: string }): string {
  const money = (m: Minor) => formatMinor(m, p.currency);
  const vat = Number(p.vatRate) || 0;
  const rebate = effectiveRebate(p.rebateRate, vat);
  const price = vat > 0 ? `${money(p.unitPriceMinor)} + ${vat}% tax = ${money(roundHalfAway(p.unitPriceMinor * (1 + vat / 100)))}` : `${money(p.unitPriceMinor)}, no tax`;
  return [price, rebate > 0 ? `${rebate}% rebate back` : null, `your cost ${money(p.costMinor)}`].filter(Boolean).join(" · ");
}

/** Days from the export (ship date) to file the rebate, and when to start reminding. */
export const REBATE_FILING_DAYS = 90;
export const REBATE_REMIND_AFTER_DAYS = 60;
export const VAT_INVOICE_REMIND_AFTER_DAYS = 30;

/**
 * What the order's rebate paperwork needs now, if anything: the factory's VAT
 * invoice, then filing the rebate before the deadline.
 */
export function rebateNeeds(
  o: { shippedOn: ISODate | null; rebate: { amountMinor: Minor; currency: string }[]; vatInvoiceReceivedOn: ISODate | null; rebateFiledOn: ISODate | null },
  today: ISODate,
): { title: string; due: ISODate; late: boolean; deadline: ISODate } | null {
  const total = o.rebate.filter((r) => r.amountMinor > 0);
  if (!o.shippedOn || !total.length || o.rebateFiledOn) return null;
  const amount = total.map((r) => formatMinor(r.amountMinor, r.currency)).join(" + ");
  const deadline = addDays(o.shippedOn, REBATE_FILING_DAYS);
  const need = (title: string, due: ISODate) => ({ title, due, late: due < today, deadline });
  if (!o.vatInvoiceReceivedOn) return need(`Get the factory's special VAT invoice (rebate ${amount})`, addDays(o.shippedOn, VAT_INVOICE_REMIND_AFTER_DAYS));
  return need(`File the export rebate (${amount}) by ${deadline}`, addDays(o.shippedOn, REBATE_REMIND_AFTER_DAYS));
}
