import { roundHalfAway, type Minor } from "./core";
import { netOf, type VatRule } from "./totals";

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

/**
 * What one unit really costs us. A factory price may or may not include its
 * VAT (usually 13%); when Kebo exports and claims the export VAT rebate, part
 * of that VAT comes back, so it is not a cost. rebateRate is the rebate % for
 * the product's HS code (0 when not claimed).
 */
export interface FactoryPrice {
  unitPriceMinor: Minor;
  vatRate: number;
  pricesIncludeVat: boolean;
  rebateRate?: number;
}

export function unitCostMinor(p: FactoryPrice): Minor {
  const vat = Math.max(p.vatRate, 0);
  const gross = p.pricesIncludeVat ? p.unitPriceMinor : roundHalfAway(p.unitPriceMinor * (1 + vat / 100));
  const rebate = Math.min(Math.max(p.rebateRate ?? 0, 0), vat);
  if (rebate <= 0) return gross;
  // The rebate is a share of the VAT-free price.
  const net = vat > 0 ? gross / (1 + vat / 100) : gross;
  return roundHalfAway(gross - net * (rebate / 100));
}

/** Margin as a share of the selling price without our VAT, in % with one decimal: (price − cost) / price. */
export function marginPercent(unitPriceMinor: Minor, unitCost: Minor, vat?: VatRule): number | null {
  const price = vat ? netOf(unitPriceMinor, vat) : unitPriceMinor;
  if (!(price > 0)) return null;
  return roundHalfAway(((price - unitCost) / price) * 1000) / 10;
}

/** The selling price that leaves `margin`% on a unit cost (with our VAT put back in when prices include it). */
export function priceForMargin(unitCost: Minor, margin: number, vat?: VatRule): Minor {
  if (margin >= 100) throw new Error("Margin must be under 100%");
  const net = unitCost / (1 - margin / 100);
  const gross = vat?.pricesIncludeVat && vat.rate > 0 ? net * (1 + vat.rate / 100) : net;
  return roundHalfAway(gross);
}

export interface CostedLine {
  quantity: number | string;
  unitPriceMinor: Minor;
  unitCostMinor: Minor | null;
}

/** The costing box on a quotation: cost, sales and profit of the lines that have a cost; lines without one are counted apart. */
export function costSummary(lines: CostedLine[], vat?: VatRule) {
  let cost = 0;
  let sales = 0;
  let uncosted = 0;
  for (const l of lines) {
    const q = Number(l.quantity) || 0;
    if (l.unitCostMinor === null) {
      uncosted += 1;
      continue;
    }
    const price = vat ? netOf(l.unitPriceMinor, vat) : l.unitPriceMinor;
    cost += roundHalfAway(l.unitCostMinor * q);
    sales += roundHalfAway(price * q);
  }
  return {
    costMinor: cost,
    salesMinor: sales,
    profitMinor: sales - cost,
    marginPercent: sales > 0 ? roundHalfAway(((sales - cost) / sales) * 1000) / 10 : null,
    uncostedLines: uncosted,
  };
}
