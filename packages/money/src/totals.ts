import { allocate, multiplyMinor, toMinor, type DecimalLike, type Minor } from "./core";

export interface PricedLine {
  quantity: DecimalLike;
  unitPrice: DecimalLike;
}

export interface DocumentTotals {
  /** Each line: quantity × unit price, and its share of the discount. */
  lines: { lineTotal: Minor; discountShare: Minor }[];
  subtotal: Minor;
  discount: Minor;
  /** What the customer pays: subtotal less discount. */
  total: Minor;
}

/**
 * The single place where quotation and proforma totals are worked out:
 * total = subtotal − discount. Sales carry no tax (tax is only on factory
 * prices). The discount is never negative and never more than the subtotal,
 * and it is spread over the lines (by line total) so per-line profit adds up.
 */
export function documentTotals(lines: PricedLine[], discountInput: DecimalLike): DocumentTotals {
  const lineTotals = lines.map((l) => multiplyMinor(toMinor(l.unitPrice), Number(l.quantity ?? 0)));
  const subtotal = lineTotals.reduce((s, t) => s + t, 0);
  const discount = Math.min(Math.max(toMinor(discountInput), 0), Math.max(subtotal, 0));
  const shares = allocate(discount, lineTotals);
  return { lines: lineTotals.map((lineTotal, i) => ({ lineTotal, discountShare: shares[i] })), subtotal, discount, total: subtotal - discount };
}
