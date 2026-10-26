import { allocate, multiplyMinor, roundHalfAway, toMinor, type DecimalLike, type Minor } from "./core";

/**
 * How VAT applies to a document: the rate, and whether the prices typed on the
 * lines already include it (Chinese domestic pricing) or it is added on top.
 * Export sales are usually zero-rated (rate 0).
 */
export interface VatRule {
  rate: number;
  pricesIncludeVat: boolean;
}

export const NO_VAT: VatRule = { rate: 0, pricesIncludeVat: false };

/** The VAT inside an amount that includes it: 113.00 at 13% → 13.00. */
export const vatInside = (grossMinor: Minor, rate: number): Minor => (rate > 0 ? roundHalfAway((grossMinor * rate) / (100 + rate)) : 0);

/** VAT to add on top of a net amount: 100.00 at 13% → 13.00. */
export const vatOnTop = (netMinor: Minor, rate: number): Minor => (rate > 0 ? roundHalfAway((netMinor * rate) / 100) : 0);

/** The amount without VAT, under a rule. */
export const netOf = (amountMinor: Minor, vat: VatRule): Minor => (vat.pricesIncludeVat ? amountMinor - vatInside(amountMinor, vat.rate) : amountMinor);

export interface PricedLine {
  quantity: DecimalLike;
  unitPrice: DecimalLike;
}

export interface DocumentTotals {
  /** Each line: quantity × unit price, and its share of the discount. */
  lines: { lineTotal: Minor; discountShare: Minor }[];
  subtotal: Minor;
  discount: Minor;
  /** Subtotal less discount (VAT included in it when the prices include VAT). */
  afterDiscount: Minor;
  /** Total without VAT. */
  net: Minor;
  vatRate: number;
  pricesIncludeVat: boolean;
  /** The VAT: added on top, or the part of the total that is VAT. */
  vat: Minor;
  /** What the customer pays. */
  total: Minor;
}

/**
 * The single place where quotation, proforma and invoice totals are worked out.
 * VAT on top:      total = subtotal − discount + VAT
 * VAT included:    total = subtotal − discount, VAT is the part inside it
 * The discount is never negative and never more than the subtotal, and it is
 * spread over the lines (by line total) so per-line profit adds up exactly.
 */
export function documentTotals(lines: PricedLine[], discountInput: DecimalLike, vat: VatRule = NO_VAT): DocumentTotals {
  const lineTotals = lines.map((l) => multiplyMinor(toMinor(l.unitPrice), Number(l.quantity ?? 0)));
  const subtotal = lineTotals.reduce((s, t) => s + t, 0);
  const discount = Math.min(Math.max(toMinor(discountInput), 0), Math.max(subtotal, 0));
  const shares = allocate(discount, lineTotals);
  const afterDiscount = subtotal - discount;
  const rate = Math.max(Number(vat.rate) || 0, 0);
  if (vat.pricesIncludeVat) {
    const v = vatInside(afterDiscount, rate);
    return {
      lines: lineTotals.map((lineTotal, i) => ({ lineTotal, discountShare: shares[i] })),
      subtotal,
      discount,
      afterDiscount,
      net: afterDiscount - v,
      vatRate: rate,
      pricesIncludeVat: true,
      vat: v,
      total: afterDiscount,
    };
  }
  const v = vatOnTop(afterDiscount, rate);
  return {
    lines: lineTotals.map((lineTotal, i) => ({ lineTotal, discountShare: shares[i] })),
    subtotal,
    discount,
    afterDiscount,
    net: afterDiscount,
    vatRate: rate,
    pricesIncludeVat: false,
    vat: v,
    total: afterDiscount + v,
  };
}
