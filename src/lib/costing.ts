/**
 * Costing for a middleman: what a factory line costs us, in the quotation's
 * currency, and the margin we add. Money is handled in cents (integers) so
 * the numbers match everywhere; rates and percentages are plain numbers.
 *
 * Exchange rates are "1 unit of the main currency = N units of X" (e.g.
 * USD → { CNY: 7.1 }). The main currency itself is 1.
 */

export type Rates = Record<string, number>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One unit as we pay it: VAT added when the factory quoted without it. */
export function unitPriceWithVat(unitPrice: number, vatRate: number, pricesIncludeVat: boolean): number {
  return round2(pricesIncludeVat ? unitPrice : unitPrice * (1 + vatRate / 100));
}

/** The VAT inside a price that includes it. */
export function vatPart(unitPriceInclVat: number, vatRate: number): number {
  return round2(unitPriceInclVat - unitPriceInclVat / (1 + vatRate / 100));
}

/**
 * How many units of `from` one unit of `to` is worth, using rates against the
 * main currency. null when a rate is missing (then the cost cannot be converted).
 */
export function fxRate(from: string, to: string, main: string, rates: Rates): number | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return 1;
  const per = (c: string) => (c === main.toUpperCase() ? 1 : (rates[c] ?? null));
  const rf = per(f);
  const rt = per(t);
  if (!rf || !rt) return null;
  return rf / rt;
}

/** A factory amount in the quotation's currency, given `rate` = factory units per quotation unit. */
export const convert = (amount: number, rate: number) => round2(amount / rate);

/** Our VAT on the selling price: when prices include it, margins are worked on the price without it. */
export interface SalesVat {
  rate: number;
  included: boolean;
}

const net = (price: number, vat?: SalesVat) => (vat?.included && vat.rate > 0 ? price / (1 + vat.rate / 100) : price);

/** Margin as a share of the selling price (without our VAT), in %: (price − cost) / price. */
export function marginPercent(unitPriceInput: number, unitCost: number, vat?: SalesVat): number | null {
  const unitPrice = net(unitPriceInput, vat);
  if (!(unitPrice > 0)) return null;
  const m = ((unitPrice - unitCost) / unitPrice) * 1000;
  return (Math.sign(m) * Math.round(Math.abs(m))) / 10; // half away from zero: −6.25 → −6.3
}

/** The selling price that gives `margin` % on top of `unitCost` (with our VAT added in when prices include it). */
export function priceForMargin(unitCost: number, margin: number, vat?: SalesVat): number {
  if (margin >= 100) throw new Error("Margin must be under 100%");
  const price = unitCost / (1 - margin / 100);
  return round2(vat?.included && vat.rate > 0 ? price * (1 + vat.rate / 100) : price);
}

export interface CostedLine {
  quantity: number | string;
  unitPrice: number | string;
  unitCost?: number | string | null;
}

/** Totals for the internal costing box: cost, sales, profit and margin of the lines that have a cost. */
export function costSummary(lines: CostedLine[], vat?: SalesVat) {
  let cost = 0;
  let sales = 0;
  let uncosted = 0;
  for (const l of lines) {
    const q = Number(l.quantity) || 0;
    const p = Math.round(net(Number(l.unitPrice) || 0, vat) * 100);
    if (l.unitCost === null || l.unitCost === undefined || l.unitCost === "") {
      uncosted += 1;
      continue;
    }
    cost += Math.round(Math.round(Number(l.unitCost) * 100) * q);
    sales += Math.round(p * q);
  }
  return { costCents: cost, salesCents: sales, profitCents: sales - cost, marginPercent: sales > 0 ? Math.round(((sales - cost) / sales) * 1000) / 10 : null, uncosted };
}
