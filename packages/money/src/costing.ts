import { allocate, roundHalfAway, type Minor } from "./core";

/**
 * Costing for a trading company: what a factory line costs us in the quotation
 * currency, and the margin we add on top.
 */

/** Exchange rates as "1 unit of the main currency buys N units of X" (USD → { CNY: 7.1 }). */
export type Rates = Record<string, number>;

/**
 * Units of `from` per 1 unit of `to`, using rates against the main currency.
 * null when a rate is missing, so a cost is never silently converted at 1:1.
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

/** An amount in the factory's currency → the document currency, given rate = factory units per document unit. */
export const convertMinor = (minor: Minor, rate: number): Minor => {
  if (!(rate > 0)) throw new Error("Exchange rate must be more than 0");
  return roundHalfAway(minor / rate);
};

/** A factory price with its tax % added on top: 100.00 + 13% → 113.00 (what one unit costs Kebo). */
export function withTaxMinor(unitPriceMinor: Minor, taxRate: number): Minor {
  const rate = Math.max(Number(taxRate) || 0, 0);
  return roundHalfAway(unitPriceMinor * (1 + rate / 100));
}

/** Margin as a share of the selling price, in % with one decimal: (price − cost) / price. */
export function marginPercent(unitPriceMinor: Minor, unitCost: Minor): number | null {
  if (!(unitPriceMinor > 0)) return null;
  return roundHalfAway(((unitPriceMinor - unitCost) / unitPriceMinor) * 1000) / 10;
}

/** The selling price that leaves `margin`% on a unit cost. */
export function priceForMargin(unitCost: Minor, margin: number): Minor {
  if (margin >= 100) throw new Error("Margin must be under 100%");
  return roundHalfAway(unitCost / (1 - margin / 100));
}

export interface CostedLine {
  quantity: number | string;
  unitPriceMinor: Minor;
  unitCostMinor: Minor | null;
}

/**
 * The costing box on a quotation: cost, sales and profit of the lines that have
 * a cost; lines without one are counted apart. The document discount is spread
 * over all lines by amount (as on the invoice), so it lowers the profit shown.
 */
export function costSummary(lines: CostedLine[], discountMinor: Minor = 0) {
  const gross = lines.map((l) => roundHalfAway(l.unitPriceMinor * (Number(l.quantity) || 0)));
  const subtotal = gross.reduce((s, g) => s + g, 0);
  const shares = allocate(Math.min(Math.max(discountMinor, 0), Math.max(subtotal, 0)), gross);
  let cost = 0;
  let sales = 0;
  let uncosted = 0;
  lines.forEach((l, i) => {
    if (l.unitCostMinor === null) {
      uncosted += 1;
      return;
    }
    const afterDiscount = gross[i] - shares[i];
    sales += afterDiscount;
    cost += roundHalfAway(l.unitCostMinor * (Number(l.quantity) || 0));
  });
  return {
    costMinor: cost,
    salesMinor: sales,
    profitMinor: sales - cost,
    marginPercent: sales > 0 ? roundHalfAway(((sales - cost) / sales) * 1000) / 10 : null,
    uncostedLines: uncosted,
  };
}
